import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireEntitlement, loadEntitlements, invalidateCache } from './entitlement.js';

/**
 * Unit tests for entitlement middleware.
 * Validates: Requirements 18.12 (402 for unauthorized feature access),
 *            18.14 (read from admin-configured plan definitions, changes take effect immediately)
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
import { queryOne, queryMany } from '../db/db.js';

const mockedRedisGet = vi.mocked(redisClient.get);
const mockedRedisSet = vi.mocked(redisClient.set);
const mockedRedisDel = vi.mocked(redisClient.del);
const mockedQueryOne = vi.mocked(queryOne);
const mockedQueryMany = vi.mocked(queryMany);

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

describe('Entitlement Middleware', () => {
  let mockNext: NextFunction;

  beforeEach(() => {
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  describe('requireEntitlement(featureKey)', () => {
    it('should call next() when user plan includes the feature (cached)', async () => {
      const middleware = requireEntitlement('input.sms');
      const req = createMockRequest({ sub: 'user-123' }) as Request;
      const res = createMockResponse() as Response;

      // User has an active subscription
      mockedQueryOne.mockResolvedValue({ plan_id: 'pro' });
      // Redis cache has the entitlements
      mockedRedisGet.mockResolvedValue(JSON.stringify(['input.sms', 'ai.natural_language']));

      await middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 402 when feature is not in user plan', async () => {
      const middleware = requireEntitlement('ai.natural_language');
      const req = createMockRequest({ sub: 'user-123' }) as Request;
      const res = createMockResponse() as Response;

      mockedQueryOne.mockResolvedValue({ plan_id: 'free' });
      mockedRedisGet.mockResolvedValue(JSON.stringify(['input.api']));

      await middleware(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Feature not available in your plan',
        feature: 'ai.natural_language',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when user is not authenticated', async () => {
      const middleware = requireEntitlement('input.sms');
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;

      await middleware(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should default to "free" plan when no subscription exists', async () => {
      const middleware = requireEntitlement('input.sms');
      const req = createMockRequest({ sub: 'user-456' }) as Request;
      const res = createMockResponse() as Response;

      // No active subscription
      mockedQueryOne.mockResolvedValue(null);
      // Free plan has limited features
      mockedRedisGet.mockResolvedValue(JSON.stringify(['input.api']));

      await middleware(req, res, mockNext);

      // Should check entitlements for 'free' plan
      expect(mockedRedisGet).toHaveBeenCalledWith('entitlements:free');
      expect(res.status).toHaveBeenCalledWith(402);
    });

    it('should call next(error) when database query fails', async () => {
      const middleware = requireEntitlement('input.sms');
      const req = createMockRequest({ sub: 'user-123' }) as Request;
      const res = createMockResponse() as Response;
      const dbError = new Error('Connection refused');

      mockedQueryOne.mockRejectedValue(dbError);

      await middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(dbError);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should allow access when feature is in cached plan entitlements', async () => {
      const middleware = requireEntitlement('integration.notion');
      const req = createMockRequest({ sub: 'user-789' }) as Request;
      const res = createMockResponse() as Response;

      mockedQueryOne.mockResolvedValue({ plan_id: 'business' });
      mockedRedisGet.mockResolvedValue(
        JSON.stringify(['input.sms', 'ai.natural_language', 'integration.notion', 'export.csv']),
      );

      await middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('loadEntitlements(planId)', () => {
    it('should return features from Redis cache on cache hit', async () => {
      const cachedFeatures = ['input.sms', 'ai.categorization'];
      mockedRedisGet.mockResolvedValue(JSON.stringify(cachedFeatures));

      const result = await loadEntitlements('pro');

      expect(result).toEqual(cachedFeatures);
      expect(mockedRedisGet).toHaveBeenCalledWith('entitlements:pro');
      expect(mockedQueryMany).not.toHaveBeenCalled();
    });

    it('should fall back to DB on cache miss and populate cache', async () => {
      mockedRedisGet.mockResolvedValue(null);
      mockedQueryMany.mockResolvedValue([
        { feature_key: 'input.sms' },
        { feature_key: 'ai.natural_language' },
      ]);
      mockedRedisSet.mockResolvedValue('OK');

      const result = await loadEntitlements('pro');

      expect(result).toEqual(['input.sms', 'ai.natural_language']);
      expect(mockedQueryMany).toHaveBeenCalledWith(
        'SELECT feature_key FROM plan_entitlements WHERE plan_id = $1 AND enabled = true',
        ['pro'],
      );
      expect(mockedRedisSet).toHaveBeenCalledWith(
        'entitlements:pro',
        JSON.stringify(['input.sms', 'ai.natural_language']),
        'EX',
        3600,
      );
    });

    it('should return empty array when plan has no entitlements', async () => {
      mockedRedisGet.mockResolvedValue(null);
      mockedQueryMany.mockResolvedValue([]);
      mockedRedisSet.mockResolvedValue('OK');

      const result = await loadEntitlements('free');

      expect(result).toEqual([]);
      expect(mockedRedisSet).toHaveBeenCalledWith('entitlements:free', '[]', 'EX', 3600);
    });
  });

  describe('invalidateCache(planId)', () => {
    it('should delete the Redis key for the given plan', async () => {
      mockedRedisDel.mockResolvedValue(1);

      await invalidateCache('pro');

      expect(mockedRedisDel).toHaveBeenCalledWith('entitlements:pro');
    });

    it('should not throw when key does not exist', async () => {
      mockedRedisDel.mockResolvedValue(0);

      await expect(invalidateCache('nonexistent')).resolves.not.toThrow();
      expect(mockedRedisDel).toHaveBeenCalledWith('entitlements:nonexistent');
    });
  });
});
