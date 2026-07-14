import Redis, { type RedisOptions } from 'ioredis';
import { config } from './config.js';
import { createChildLogger } from './logger.js';

const log = createChildLogger({ module: 'redis' });

/**
 * Redis connection options shared across clients.
 * Uses connection pooling via ioredis built-in connection management.
 */
const redisOptions: RedisOptions = {
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: true,
  retryStrategy(times: number) {
    const delay = Math.min(times * 200, 5000);
    log.warn({ attempt: times, delay }, 'Redis connection retry');
    return delay;
  },
  reconnectOnError(err: Error) {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
    return targetErrors.some((e) => err.message.includes(e));
  },
};

/**
 * Primary Redis client for general application use (caching, rate limiting, entitlements).
 */
export const redisClient = new Redis(config.redisUrl, redisOptions);

/**
 * Creates a new Redis connection for use by BullMQ queues and workers.
 * BullMQ requires its own connection instances.
 */
export function createRedisConnection(): Redis {
  return new Redis(config.redisUrl, redisOptions);
}

// Connection event handlers
redisClient.on('connect', () => {
  log.info('Redis client connected');
});

redisClient.on('ready', () => {
  log.info('Redis client ready');
});

redisClient.on('error', (err: Error) => {
  log.error({ err: err.message }, 'Redis client error');
});

redisClient.on('close', () => {
  log.warn('Redis client connection closed');
});

/**
 * Gracefully disconnect the Redis client.
 * Should be called during application shutdown.
 */
export async function disconnectRedis(): Promise<void> {
  await redisClient.quit();
  log.info('Redis client disconnected');
}
