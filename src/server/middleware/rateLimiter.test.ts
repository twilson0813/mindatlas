import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { rateLimiter, WINDOW_SIZE_MS, MAX_REQUESTS } from './rateLimiter.js';

/**
 * Unit tests for rate limiting middleware.
 * Validates: Requirements 3.4 (100 requests per minute per user)
 */

// Mock the Redis client
vi.mock('../redis.js', () => {
  const mockPipeline = {
    zremrangebyscore: vi.fn().mockReturnThis(),
    zcard: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn(),
  };

  const mockRedisClient = {
    pipeline: vi.fn(() => mockPipeline),
    zrange: vi.fn(),
  };

  return {
    redisClient: mockRedisClient,
    __mockPipeline: mockPipeline,
  };
});

// Import after mocking
import { redisClient, __mockPipeline } from '../redis.js';

const mockPipeline = __mockPipeline as {
  zremrangebyscore: ReturnType<typeof vi.fn>;
  zcard: ReturnType<typeof vi.fn>;
  zadd: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
};

function createMockRequest(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    headers: {},
    ip: '192.168.1.1',
    socket: { remoteAddress: '192.168.1.1' } as never,
    ...overrides,
  };
}

function createMockResponse(): Partial<Response> & {
  statusCode?: number;
  body?: unknown;
  headers: Record<string, string>;
} {
  const res: Partial<Response> & {
    statusCode?: number;
    body?: unknown;
    headers: Record<string, string>;
  } = {
    headers: {},
  };
  res.status = vi.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = vi.fn().mockImplementation((data: unknown) => {
    res.body = data;
    return res as Response;
  });
  res.set = vi.fn().mockImplementation((key: string, value: string) => {
    res.headers[key] = value;
    return res as Response;
  });
  return res;
}

describe('Rate Limiter Middleware', () => {
  let mockNext: NextFunction;

  beforeEach(() => {
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  describe('request allowed (under limit)', () => {
    it('should call next() when request count is below the limit', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0], // zremrangebyscore
        [null, 50], // zcard: 50 requests in window
        [null, 1], // zadd
        [null, 1], // expire
      ]);

      const req = createMockRequest({
        user: { sub: 'user-123', email: 'test@example.com', role: 'user', iat: 0, exp: 0 },
      }) as Request;
      const res = createMockResponse() as Response;

      await rateLimiter(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should call next() when request count is exactly at limit minus one', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, MAX_REQUESTS - 1], // 99 requests — still under
        [null, 1],
        [null, 1],
      ]);

      const req = createMockRequest({
        user: { sub: 'user-456', email: 'test@example.com', role: 'user', iat: 0, exp: 0 },
      }) as Request;
      const res = createMockResponse() as Response;

      await rateLimiter(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should call next() for the first request (count = 0)', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, 0], // No previous requests
        [null, 1],
        [null, 1],
      ]);

      const req = createMockRequest({
        user: { sub: 'new-user', email: 'new@example.com', role: 'user', iat: 0, exp: 0 },
      }) as Request;
      const res = createMockResponse() as Response;

      await rateLimiter(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('request rejected (over limit)', () => {
    it('should return 429 when request count reaches the limit', async () => {
      const now = Date.now();
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, MAX_REQUESTS], // Exactly at limit
        [null, 1],
        [null, 1],
      ]);
      (redisClient as unknown as { zrange: ReturnType<typeof vi.fn> }).zrange.mockResolvedValue([
        'entry1',
        String(now - 30_000), // Oldest entry is 30 seconds old
      ]);

      const req = createMockRequest({
        user: { sub: 'busy-user', email: 'busy@example.com', role: 'user', iat: 0, exp: 0 },
      }) as Request;
      const res = createMockResponse() as unknown as Response & {
        headers: Record<string, string>;
        body?: unknown;
      };

      await rateLimiter(req, res as unknown as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Too many requests' }),
      );
    });

    it('should return 429 when request count exceeds the limit', async () => {
      const now = Date.now();
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, 150], // Well over limit
        [null, 1],
        [null, 1],
      ]);
      (redisClient as unknown as { zrange: ReturnType<typeof vi.fn> }).zrange.mockResolvedValue([
        'entry1',
        String(now - 45_000), // Oldest entry is 45 seconds old
      ]);

      const req = createMockRequest({
        user: { sub: 'spammer', email: 'spam@example.com', role: 'user', iat: 0, exp: 0 },
      }) as Request;
      const res = createMockResponse() as unknown as Response & {
        headers: Record<string, string>;
        body?: unknown;
      };

      await rateLimiter(req, res as unknown as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('should set Retry-After header with seconds until oldest entry expires', async () => {
      const now = Date.now();
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, MAX_REQUESTS],
        [null, 1],
        [null, 1],
      ]);
      // Oldest entry is 40 seconds old, so it expires in 20 seconds
      (redisClient as unknown as { zrange: ReturnType<typeof vi.fn> }).zrange.mockResolvedValue([
        'entry1',
        String(now - 40_000),
      ]);

      const req = createMockRequest({
        user: { sub: 'limited-user', email: 'limit@example.com', role: 'user', iat: 0, exp: 0 },
      }) as Request;
      const res = createMockResponse() as unknown as Response & {
        headers: Record<string, string>;
        body?: unknown;
      };

      await rateLimiter(req, res as unknown as Response, mockNext);

      expect(res.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
      const retryAfter = parseInt(
        (res as { headers: Record<string, string> }).headers['Retry-After'],
        10,
      );
      // Should be approximately 20 seconds (60 - 40)
      expect(retryAfter).toBeGreaterThanOrEqual(19);
      expect(retryAfter).toBeLessThanOrEqual(21);
    });

    it('should include retryAfter in the JSON response body', async () => {
      const now = Date.now();
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, MAX_REQUESTS],
        [null, 1],
        [null, 1],
      ]);
      (redisClient as unknown as { zrange: ReturnType<typeof vi.fn> }).zrange.mockResolvedValue([
        'entry1',
        String(now - 10_000),
      ]);

      const req = createMockRequest({
        user: { sub: 'limited-user', email: 'limit@example.com', role: 'user', iat: 0, exp: 0 },
      }) as Request;
      const res = createMockResponse() as unknown as Response & {
        headers: Record<string, string>;
        body?: unknown;
      };

      await rateLimiter(req, res as unknown as Response, mockNext);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Too many requests',
          retryAfter: expect.any(Number),
        }),
      );
    });
  });

  describe('identifier resolution', () => {
    it('should use user ID for authenticated requests', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, 5],
        [null, 1],
        [null, 1],
      ]);

      const req = createMockRequest({
        user: { sub: 'user-abc', email: 'abc@example.com', role: 'user', iat: 0, exp: 0 },
      }) as Request;
      const res = createMockResponse() as Response;

      await rateLimiter(req, res, mockNext);

      // Verify the pipeline was called (Redis key will contain "user:user-abc")
      expect(mockPipeline.zremrangebyscore).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should use IP address for unauthenticated requests', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, 5],
        [null, 1],
        [null, 1],
      ]);

      const req = createMockRequest({
        ip: '10.0.0.1',
        user: undefined,
      }) as Request;
      const res = createMockResponse() as Response;

      await rateLimiter(req, res, mockNext);

      expect(mockPipeline.zremrangebyscore).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should fallback to socket remote address when ip is not available', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, 5],
        [null, 1],
        [null, 1],
      ]);

      const req = createMockRequest({
        ip: undefined,
        socket: { remoteAddress: '172.16.0.1' } as never,
        user: undefined,
      }) as Request;
      const res = createMockResponse() as Response;

      await rateLimiter(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('fail-open behavior', () => {
    it('should call next() when Redis pipeline returns an error', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [new Error('Redis error'), null], // zcard returns error
        [null, 1],
        [null, 1],
      ]);

      const req = createMockRequest({
        user: { sub: 'user-err', email: 'err@example.com', role: 'user', iat: 0, exp: 0 },
      }) as Request;
      const res = createMockResponse() as Response;

      await rateLimiter(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should call next() when Redis pipeline throws an exception', async () => {
      mockPipeline.exec.mockRejectedValue(new Error('Connection refused'));

      const req = createMockRequest({
        user: { sub: 'user-down', email: 'down@example.com', role: 'user', iat: 0, exp: 0 },
      }) as Request;
      const res = createMockResponse() as Response;

      await rateLimiter(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should call next() when pipeline exec returns null', async () => {
      mockPipeline.exec.mockResolvedValue(null);

      const req = createMockRequest({
        user: { sub: 'user-null', email: 'null@example.com', role: 'user', iat: 0, exp: 0 },
      }) as Request;
      const res = createMockResponse() as Response;

      await rateLimiter(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('configuration', () => {
    it('should use a 60-second window', () => {
      expect(WINDOW_SIZE_MS).toBe(60_000);
    });

    it('should allow 100 requests per window', () => {
      expect(MAX_REQUESTS).toBe(100);
    });
  });
});
