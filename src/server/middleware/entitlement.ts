import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { redisClient } from '../redis.js';
import { queryOne, queryMany } from '../db/db.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger({ module: 'entitlement' });

/**
 * Redis key prefix for plan entitlements cache.
 */
const CACHE_KEY_PREFIX = 'entitlements:';

/**
 * Cache TTL in seconds (1 hour). Cache is also invalidated on admin changes.
 */
const CACHE_TTL_SECONDS = 3600;

/**
 * Loads entitled feature keys for a plan from Redis cache.
 * Falls back to DB if cache miss, then populates cache.
 *
 * Requirements: 18.14 — read feature entitlements from admin-configured plan definitions at runtime
 */
export async function loadEntitlements(planId: string): Promise<string[]> {
  const cacheKey = `${CACHE_KEY_PREFIX}${planId}`;

  // Try Redis cache first
  const cached = await redisClient.get(cacheKey);
  if (cached !== null) {
    log.debug({ planId }, 'Entitlements loaded from cache');
    return JSON.parse(cached) as string[];
  }

  // Cache miss — load from database
  const rows = await queryMany<{ feature_key: string }>(
    `SELECT feature_key FROM plan_entitlements WHERE plan_id = $1 AND enabled = true`,
    [planId],
  );

  const features = rows.map((row) => row.feature_key);

  // Populate cache
  await redisClient.set(cacheKey, JSON.stringify(features), 'EX', CACHE_TTL_SECONDS);
  log.debug({ planId, featureCount: features.length }, 'Entitlements loaded from DB and cached');

  return features;
}

/**
 * Invalidates the Redis cache for a given plan's entitlements.
 * Called when an admin changes feature entitlements so changes take effect immediately.
 *
 * Requirements: 18.14 — changes take effect immediately
 */
export async function invalidateCache(planId: string): Promise<void> {
  const cacheKey = `${CACHE_KEY_PREFIX}${planId}`;
  await redisClient.del(cacheKey);
  log.info({ planId }, 'Entitlement cache invalidated');
}

/**
 * Middleware factory that checks if the authenticated user's plan
 * includes the specified feature. Returns 402 Payment Required if not.
 *
 * Requirements: 18.12 — return 402 when user attempts to use feature not in their plan
 * Requirements: 18.14 — read entitlements from admin-configured plan definitions at runtime
 *
 * Usage:
 *   router.post('/api/sms/incoming', requireEntitlement('input.sms'), smsHandler);
 *   router.post('/api/ai/query', requireEntitlement('ai.natural_language'), aiQueryHandler);
 */
export function requireEntitlement(featureKey: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      // Look up user's plan — defaults to 'free' if no subscription found
      const subscription = await queryOne<{ plan_id: string }>(
        `SELECT plan_id FROM subscriptions WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
        [userId],
      );

      const planId = subscription?.plan_id ?? 'free';

      // Load entitled features for the plan
      const entitledFeatures = await loadEntitlements(planId);

      if (entitledFeatures.includes(featureKey)) {
        next();
        return;
      }

      log.info({ userId, featureKey, planId }, 'Feature access denied — not in plan');
      res.status(402).json({
        error: 'Feature not available in your plan',
        feature: featureKey,
      });
    } catch (error) {
      next(error);
    }
  };
}
