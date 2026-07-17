import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  register,
  getAll,
  getByKey,
  isRegistered,
  getCount,
  clearRegistry,
  type FeatureDefinition,
  type FeatureCategory,
} from './index.js';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

vi.mock('../../db/db.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryMany: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Generators ──────────────────────────────────────────────────────────────

const validCategories: FeatureCategory[] = [
  'input_channels',
  'ai_capabilities',
  'integrations',
  'export_formats',
  'advanced',
];

const categoryArb = fc.constantFrom(...validCategories);

const featureKeyArb = fc
  .tuple(
    fc.constantFrom('input', 'ai', 'integration', 'export', 'advanced', 'custom'),
    fc.string({ minLength: 1, maxLength: 20, unit: 'grapheme' }).filter((s) => /^[a-z_]+$/.test(s)),
  )
  .map(([prefix, suffix]) => `${prefix}.${suffix}`);

const featureNameArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

const featureDescriptionArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

const featureDefinitionArb = fc.record({
  key: featureKeyArb,
  name: featureNameArb,
  description: featureDescriptionArb,
  category: categoryArb,
});

/** Generates an array of feature definitions with unique keys */
const uniqueFeatureListArb = fc
  .array(featureDefinitionArb, { minLength: 1, maxLength: 20 })
  .map((features) => {
    const seen = new Set<string>();
    return features.filter((f) => {
      if (seen.has(f.key)) return false;
      seen.add(f.key);
      return true;
    });
  })
  .filter((features) => features.length > 0);

// ─── Property Tests ──────────────────────────────────────────────────────────

/**
 * Property 28: Feature Registry Auto-Registration and Uniqueness
 * Verify registered features appear with unique keys; no duplicates allowed.
 *
 * **Validates: Requirements 17.8, 18.15**
 */
describe('Property 28: Feature Registry Auto-Registration and Uniqueness', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('getAll() returns exactly the registered features (no more, no fewer)', () => {
    fc.assert(
      fc.property(uniqueFeatureListArb, (features) => {
        clearRegistry();

        for (const feature of features) {
          register(feature);
        }

        const all = getAll();

        // Count matches
        expect(all.length).toBe(features.length);

        // Every registered feature is in the result
        for (const feature of features) {
          const found = all.find((entry) => entry.key === feature.key);
          expect(found).toBeDefined();
          expect(found!.name).toBe(feature.name);
          expect(found!.category).toBe(feature.category);
        }

        // getCount also agrees
        expect(getCount()).toBe(features.length);

        // Every feature is individually retrievable
        for (const feature of features) {
          expect(isRegistered(feature.key)).toBe(true);
          expect(getByKey(feature.key)).not.toBeNull();
        }
      }),
      { numRuns: 200 },
    );
  });

  it('no duplicate keys exist in getAll()', () => {
    fc.assert(
      fc.property(uniqueFeatureListArb, (features) => {
        clearRegistry();

        for (const feature of features) {
          register(feature);
        }

        const all = getAll();
        const keys = all.map((entry) => entry.key);
        const uniqueKeys = new Set(keys);

        // No duplicates: set size equals array length
        expect(uniqueKeys.size).toBe(keys.length);
      }),
      { numRuns: 200 },
    );
  });

  it('re-registering the same key does not increase count (idempotent)', () => {
    fc.assert(
      fc.property(uniqueFeatureListArb, fc.integer({ min: 2, max: 5 }), (features, repeatCount) => {
        clearRegistry();

        // Register all features once
        for (const feature of features) {
          register(feature);
        }
        const countAfterFirst = getCount();

        // Re-register all features multiple times
        for (let i = 0; i < repeatCount; i++) {
          for (const feature of features) {
            register(feature);
          }
        }
        const countAfterRepeats = getCount();

        // Count must not change after re-registration
        expect(countAfterRepeats).toBe(countAfterFirst);
        expect(countAfterRepeats).toBe(features.length);

        // getAll() still returns the same number of entries
        const all = getAll();
        expect(all.length).toBe(features.length);
      }),
      { numRuns: 200 },
    );
  });
});
