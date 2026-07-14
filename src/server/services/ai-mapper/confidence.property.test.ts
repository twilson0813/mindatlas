import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { categorizeItem, setOpenAIClient, type CategoryResult } from './index.js';
import type { Item } from '../items/index.js';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

vi.mock('../../db/db.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryMany: vi.fn().mockResolvedValue([]),
  withTransaction: vi.fn(async (fn: Function) => {
    const mockTxQuery = vi.fn().mockResolvedValue({
      rows: [{ id: 'mock-id', name: 'mock', color: '#000', category_id: 'cat-1' }],
    });
    return fn(mockTxQuery);
  }),
}));

vi.mock('../../utils/encryption.js', () => ({
  encrypt: vi.fn((text: string) => `encrypted:${text}`),
  decrypt: vi.fn((text: string) => text.replace('encrypted:', '')),
}));

vi.mock('../../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockItem(overrides?: Partial<Item>): Item {
  return {
    id: 'item-1',
    user_id: 'user-1',
    title: 'Test Item',
    content: 'Some test content for categorization.',
    content_type: 'note',
    metadata: null,
    source_channel: 'api',
    source_domain: null,
    file_path: null,
    file_size: null,
    is_deleted: false,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

/**
 * Property 10: Confidence Score Bounds
 * Verify all confidence scores are between 0.0 and 1.0 inclusive.
 * Generator: random categorization results (including out-of-bounds values).
 *
 * **Validates: Requirements 6.5**
 */
describe('Property 10: Confidence Score Bounds', () => {
  afterEach(() => {
    setOpenAIClient(null);
  });

  // Generator for confidence values including out-of-bounds, NaN, and Infinity
  const confidenceValueArb = fc.oneof(
    fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }), // normal range and out-of-bounds
    fc.double({ min: -1e10, max: 1e10, noNaN: true, noDefaultInfinity: true }), // extreme values
    fc.constant(NaN),
    fc.constant(Infinity),
    fc.constant(-Infinity),
    fc.constant(0),
    fc.constant(1),
    fc.constant(-0.001),
    fc.constant(1.001),
  );

  // Generator for category names
  const categoryNameArb = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);

  // Generator for a single category with random confidence
  const categoryArb = fc.record({
    name: categoryNameArb,
    confidence: confidenceValueArb,
  });

  // Generator for a single tag with random confidence
  const tagArb = fc.record({
    name: categoryNameArb,
    categoryName: categoryNameArb,
    confidence: confidenceValueArb,
  });

  // Generator for full AI responses with random confidence values
  const aiResponseArb = fc.record({
    categories: fc.array(categoryArb, { minLength: 1, maxLength: 5 }),
    tags: fc.array(tagArb, { minLength: 0, maxLength: 10 }),
  });

  it('should clamp all confidence scores to [0, 1] regardless of AI response values', async () => {
    await fc.assert(
      fc.asyncProperty(aiResponseArb, async (aiResponse) => {
        const mockClient = {
          chat: {
            completions: {
              create: vi.fn().mockResolvedValue({
                choices: [{ message: { content: JSON.stringify(aiResponse) } }],
              }),
            },
          },
        } as any;

        setOpenAIClient(mockClient);
        const item = createMockItem();

        const result: CategoryResult = await categorizeItem(item);

        // Every category confidence must be in [0, 1]
        for (const category of result.categories) {
          expect(category.confidence).toBeGreaterThanOrEqual(0);
          expect(category.confidence).toBeLessThanOrEqual(1);
          expect(Number.isFinite(category.confidence)).toBe(true);
        }

        // Every tag confidence must be in [0, 1]
        for (const tag of result.tags) {
          expect(tag.confidence).toBeGreaterThanOrEqual(0);
          expect(tag.confidence).toBeLessThanOrEqual(1);
          expect(Number.isFinite(tag.confidence)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
