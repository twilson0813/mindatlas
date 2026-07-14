import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Request, Response } from 'express';

// Mock database
vi.mock('../db/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

// Mock items service (transitive dep from integrations)
vi.mock('../services/items/index.js', () => ({
  createItem: vi.fn(),
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

import { query } from '../db/db.js';
import { authenticateApiKey, authenticateTokenOrApiKey } from './apiKeyAuth.js';
import { findActiveKeyByHash } from '../services/integrations/index.js';

const mockQuery = vi.mocked(query);

// Mock findActiveKeyByHash at the module level
vi.mock('../services/integrations/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/integrations/index.js')>();
  return {
    ...actual,
    findActiveKeyByHash: vi.fn(),
    updateKeyLastUsed: vi.fn().mockResolvedValue(undefined),
  };
});

const mockFindActiveKey = vi.mocked(findActiveKeyByHash);

function createTestApp(middleware: typeof authenticateApiKey) {
  const app = express();
  app.use(express.json());
  app.use(middleware);
  app.get('/test', (req: Request, res: Response) => {
    res.json({ user: req.user });
  });
  return app;
}

describe('authenticateApiKey middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when no X-API-Key header is provided', async () => {
    const app = createTestApp(authenticateApiKey);
    const response = await request(app).get('/test');
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('API key required');
  });

  it('should return 401 when API key is invalid', async () => {
    mockFindActiveKey.mockResolvedValue(null);

    const app = createTestApp(authenticateApiKey);
    const response = await request(app)
      .get('/test')
      .set('X-API-Key', 'ma_invalid_key');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Invalid or revoked API key');
  });

  it('should authenticate successfully with valid API key', async () => {
    mockFindActiveKey.mockResolvedValue({
      id: 'key-1',
      user_id: 'user-123',
      key_hash: 'hash',
      label: 'Test',
      is_active: true,
      last_used_at: null,
      created_at: new Date(),
    });

    mockQuery.mockResolvedValue({
      rows: [{ id: 'user-123', email: 'test@example.com', role: 'user' }],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const app = createTestApp(authenticateApiKey);
    const response = await request(app)
      .get('/test')
      .set('X-API-Key', 'ma_validkey');

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      sub: 'user-123',
      email: 'test@example.com',
      role: 'user',
    });
    // Should have iat and exp fields
    expect(response.body.user.iat).toBeDefined();
    expect(response.body.user.exp).toBeDefined();
  });

  it('should return 401 when user is not found for the key', async () => {
    mockFindActiveKey.mockResolvedValue({
      id: 'key-1',
      user_id: 'deleted-user',
      key_hash: 'hash',
      label: 'Test',
      is_active: true,
      last_used_at: null,
      created_at: new Date(),
    });

    mockQuery.mockResolvedValue({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const app = createTestApp(authenticateApiKey);
    const response = await request(app)
      .get('/test')
      .set('X-API-Key', 'ma_orphankey');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('User not found');
  });
});

describe('authenticateTokenOrApiKey middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when neither auth method is provided', async () => {
    const app = createTestApp(authenticateTokenOrApiKey as typeof authenticateApiKey);
    const response = await request(app).get('/test');
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Authentication required');
  });

  it('should use API key auth when X-API-Key header is provided', async () => {
    mockFindActiveKey.mockResolvedValue({
      id: 'key-1',
      user_id: 'user-abc',
      key_hash: 'hash',
      label: 'Test',
      is_active: true,
      last_used_at: null,
      created_at: new Date(),
    });

    mockQuery.mockResolvedValue({
      rows: [{ id: 'user-abc', email: 'api@example.com', role: 'user' }],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const app = createTestApp(authenticateTokenOrApiKey as typeof authenticateApiKey);
    const response = await request(app)
      .get('/test')
      .set('X-API-Key', 'ma_somekey');

    expect(response.status).toBe(200);
    expect(response.body.user.sub).toBe('user-abc');
  });
});
