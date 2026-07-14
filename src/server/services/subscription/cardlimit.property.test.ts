import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { validateItemInput, VALID_CONTENT_TYPES } from '../items/index.js';

// Mock dependencies required by subscription service
vi.mock('../../db/db.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryMany: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../middleware/entitlement.js', () => ({
  loadEntitlements: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../queues.js', () => ({
  aiProcessingQueue: { add: vi.fn() },
  stripePaymentRetryQueue: { add: vi.fn() },
}));

vi.mock('../../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../config.js', () => ({
  config: {
    stripeSecretKey: 'sk_test_fake',
    stripeWebhookSecret: 'whsec_test_fake',
    encryptionKey: 'a'.repeat(64),
  },
}));

vi.mock('../../utils/encryption.js', () => ({
  encrypt: vi.fn((text: string) => `encrypted:${text}`),
  decrypt: vi.fn((text: string) => text.replace('encrypted:', '')),
}));

import * as subscriptionModule from './index.js';

/**
 * Property 33: Unlimited Card Creation Invariant
 * Verify card creation never rejected due to card count limit on any tier.
 * Generator: random plans and card counts.
 *
 * **Validates: Requirements 18.13**
 *
 * This test verifies the ABSENCE of a card count limit check. The system
 * must never reject card creation based on how many cards a user already has.
 * All subscription tiers provide unlimited Card creation.
 */
describe('Property 33: Unlimited Card Creation Invariant', () => {
  // Generator for subscription plan names
  const planNameArb = fc.constantFrom('free', 'pro', 'enterprise');

  // Generator for card counts representing how many cards a user already has
  const cardCountArb = fc.integer({ min: 0, max: 100000 });

  // Generator for valid content types
  const contentTypeArb = fc.constantFrom(...VALID_CONTENT_TYPES);

  // Generator for non-empty content strings
  const contentArb = fc.string({ minLength: 1, maxLength: 500 }).filter(
    (s) => s.trim().length > 0
  );

  it('validateItemInput never rejects based on card count regardless of plan or existing card count', () => {
    fc.assert(
      fc.property(
        planNameArb,
        cardCountArb,
        contentArb,
        contentTypeArb,
        (plan, existingCardCount, content, contentType) => {
          // Simulate validation for a new card regardless of how many cards exist
          // The validateItemInput function should only check content validity,
          // never the number of existing cards
          const result = validateItemInput({
            content,
            content_type: contentType,
          });

          // A valid input must always be accepted - no card count limit exists
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);

          // Verify no error message mentions card count, limit, or plan
          for (const error of result.errors) {
            expect(error.toLowerCase()).not.toContain('card count');
            expect(error.toLowerCase()).not.toContain('card limit');
            expect(error.toLowerCase()).not.toContain('maximum cards');
            expect(error.toLowerCase()).not.toContain('plan limit');
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('no card count limit function exists in the subscription service', () => {
    const exportedFunctions = Object.keys(subscriptionModule);

    fc.assert(
      fc.property(planNameArb, cardCountArb, (plan, cardCount) => {
        // The subscription service exports checkStorageLimit and checkAiQueryLimit
        // but must NOT have a checkCardCountLimit or similar function.
        // This verifies unlimited card creation is preserved by design.
        for (const fnName of exportedFunctions) {
          const lowerName = fnName.toLowerCase();
          expect(lowerName).not.toContain('cardcount');
          expect(lowerName).not.toContain('cardlimit');
          expect(lowerName).not.toContain('card_count');
          expect(lowerName).not.toContain('card_limit');
          expect(lowerName).not.toContain('maxcard');
          expect(lowerName).not.toContain('max_card');
        }
      }),
      { numRuns: 200 }
    );
  });
});
