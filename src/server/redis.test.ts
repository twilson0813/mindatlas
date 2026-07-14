import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ioredis before importing the module
vi.mock('ioredis', () => {
  const mockRedis = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue('OK'),
    status: 'ready',
  }));
  return { default: mockRedis };
});

// Mock config
vi.mock('./config.js', () => ({
  config: {
    redisUrl: 'redis://localhost:6379',
    nodeEnv: 'test',
  },
}));

// Mock logger
vi.mock('./logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Redis Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export redisClient', async () => {
    const { redisClient } = await import('./redis.js');
    expect(redisClient).toBeDefined();
  });

  it('should export createRedisConnection function', async () => {
    const { createRedisConnection } = await import('./redis.js');
    expect(typeof createRedisConnection).toBe('function');
  });

  it('should create new Redis instance from createRedisConnection', async () => {
    const { createRedisConnection } = await import('./redis.js');
    const conn = createRedisConnection();
    expect(conn).toBeDefined();
    expect(conn.on).toBeDefined();
  });

  it('should export disconnectRedis function', async () => {
    const { disconnectRedis } = await import('./redis.js');
    expect(typeof disconnectRedis).toBe('function');
  });
});
