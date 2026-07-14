import type { Request, Response, NextFunction } from 'express';
import { redisClient } from '../redis.js';

/**
 * Rate Limiting Middleware
 *
 * Implements a Redis-backed sliding window rate limiter.
 * - Enforces 100 requests per minute per authenticated user (keyed by req.user.sub)
 * - Falls back to IP-based limiting for unauthenticated requests
 * - Returns 429 Too Many Requests with Retry-After header when limit exceeded
 *
 * Algorithm: Sliding window using Redis sorted sets.
 * - Each request adds a member with score = current timestamp (ms)
 * - Expired entries (older than 60s) are removed on each request
 * - Count of remaining entries determines if limit is exceeded
 *
 * Requirements: 3.4
 */

const WINDOW_SIZE_MS = 60_000; // 1 minute in milliseconds
const MAX_REQUESTS = 100;

/**
 * Get a rate limit identifier from the request.
 * Uses authenticated user ID if available, otherwise falls back to IP address.
 */
function getIdentifier(req: Request): string {
  if (req.user?.sub) {
    return `user:${req.user.sub}`;
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return `ip:${ip}`;
}

/**
 * Express middleware that enforces rate limiting using a Redis-backed sliding window.
 */
export async function rateLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const identifier = getIdentifier(req);
  const key = `rate_limit:${identifier}`;
  const now = Date.now();
  const windowStart = now - WINDOW_SIZE_MS;

  try {
    // Use a pipeline for atomicity and performance
    const pipeline = redisClient.pipeline();

    // Remove entries older than the sliding window
    pipeline.zremrangebyscore(key, 0, windowStart);

    // Count current entries in the window
    pipeline.zcard(key);

    // Add the current request
    pipeline.zadd(key, now, `${now}:${Math.random().toString(36).slice(2)}`);

    // Set TTL on the key to auto-cleanup (slightly longer than window)
    pipeline.expire(key, 120);

    const results = await pipeline.exec();

    // results[1] is the ZCARD result: [error, count]
    const countResult = results?.[1];
    if (!countResult || countResult[0]) {
      // If Redis errors, allow the request through (fail-open)
      next();
      return;
    }

    const requestCount = countResult[1] as number;

    if (requestCount >= MAX_REQUESTS) {
      // Calculate retry-after: seconds until the oldest entry in the window expires
      const oldestEntries = await redisClient.zrange(key, 0, 0, 'WITHSCORES');
      let retryAfter = 60; // Default to full window

      if (oldestEntries.length >= 2) {
        const oldestTimestamp = parseInt(oldestEntries[1], 10);
        const expiresAt = oldestTimestamp + WINDOW_SIZE_MS;
        retryAfter = Math.max(1, Math.ceil((expiresAt - now) / 1000));
      }

      res.set('Retry-After', String(retryAfter));
      res.status(429).json({
        error: 'Too many requests',
        retryAfter,
      });
      return;
    }

    next();
  } catch {
    // Fail-open: if Redis is unavailable, allow the request
    next();
  }
}

export { WINDOW_SIZE_MS, MAX_REQUESTS };
