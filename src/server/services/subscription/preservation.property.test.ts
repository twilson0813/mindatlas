import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { checkStorageLimit, checkAiQueryLimit } from './index.js';
import { getItem } from '../items/index.js';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

vi.mock('../../db/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

vi.mock('../../utils/encryption.js', () => ({
  encrypt: vi.fn((text: string) => `encrypted:${text}`),
  decrypt: vi.fn((text: string) => text.replace('encrypted:', '')),
}));

vi.mock('../../queues.js', () => ({
  aiProcessingQueue: { add: vi.fn() },
  stripePaymentRetryQueue: { add: vi.fn() },
}));

vi.mock('../../middleware/entitlement.js', () => ({
  loadEntitlements: vi.fn(),
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
  },
}));

vi.mock('../credentials/index.js', () => ({
  getStripeCredentials: vi.fn().mockResolvedValue({
    secretKey: 'sk_test_fake',
    webhookSecret: 'whsec_test_fake',
  }),
}));

import { queryOne } from '../../db/db.js';

const mockQueryOne = vi.mocked(queryOne);

/**
 * Property 34: Existing Data Preservation on Limit Exceed
 * Verify existing cards remain accessible when storage/AI limits exceeded.
 * Generator: random users at/over limits, verify existing cards readable.
 *
 * **Validates: Requirements 18.5**
 */
describe('Property 34: Existing Data Preservation on Limit Exceed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Generator for storage limit scenarios (including over-limit)
  const storageLimitArb = fc.integer({ min: 100, max: 50000 }); // plan limit in MB
  const storageUsageArb = fc.integer({ min: 0, max: 100000 }); // usage in MB (can exceed limit)

  // Generator for AI query limit scenarios
  const aiLimitArb = fc.integer({ min: 1, max: 1000 }); // daily AI query limit
  const aiUsageArb = fc.integer({ min: 0, max: 2000 }); // queries used today (can exceed limit)

  // Generator for item data
  const itemIdArb = fc.uuid();
  const userIdArb = fc.uuid();
  const contentArb = fc.string({ minLength: 1, maxLength: 500 });
  const contentTypeArb = fc.constantFrom(
    'plain_text',
    'link',
    'code_snippet',
    'note',
    'task',
    'idea',
    'file',
    'custom',
  );

  it('getItem returns existing item regardless of storage limit status', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        itemIdArb,
        storageLimitArb,
        storageUsageArb,
        contentArb,
        contentTypeArb,
        async (userId, itemId, limitMb, usageMb, content, contentType) => {
          vi.clearAllMocks();

          const usageBytes = usageMb * 1024 * 1024;
          const isOverLimit = usageMb >= limitMb;

          // Mock checkStorageLimit DB calls:
          // First call: plan storage limit
          // Second call: total bytes used
          mockQueryOne
            .mockResolvedValueOnce({ storage_limit_mb: limitMb })
            .mockResolvedValueOnce({ total_bytes: String(usageBytes) });

          const storageResult = await checkStorageLimit(userId);

          // Verify checkStorageLimit correctly reports limit status
          expect(storageResult.allowed).toBe(!isOverLimit);
          expect(storageResult.limitMb).toBe(limitMb);

          // Now mock getItem DB call - item exists and belongs to user
          vi.clearAllMocks();
          mockQueryOne.mockResolvedValueOnce({
            id: itemId,
            user_id: userId,
            title: 'Test Card',
            content_encrypted: `encrypted:${content}`,
            content_type: contentType,
            metadata: null,
            source_channel: 'api',
            source_domain: null,
            file_path: null,
            file_size: null,
            is_deleted: false,
            deleted_at: null,
            created_at: new Date(),
            updated_at: new Date(),
          });

          // THE KEY PROPERTY: getItem succeeds regardless of storage limit
          const item = await getItem(userId, itemId);

          expect(item).toBeDefined();
          expect(item.id).toBe(itemId);
          expect(item.user_id).toBe(userId);
          expect(item.content).toBe(content);
          expect(item.content_type).toBe(contentType);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('getItem returns existing item regardless of AI query limit status', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        itemIdArb,
        aiLimitArb,
        aiUsageArb,
        contentArb,
        contentTypeArb,
        async (userId, itemId, dailyLimit, usedToday, content, contentType) => {
          vi.clearAllMocks();

          const isOverLimit = usedToday >= dailyLimit;

          // Mock checkAiQueryLimit DB calls:
          // First call: plan AI query limit
          // Second call: today's usage count
          mockQueryOne
            .mockResolvedValueOnce({ ai_queries_per_day: dailyLimit })
            .mockResolvedValueOnce({ count: String(usedToday) });

          const aiResult = await checkAiQueryLimit(userId);

          // Verify checkAiQueryLimit correctly reports limit status
          expect(aiResult.allowed).toBe(!isOverLimit);
          expect(aiResult.dailyLimit).toBe(dailyLimit);

          // Now mock getItem DB call - item exists and belongs to user
          vi.clearAllMocks();
          mockQueryOne.mockResolvedValueOnce({
            id: itemId,
            user_id: userId,
            title: 'Test Card',
            content_encrypted: `encrypted:${content}`,
            content_type: contentType,
            metadata: null,
            source_channel: 'api',
            source_domain: null,
            file_path: null,
            file_size: null,
            is_deleted: false,
            deleted_at: null,
            created_at: new Date(),
            updated_at: new Date(),
          });

          // THE KEY PROPERTY: getItem succeeds regardless of AI query limit
          const item = await getItem(userId, itemId);

          expect(item).toBeDefined();
          expect(item.id).toBe(itemId);
          expect(item.user_id).toBe(userId);
          expect(item.content).toBe(content);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('exceeding storage limit never prevents read access to any existing card', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        fc.array(itemIdArb, { minLength: 1, maxLength: 5 }),
        storageLimitArb,
        contentArb,
        async (userId, itemIds, limitMb, content) => {
          // Simulate a user who is OVER their storage limit
          const usageMb = limitMb + fc.sample(fc.integer({ min: 1, max: 1000 }), 1)[0];
          const usageBytes = usageMb * 1024 * 1024;

          vi.clearAllMocks();

          // Verify user is over limit
          mockQueryOne
            .mockResolvedValueOnce({ storage_limit_mb: limitMb })
            .mockResolvedValueOnce({ total_bytes: String(usageBytes) });

          const storageResult = await checkStorageLimit(userId);
          expect(storageResult.allowed).toBe(false);

          // Verify ALL existing items are still accessible
          for (const itemId of itemIds) {
            vi.clearAllMocks();
            mockQueryOne.mockResolvedValueOnce({
              id: itemId,
              user_id: userId,
              title: 'Card',
              content_encrypted: `encrypted:${content}`,
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
            });

            const item = await getItem(userId, itemId);
            expect(item).toBeDefined();
            expect(item.id).toBe(itemId);
            expect(item.content).toBe(content);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
