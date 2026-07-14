import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import type { Request, Response, NextFunction } from 'express';

/**
 * Property 29: Entitlement Enforcement
 * Verify 402 for features not in plan; no block for features in plan.
 * Generator: random user/plan/feature combinations.
 *
 * **Validates: Requirements 18.12**
 */

// Mock Redis client
vi.mock('../redis.js', () => ({
  redisClient: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

// Mock DB
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
import { queryOne, queryMany } from '../db/db.js';
import { requireEntitlement } from './entitlement.js';

const mockedRedisGet = vi.mocked(redisClient.get);
const mockedRedisSet = vi.mocked(redisClient.set);
const mockedQueryOne = vi.mocked(queryOne);
const mockedQueryMany = vi.mocked(queryMany);

// Generator: feature keys (dot-separated identifiers)
const featureKeyArb = fc
  .tuple(
    fc.constantFrom('input', 'ai', 'integration', 'export', 'advanced'),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')), {
      minLength: 2,
      maxLength: 15,
    })
  )
  .map(([category, name]) => `${category}.${name}`);

// Generator: a non-empty set of entitled feature keys
const entitlementListArb = fc.uniqueArray(featureKeyArb, { minLength: 1, maxLength: 20 });

// Generator: plan IDs
const planIdArb = fc.uuid();

// Generator: user IDs
const userIdArb = fc.uuid();

function createMockRequest(user?: { sub: string }): Partial<Request> {
  return {
    user: user
      ? { sub: user.sub, email: 'test@example.com', role: 'user', iat: 0, exp: 0 }
      : undefined,
  };
}

function createMockResponse(): Partial<Response> & { statusCode?: number; body?: unknown } {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = vi.fn().mockImplementation((data: unknown) => {
    res.body = data;
    return res as Response;
  });
  return res;
}

describe('Property 29: Entitlement Enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 402 when feature is NOT in the plan entitlement list', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        planIdArb,
        entitlementListArb,
        featureKeyArb,
        async (userId, planId, entitledFeatures, requestedFeature) => {
          // Ensure the requested feature is NOT in the entitlement list
          const filteredEntitlements = entitledFeatures.filter((f) => f !== requestedFeature);
          // Skip if all features happened to be the same as requested (empty after filter)
          fc.pre(filteredEntitlements.length >= 0);
          // Ensure the requested feature is truly not in the list
          fc.pre(!filteredEntitlements.includes(requestedFeature));

          // Mock subscription lookup — user has an active plan
          mockedQueryOne.mockResolvedValue({ plan_id: planId });

          // Mock Redis cache — return the entitlement list (without the requested feature)
          mockedRedisGet.mockResolvedValue(JSON.stringify(filteredEntitlements));

          const middleware = requireEntitlement(requestedFeature);
          const req = createMockRequest({ sub: userId }) as Request;
          const res = createMockResponse() as Response;
          const next: NextFunction = vi.fn();

          await middleware(req, res, next);

          // Must return 402 Payment Required
          expect(res.status).toHaveBeenCalledWith(402);
          expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
              error: 'Feature not available in your plan',
              feature: requestedFeature,
            })
          );
          // next() must NOT be called
          expect(next).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 200 },
    );
  });

  it('should call next() (no block) when feature IS in the plan entitlement list', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        planIdArb,
        entitlementListArb,
        async (userId, planId, entitledFeatures) => {
          // Pick a random feature from the entitled list
          const requestedFeature = entitledFeatures[0];

          // Mock subscription lookup — user has an active plan
          mockedQueryOne.mockResolvedValue({ plan_id: planId });

          // Mock Redis cache — return the full entitlement list (includes requested feature)
          mockedRedisGet.mockResolvedValue(JSON.stringify(entitledFeatures));

          const middleware = requireEntitlement(requestedFeature);
          const req = createMockRequest({ sub: userId }) as Request;
          const res = createMockResponse() as Response;
          const next: NextFunction = vi.fn();

          await middleware(req, res, next);

          // next() must be called — no blocking
          expect(next).toHaveBeenCalled();
          // No error status should be set
          expect(res.status).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 200 },
    );
  });
});
