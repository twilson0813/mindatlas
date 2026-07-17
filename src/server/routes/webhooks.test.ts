import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import webhooksRouter from './webhooks.js';

// Mock the integrations service
vi.mock('../services/integrations/index.js', () => ({
  handleWebhook: vi.fn(),
  hashApiKey: vi.fn().mockReturnValue('mock-hash'),
  findActiveKeyByHash: vi.fn(),
  updateKeyLastUsed: vi.fn().mockResolvedValue(undefined),
}));

// Mock the database
vi.mock('../db/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

// Mock Redis for entitlement middleware
vi.mock('../redis.js', () => ({
  redisClient: {
    get: vi.fn(() =>
      Promise.resolve(JSON.stringify(['integration.n8n', 'input.api', 'input.csv'])),
    ),
    set: vi.fn(() => Promise.resolve('OK')),
    del: vi.fn(() => Promise.resolve(1)),
  },
}));

// Mock the entitlement middleware to pass-through (entitlement logic tested separately)
vi.mock('../middleware/entitlement.js', () => ({
  requireEntitlement: () => (_req: any, _res: any, next: any) => next(),
  loadEntitlements: vi.fn(() => Promise.resolve(['integration.n8n'])),
  invalidateCache: vi.fn(() => Promise.resolve()),
}));

// Mock the logger
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

import { handleWebhook, findActiveKeyByHash } from '../services/integrations/index.js';
import { query } from '../db/db.js';

const mockHandleWebhook = vi.mocked(handleWebhook);
const mockFindActiveKey = vi.mocked(findActiveKeyByHash);
const mockQuery = vi.mocked(query);

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/webhooks', webhooksRouter);
  return app;
}

describe('POST /api/webhooks/n8n', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();

    // Set up successful API key auth by default
    mockFindActiveKey.mockResolvedValue({
      id: 'key-1',
      user_id: 'user-123',
      key_hash: 'mock-hash',
      label: 'n8n Integration',
      is_active: true,
      last_used_at: null,
      created_at: new Date(),
    });

    mockQuery.mockResolvedValue({
      rows: [{ id: 'user-123', email: 'user@example.com', role: 'user' }],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });
  });

  it('should create an item from webhook payload', async () => {
    const mockItem = {
      id: 'item-1',
      user_id: 'user-123',
      content: 'Webhook content',
      content_type: 'plain_text',
      title: 'From n8n',
      metadata: null,
      source_channel: 'webhook',
      source_domain: 'n8n',
      file_path: null,
      file_size: null,
      is_deleted: false,
      deleted_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    mockHandleWebhook.mockResolvedValue(mockItem);

    const response = await request(app)
      .post('/api/webhooks/n8n')
      .set('X-API-Key', 'ma_validkey')
      .send({
        content: 'Webhook content',
        title: 'From n8n',
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBe('item-1');
    expect(mockHandleWebhook).toHaveBeenCalledWith('user-123', {
      content: 'Webhook content',
      title: 'From n8n',
    });
  });

  it('should return 401 without API key', async () => {
    mockFindActiveKey.mockResolvedValue(null);

    const response = await request(app).post('/api/webhooks/n8n').send({ content: 'test' });

    expect(response.status).toBe(401);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });

  it('should return 400 for invalid payload', async () => {
    const error = new Error('Webhook payload must include non-empty "content" field') as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    mockHandleWebhook.mockRejectedValue(error);

    const response = await request(app)
      .post('/api/webhooks/n8n')
      .set('X-API-Key', 'ma_validkey')
      .send({ content: '' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('non-empty "content"');
  });

  it('should return 500 on unexpected errors', async () => {
    mockHandleWebhook.mockRejectedValue(new Error('DB connection failed'));

    const response = await request(app)
      .post('/api/webhooks/n8n')
      .set('X-API-Key', 'ma_validkey')
      .send({ content: 'test' });

    expect(response.status).toBe(500);
  });
});
