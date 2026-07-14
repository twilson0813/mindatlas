import { describe, it, expect, afterEach, vi } from 'vitest';
import { getPoolConfig, getPool, closePool } from './db.js';

describe('Database module', () => {
  afterEach(async () => {
    await closePool();
  });

  describe('getPoolConfig', () => {
    it('should return a valid pool configuration', () => {
      const config = getPoolConfig();

      expect(config).toHaveProperty('connectionString');
      expect(config).toHaveProperty('max');
      expect(config).toHaveProperty('idleTimeoutMillis');
      expect(config).toHaveProperty('connectionTimeoutMillis');
      expect(config.max).toBe(20);
      expect(config.idleTimeoutMillis).toBe(30000);
      expect(config.connectionTimeoutMillis).toBe(5000);
    });

    it('should use DATABASE_URL from config', () => {
      const config = getPoolConfig();
      expect(config.connectionString).toContain('postgresql');
    });
  });

  describe('getPool', () => {
    it('should return a Pool instance', () => {
      const pool = getPool();
      expect(pool).toBeDefined();
      expect(pool).toHaveProperty('query');
      expect(pool).toHaveProperty('connect');
      expect(pool).toHaveProperty('end');
    });

    it('should return the same pool on subsequent calls', () => {
      const pool1 = getPool();
      const pool2 = getPool();
      expect(pool1).toBe(pool2);
    });
  });

  describe('closePool', () => {
    it('should allow getting a new pool after closing', async () => {
      const pool1 = getPool();
      await closePool();
      const pool2 = getPool();
      expect(pool1).not.toBe(pool2);
    });
  });
});
