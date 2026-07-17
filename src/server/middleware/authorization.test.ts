import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireOwnership } from './authorization.js';

/**
 * Unit tests for authorization middleware (ownership enforcement).
 * Validates: Requirements 2.1 (restrict access to owner), 2.3 (403 on cross-user access)
 */

// Mock the db module
vi.mock('../db/db.js', () => ({
  queryOne: vi.fn(),
}));

import { queryOne } from '../db/db.js';

const mockedQueryOne = vi.mocked(queryOne);

function createMockRequest(
  params: Record<string, string> = {},
  user?: { sub: string },
): Partial<Request> {
  return {
    params: params as Request['params'],
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

describe('Authorization Middleware - requireOwnership', () => {
  let mockNext: NextFunction;

  beforeEach(() => {
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  describe('requireOwnership("item")', () => {
    const middleware = requireOwnership('item');

    it('should call next() when user owns the item', async () => {
      const userId = 'user-123';
      const itemId = 'item-456';
      const req = createMockRequest({ id: itemId }, { sub: userId }) as Request;
      const res = createMockResponse() as Response;

      mockedQueryOne.mockResolvedValue({ user_id: userId });

      await middleware(req, res, mockNext);

      expect(mockedQueryOne).toHaveBeenCalledWith('SELECT user_id FROM items WHERE id = $1', [
        itemId,
      ]);
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 403 when user does not own the item', async () => {
      const req = createMockRequest({ id: 'item-456' }, { sub: 'user-123' }) as Request;
      const res = createMockResponse() as Response;

      mockedQueryOne.mockResolvedValue({ user_id: 'user-other' });

      await middleware(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Forbidden: You do not have access to this resource',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 404 when item does not exist', async () => {
      const req = createMockRequest({ id: 'nonexistent-id' }, { sub: 'user-123' }) as Request;
      const res = createMockResponse() as Response;

      mockedQueryOne.mockResolvedValue(null);

      await middleware(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Resource not found' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 when resource ID is missing from params', async () => {
      const req = createMockRequest({}, { sub: 'user-123' }) as Request;
      const res = createMockResponse() as Response;

      await middleware(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Resource ID is required' });
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockedQueryOne).not.toHaveBeenCalled();
    });

    it('should return 401 when user is not authenticated', async () => {
      const req = createMockRequest({ id: 'item-456' }) as Request;
      const res = createMockResponse() as Response;

      await middleware(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockedQueryOne).not.toHaveBeenCalled();
    });

    it('should call next(error) when database query fails', async () => {
      const req = createMockRequest({ id: 'item-456' }, { sub: 'user-123' }) as Request;
      const res = createMockResponse() as Response;
      const dbError = new Error('Connection refused');

      mockedQueryOne.mockRejectedValue(dbError);

      await middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(dbError);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('requireOwnership("map")', () => {
    const middleware = requireOwnership('map');

    it('should query the maps table and allow access when user owns the map', async () => {
      const userId = 'user-abc';
      const mapId = 'map-789';
      const req = createMockRequest({ id: mapId }, { sub: userId }) as Request;
      const res = createMockResponse() as Response;

      mockedQueryOne.mockResolvedValue({ user_id: userId });

      await middleware(req, res, mockNext);

      expect(mockedQueryOne).toHaveBeenCalledWith('SELECT user_id FROM maps WHERE id = $1', [
        mapId,
      ]);
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 403 when user does not own the map', async () => {
      const req = createMockRequest({ id: 'map-789' }, { sub: 'user-abc' }) as Request;
      const res = createMockResponse() as Response;

      mockedQueryOne.mockResolvedValue({ user_id: 'user-xyz' });

      await middleware(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Forbidden: You do not have access to this resource',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 404 when map does not exist', async () => {
      const req = createMockRequest({ id: 'nonexistent-map' }, { sub: 'user-abc' }) as Request;
      const res = createMockResponse() as Response;

      mockedQueryOne.mockResolvedValue(null);

      await middleware(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Resource not found' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    const middleware = requireOwnership('item');

    it('should handle empty string resource ID as missing', async () => {
      const req = createMockRequest({ id: '' }, { sub: 'user-123' }) as Request;
      const res = createMockResponse() as Response;

      await middleware(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Resource ID is required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle user with empty sub as unauthenticated', async () => {
      const req = createMockRequest({ id: 'item-456' }, { sub: '' }) as Request;
      const res = createMockResponse() as Response;

      await middleware(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
