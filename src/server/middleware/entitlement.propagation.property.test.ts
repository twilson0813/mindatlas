import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 30: Runtime Entitlement Propagation
 * Verify admin config changes are reflected immediately on the next API request without restart.
 * Generator: random entitlement config changes, verify immediate reflection.
 *
 * **Validates: Requirements 18.14**
 */

// Mock Redis client
vi.mock('../redis.js', () => ({
  redisClient: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

// Mock database
vi.mock('../db/db.js', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

// Mock logger
vi.mock('../logger.js', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { redisClient } from '../redis.js';
import { queryMany } from '../db/db.js';
import { loadEntitlements, invalidateCache } from './entitlement.js';

const mockedRedisGet = vi.mocked(redisClient.get);
const mockedRedisSet = vi.mocked(redisClient.set);
const mockedRedisDel = vi.mocked(redisClient.del);
const mockedQueryMany = vi.mocked(queryMany);

// Generator: random feature keys (dot-separated identifiers)
const featureKeyArb = fc
  .tuple(
    fc.constantFrom('input', 'ai', 'integration', 'export', 'advanced'),
    fc.constantFrom(
      'sms',
      'api',
      'csv',
      'categorization',
      'relationship_mapping',
      'natural_language',
      'cluster_summaries',
      'suggestions',
      'priority_processing',
      'notion',
      'n8n',
      'custom_categories',
    ),
  )
  .map(([prefix, suffix]) => `${prefix}.${suffix}`);

// Generator: random non-empty set of feature keys (for initial entitlements)
const featureListArb = fc.uniqueArray(featureKeyArb, { minLength: 1, maxLength: 8 });

// Generator: random planId (UUID)
const planIdArb = fc.uuid();

describe('Property 30: Runtime Entitlement Propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reflect updated entitlements immediately after cache invalidation', async () => {
    await fc.assert(
      fc.asyncProperty(
        planIdArb,
        featureListArb,
        featureListArb,
        async (planId, initialFeatures, updatedFeatures) => {
          // Step 1: First call — cache miss, load from DB with initial features
          mockedRedisGet.mockResolvedValueOnce(null);
          mockedQueryMany.mockResolvedValueOnce(
            initialFeatures.map((key) => ({ feature_key: key })),
          );
          mockedRedisSet.mockResolvedValueOnce('OK');

          const firstResult = await loadEntitlements(planId);

          // Verify initial features are returned
          expect(firstResult).toEqual(initialFeatures);

          // Step 2: Second call — cache hit returns initial features (simulates cached state)
          mockedRedisGet.mockResolvedValueOnce(JSON.stringify(initialFeatures));

          const cachedResult = await loadEntitlements(planId);
          expect(cachedResult).toEqual(initialFeatures);

          // Step 3: Admin changes entitlements — invalidate cache
          mockedRedisDel.mockResolvedValueOnce(1);
          await invalidateCache(planId);

          // Verify Redis del was called with correct key
          expect(redisClient.del).toHaveBeenCalledWith(`entitlements:${planId}`);

          // Step 4: Next request — cache miss again, DB returns NEW features
          mockedRedisGet.mockResolvedValueOnce(null);
          mockedQueryMany.mockResolvedValueOnce(
            updatedFeatures.map((key) => ({ feature_key: key })),
          );
          mockedRedisSet.mockResolvedValueOnce('OK');

          const afterInvalidation = await loadEntitlements(planId);

          // THE KEY PROPERTY: After invalidation, the new features are returned immediately
          expect(afterInvalidation).toEqual(updatedFeatures);

          // The old cached features must NOT be returned
          if (JSON.stringify(initialFeatures.sort()) !== JSON.stringify(updatedFeatures.sort())) {
            expect(afterInvalidation).not.toEqual(initialFeatures);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should never return stale entitlements after cache invalidation', async () => {
    await fc.assert(
      fc.asyncProperty(
        planIdArb,
        featureListArb,
        featureListArb,
        async (planId, staleFeatures, freshFeatures) => {
          // Simulate: cache was populated with stale data
          // Admin invalidates cache
          // Next load must get fresh data from DB

          // Invalidate cache
          mockedRedisDel.mockResolvedValueOnce(1);
          await invalidateCache(planId);

          // After invalidation, Redis returns null (cache miss)
          mockedRedisGet.mockResolvedValueOnce(null);
          // DB returns the fresh features (admin's update)
          mockedQueryMany.mockResolvedValueOnce(freshFeatures.map((key) => ({ feature_key: key })));
          mockedRedisSet.mockResolvedValueOnce('OK');

          const result = await loadEntitlements(planId);

          // Must always return the fresh features from DB
          expect(result).toEqual(freshFeatures);
          // Must re-cache the fresh features
          expect(redisClient.set).toHaveBeenCalledWith(
            `entitlements:${planId}`,
            JSON.stringify(freshFeatures),
            'EX',
            3600,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should propagate changes for any plan regardless of plan identifier', async () => {
    await fc.assert(
      fc.asyncProperty(planIdArb, featureListArb, async (planId, newFeatures) => {
        // After invalidation for any planId, the system re-fetches from DB
        mockedRedisDel.mockResolvedValueOnce(1);
        await invalidateCache(planId);

        // The del call targets the correct plan-specific key
        expect(redisClient.del).toHaveBeenCalledWith(`entitlements:${planId}`);

        // Subsequent load hits DB
        mockedRedisGet.mockResolvedValueOnce(null);
        mockedQueryMany.mockResolvedValueOnce(newFeatures.map((key) => ({ feature_key: key })));
        mockedRedisSet.mockResolvedValueOnce('OK');

        const result = await loadEntitlements(planId);
        expect(result).toEqual(newFeatures);
      }),
      { numRuns: 200 },
    );
  });
});
