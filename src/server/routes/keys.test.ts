import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import keysRouter from './keys.js';

// Mock integrations service
vi.mock('../services/integrations/index.js', () => ({
  generateApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  hashApiKey: vi.fn(),
  findActiveKeyByHash: vi.fn(),
  updateKeyLastUsed: vi.fn(),
}));

// Mock database
vi.mock('../db/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

// Mock logger
vi.mock('../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock queues
vi.mock('../queues.js', () => ({
  aiProcessingQueue: { add: vi.fn() },
}));

// Mock items service
vi.mock('../services/items/index.js', () => ({
  createItem: vi.fn(),
}));

// Mock Redis for rate limiter
vi.mock('../redis.js', () => ({
  getRedisClient: () => ({
    multi: () => ({
      zremrangebyscore: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([null, null, [null, 0], null]),
    }),
  }),
}));

// Mock config
vi.mock('../config.js', () => ({
  config: {
    jwtSecret: 'test-secret',
    jwtRefreshSecret: 'test-refresh-secret',
  },
}));

import { generateApiKey, revokeApiKey, listApiKeys } from '../services/integrations/index.js';

const mockGenerateApiKey = vi.mocked(generateApiKey);
const mockRevokeApiKey = vi.mocked(revokeApiKey);
const mockListApiKeys = vi.mocked(listApiKeys);

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/keys', keysRouter);
  return app;
}

function generateTestToken(userId: string = 'user-123'): string {
  return jwt.sign({ sub: userId, email: 'test@example.com', role: 'user' }, 'test-secret', {
    expiresIn: '15m',
  });
}

describe('API Key Management Routes', () => {
  let app: express.Express;
  let token: string;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
    token = generateTestToken();
  });

  describe('GET /api/keys', () => {
    it('should list all keys for authenticated user', async () => {
      mockListApiKeys.mockResolvedValue([
        {
          id: 'k1',
          label: 'Key 1',
          is_active: true,
          last_used_at: null,
          created_at: new Date('2024-01-01'),
        },
        {
          id: 'k2',
          label: 'Key 2',
          is_active: false,
          last_used_at: new Date('2024-06-01'),
          created_at: new Date('2024-02-01'),
        },
      ]);

      const response = await request(app).get('/api/keys').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.keys).toHaveLength(2);
      expect(response.body.keys[0].label).toBe('Key 1');
      expect(mockListApiKeys).toHaveBeenCalledWith('user-123');
    });

    it('should return 401 without auth', async () => {
      const response = await request(app).get('/api/keys');
      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/keys', () => {
    it('should generate a new API key', async () => {
      mockGenerateApiKey.mockResolvedValue({
        id: 'key-new',
        key: 'ma_abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        label: 'My New Key',
        created_at: new Date('2024-01-15'),
      });

      const response = await request(app)
        .post('/api/keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ label: 'My New Key' });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('key-new');
      expect(response.body.key).toMatch(/^ma_/);
      expect(response.body.label).toBe('My New Key');
      expect(mockGenerateApiKey).toHaveBeenCalledWith('user-123', 'My New Key');
    });

    it('should return 400 for missing label', async () => {
      const error = new Error('API key label is required') as Error & { statusCode?: number };
      error.statusCode = 400;
      mockGenerateApiKey.mockRejectedValue(error);

      const response = await request(app)
        .post('/api/keys')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('label is required');
    });

    it('should return 401 without auth', async () => {
      const response = await request(app).post('/api/keys').send({ label: 'test' });

      expect(response.status).toBe(401);
    });
  });

  describe('DELETE /api/keys/:id', () => {
    it('should revoke an API key', async () => {
      mockRevokeApiKey.mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/api/keys/key-123')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(204);
      expect(mockRevokeApiKey).toHaveBeenCalledWith('user-123', 'key-123');
    });

    it('should return 404 for non-existent key', async () => {
      const error = new Error('API key not found or already revoked') as Error & {
        statusCode?: number;
      };
      error.statusCode = 404;
      mockRevokeApiKey.mockRejectedValue(error);

      const response = await request(app)
        .delete('/api/keys/nonexistent')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found');
    });

    it('should return 401 without auth', async () => {
      const response = await request(app).delete('/api/keys/key-123');
      expect(response.status).toBe(401);
    });
  });
});
