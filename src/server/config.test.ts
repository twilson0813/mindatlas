import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

describe('Config', () => {
  it('should load default configuration values', () => {
    const cfg = loadConfig();

    expect(cfg.port).toBe(3000);
    expect(typeof cfg.nodeEnv).toBe('string');
    expect(cfg.databaseUrl).toContain('postgresql://');
    expect(cfg.redisUrl).toContain('redis://');
  });

  it('should respect PORT environment variable', () => {
    const originalPort = process.env.PORT;
    process.env.PORT = '8080';

    const cfg = loadConfig();
    expect(cfg.port).toBe(8080);

    if (originalPort !== undefined) {
      process.env.PORT = originalPort;
    } else {
      delete process.env.PORT;
    }
  });
});
