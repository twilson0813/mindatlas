import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import express from 'express';
import { config } from '../config.js';

/**
 * Integration tests for the items API routes.
 * Tests route-level behavior: auth enforcement, validation, status codes, and response shapes.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4
 */

// Mock the item service
vi.mock('../services/items/index.js', () => ({
  createItem: vi.fn(),
  getItem: vi.fn(),
  listItems: vi.fn(),
  deleteItem: vi.fn(),
  getItemRelationships: vi.fn(),
  VALID_CONTENT_TYPES: [
    'plain_text',
    'link',
    'code_snippet',
    'note',
    'task',
    'idea',
    'file',
    'custom',
  ],
  validateItemInput: vi.fn(),
}));

// Mock Redis for rate limiter (fail-open behavior)
vi.mock('../redis.js', () => {
  const mockPipeline = {
    zremrangebyscore: vi.fn().mockReturnThis(),
    zcard: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([
      [null, 0], // zremrangebyscore
      [null, 1], // zcard - count below limit
      [null, 1], // zadd
      [null, 1], // expire
    ]),
  };
  return {
    redisClient: {
      pipeline: () => mockPipeline,
      zrange: vi.fn().mockResolvedValue([]),
    },
  };
});

// Mock the AI processing queue
vi.mock('../queues.js', () => ({
  aiProcessingQueue: {
    add: vi.fn().mockResolvedValue({}),
  },
}));

// Mock encryption utilities
vi.mock('../utils/encryption.js', () => ({
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
  decrypt: vi.fn((value: string) => value.replace('encrypted:', '')),
}));

// Mock database
vi.mock('../db/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

// Mock sanitization (used by validation middleware)
vi.mock('../utils/sanitization.js', () => ({
  sanitizeHtml: vi.fn((value: string) => value),
}));

import {
  createItem,
  getItem,
  listItems,
  deleteItem,
  getItemRelationships,
} from '../services/items/index.js';
import itemsRouter from './items.js';

// Build a minimal app for testing
function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/items', itemsRouter);
  return app;
}

function generateValidToken(userId = 'user-123', email = 'test@example.com') {
  return jwt.sign({ sub: userId, email, role: 'user' }, config.jwtSecret, { expiresIn: '15m' });
}

describe('Items API Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.mocked(createItem).mockReset();
    vi.mocked(getItem).mockReset();
    vi.mocked(listItems).mockReset();
    vi.mocked(deleteItem).mockReset();
    vi.mocked(getItemRelationships).mockReset();
    app = buildTestApp();
  });

  describe('Authentication enforcement', () => {
    it('should return 401 for requests without auth token', async () => {
      const response = await request(app).get('/api/items');
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
    });

    it('should return 401 for requests with invalid token', async () => {
      const response = await request(app)
        .get('/api/items')
        .set('Authorization', 'Bearer invalid-token');
      expect(response.status).toBe(401);
    });

    it('should return 401 for requests with expired token', async () => {
      const expiredToken = jwt.sign(
        { sub: 'user-123', email: 'test@example.com', role: 'user' },
        config.jwtSecret,
        { expiresIn: '-1s' },
      );
      const response = await request(app)
        .get('/api/items')
        .set('Authorization', `Bearer ${expiredToken}`);
      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/items', () => {
    it('should create an item and return 201', async () => {
      const mockItem = {
        id: 'item-1',
        user_id: 'user-123',
        title: null,
        content: 'Test content',
        content_type: 'plain_text',
        metadata: null,
        source_channel: 'api',
        source_domain: null,
        file_path: null,
        file_size: null,
        is_deleted: false,
        deleted_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      vi.mocked(createItem).mockResolvedValue(mockItem as any);

      const token = generateValidToken();
      const response = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'Test content', content_type: 'plain_text' });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('item-1');
      expect(response.body.content).toBe('Test content');
      expect(createItem).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          content: 'Test content',
          content_type: 'plain_text',
          source_channel: 'api',
        }),
      );
    });

    it('should return 400 when content is missing', async () => {
      const token = generateValidToken();
      const response = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ content_type: 'plain_text' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 400 when content is empty', async () => {
      const token = generateValidToken();
      const response = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ content: '   ' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 400 for invalid content_type', async () => {
      const token = generateValidToken();
      const response = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'Some text', content_type: 'invalid_type' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should accept item without content_type (defaults to plain_text)', async () => {
      const mockItem = {
        id: 'item-2',
        user_id: 'user-123',
        content: 'No type specified',
        content_type: 'plain_text',
        metadata: null,
        source_channel: 'api',
        is_deleted: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      vi.mocked(createItem).mockResolvedValue(mockItem as any);

      const token = generateValidToken();
      const response = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'No type specified' });

      expect(response.status).toBe(201);
      expect(createItem).toHaveBeenCalled();
    });

    it('should return service error status codes', async () => {
      const serviceError = new Error('Validation failed: Content is required');
      (serviceError as any).statusCode = 400;
      vi.mocked(createItem).mockRejectedValue(serviceError);

      const token = generateValidToken();
      const response = await request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'Valid content' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Validation failed');
    });
  });

  describe('GET /api/items', () => {
    it('should list items with default pagination', async () => {
      const mockResult = {
        items: [{ id: 'item-1', content: 'Test' }],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      };

      vi.mocked(listItems).mockResolvedValue(mockResult as any);

      const token = generateValidToken();
      const response = await request(app).get('/api/items').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.total).toBe(1);
      expect(listItems).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          page: undefined,
          page_size: undefined,
        }),
      );
    });

    it('should pass filter query params to listItems', async () => {
      vi.mocked(listItems).mockResolvedValue({
        items: [],
        total: 0,
        page: 2,
        page_size: 10,
        total_pages: 0,
      } as any);

      const token = generateValidToken();
      const response = await request(app)
        .get('/api/items?category=tech&tag=javascript&page=2&page_size=10&keyword=test')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(listItems).toHaveBeenCalledWith('user-123', {
        category: 'tech',
        tag: 'javascript',
        date_from: undefined,
        date_to: undefined,
        keyword: 'test',
        page: 2,
        page_size: 10,
      });
    });

    it('should pass date range filters', async () => {
      vi.mocked(listItems).mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        page_size: 20,
        total_pages: 0,
      } as any);

      const token = generateValidToken();
      const response = await request(app)
        .get('/api/items?date_from=2024-01-01&date_to=2024-12-31')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(listItems).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          date_from: '2024-01-01',
          date_to: '2024-12-31',
        }),
      );
    });
  });

  describe('GET /api/items/:id', () => {
    it('should return an item by ID', async () => {
      const mockItem = {
        id: 'item-abc',
        user_id: 'user-123',
        content: 'Detailed content',
        content_type: 'note',
        created_at: new Date().toISOString(),
      };

      vi.mocked(getItem).mockResolvedValue(mockItem as any);

      const token = generateValidToken();
      const response = await request(app)
        .get('/api/items/item-abc')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('item-abc');
      expect(getItem).toHaveBeenCalledWith('user-123', 'item-abc');
    });

    it('should return 404 for non-existent item', async () => {
      const error = new Error('Item not found');
      (error as any).statusCode = 404;
      vi.mocked(getItem).mockRejectedValue(error);

      const token = generateValidToken();
      const response = await request(app)
        .get('/api/items/nonexistent')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Item not found');
    });

    it('should return 403 when accessing another users item', async () => {
      const error = new Error('Access denied: you do not own this item');
      (error as any).statusCode = 403;
      vi.mocked(getItem).mockRejectedValue(error);

      const token = generateValidToken();
      const response = await request(app)
        .get('/api/items/other-users-item')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Access denied');
    });
  });

  describe('DELETE /api/items/:id', () => {
    it('should soft-delete an item and return 204', async () => {
      vi.mocked(deleteItem).mockResolvedValue(undefined);

      const token = generateValidToken();
      const response = await request(app)
        .delete('/api/items/item-to-delete')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(204);
      expect(deleteItem).toHaveBeenCalledWith('user-123', 'item-to-delete');
    });

    it('should return 404 for non-existent item', async () => {
      const error = new Error('Item not found');
      (error as any).statusCode = 404;
      vi.mocked(deleteItem).mockRejectedValue(error);

      const token = generateValidToken();
      const response = await request(app)
        .delete('/api/items/nonexistent')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Item not found');
    });

    it('should return 403 when deleting another users item', async () => {
      const error = new Error('Access denied: you do not own this item');
      (error as any).statusCode = 403;
      vi.mocked(deleteItem).mockRejectedValue(error);

      const token = generateValidToken();
      const response = await request(app)
        .delete('/api/items/other-users-item')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Access denied');
    });
  });

  describe('GET /api/items/:id/relationships', () => {
    it('should return relationships for an item', async () => {
      const mockRelationships = [
        {
          id: 'rel-1',
          source_item_id: 'item-abc',
          target_item_id: 'item-def',
          relationship_type: 'related',
          strength: 0.85,
          created_at: new Date().toISOString(),
        },
      ];

      vi.mocked(getItemRelationships).mockResolvedValue(mockRelationships as any);

      const token = generateValidToken();
      const response = await request(app)
        .get('/api/items/item-abc/relationships')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].relationship_type).toBe('related');
      expect(getItemRelationships).toHaveBeenCalledWith('user-123', 'item-abc');
    });

    it('should return 404 for non-existent item', async () => {
      const error = new Error('Item not found or access denied');
      (error as any).statusCode = 404;
      vi.mocked(getItemRelationships).mockRejectedValue(error);

      const token = generateValidToken();
      const response = await request(app)
        .get('/api/items/nonexistent/relationships')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('Item not found');
    });

    it('should return empty array when no relationships exist', async () => {
      vi.mocked(getItemRelationships).mockResolvedValue([]);

      const token = generateValidToken();
      const response = await request(app)
        .get('/api/items/item-lonely/relationships')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });
});
