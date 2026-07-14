import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import express from 'express';
import { config } from '../config.js';

/**
 * Integration tests for CSV export and template API routes.
 * Tests route-level behavior: auth enforcement, response types, and status codes.
 *
 * Validates: Requirements 13.7, 13.8, 13.9, 13.12, 13.13
 */

// Mock the CSV service
vi.mock('../services/csv/index.js', () => ({
  importCsv: vi.fn(),
  exportItems: vi.fn(),
  exportMaps: vi.fn(),
  getTemplate: vi.fn(),
  MAX_CSV_FILE_SIZE: 10 * 1024 * 1024,
}));

// Mock Redis for rate limiter and entitlement middleware
vi.mock('../redis.js', () => {
  const mockPipeline = {
    zremrangebyscore: vi.fn().mockReturnThis(),
    zcard: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([
      [null, 0],
      [null, 1],
      [null, 1],
      [null, 1],
    ]),
  };
  return {
    redisClient: {
      pipeline: () => mockPipeline,
      zrange: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(JSON.stringify(['input.csv', 'input.sms', 'input.api'])),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    },
  };
});

// Mock database
vi.mock('../db/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

// Mock encryption
vi.mock('../utils/encryption.js', () => ({
  encrypt: vi.fn((v: string) => `encrypted:${v}`),
  decrypt: vi.fn((v: string) => v.replace('encrypted:', '')),
}));

// Mock queues
vi.mock('../queues.js', () => ({
  aiProcessingQueue: { add: vi.fn() },
}));

import { exportItems, exportMaps, getTemplate } from '../services/csv/index.js';
import csvRouter from './csv.js';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/csv', csvRouter);
  return app;
}

function generateValidToken(userId = 'user-123', email = 'test@example.com') {
  return jwt.sign(
    { sub: userId, email, role: 'user' },
    config.jwtSecret,
    { expiresIn: '15m' }
  );
}

describe('CSV Export Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildTestApp();
  });

  describe('Authentication enforcement', () => {
    it('should return 401 for GET /export/items without auth', async () => {
      const response = await request(app).get('/api/csv/export/items');
      expect(response.status).toBe(401);
    });

    it('should return 401 for GET /export/maps without auth', async () => {
      const response = await request(app).get('/api/csv/export/maps');
      expect(response.status).toBe(401);
    });

    it('should return 401 for GET /template without auth', async () => {
      const response = await request(app).get('/api/csv/template');
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/csv/export/items', () => {
    it('should return CSV file with correct content-type and disposition', async () => {
      const csvContent = 'content,content_type,tags,creation_date,metadata\nHello,plain_text,tag1,2024-01-01T00:00:00.000Z,\n';
      vi.mocked(exportItems).mockResolvedValue(Buffer.from(csvContent));

      const token = generateValidToken();
      const response = await request(app)
        .get('/api/csv/export/items')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('items_export.csv');
      expect(response.text).toBe(csvContent);
    });

    it('should call exportItems with authenticated user ID', async () => {
      vi.mocked(exportItems).mockResolvedValue(Buffer.from('content\n'));

      const token = generateValidToken('user-abc');
      await request(app)
        .get('/api/csv/export/items')
        .set('Authorization', `Bearer ${token}`);

      expect(exportItems).toHaveBeenCalledWith('user-abc');
    });

    it('should return 500 when exportItems throws', async () => {
      vi.mocked(exportItems).mockRejectedValue(new Error('Database error'));

      const token = generateValidToken();
      const response = await request(app)
        .get('/api/csv/export/items')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Database error');
    });
  });

  describe('GET /api/csv/export/maps', () => {
    it('should return CSV file with correct content-type and disposition', async () => {
      const csvContent = 'source_item_id,target_item_id,relationship_type,confidence_score\nitem-a,item-b,related,0.85\n';
      vi.mocked(exportMaps).mockResolvedValue(Buffer.from(csvContent));

      const token = generateValidToken();
      const response = await request(app)
        .get('/api/csv/export/maps')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('maps_export.csv');
      expect(response.text).toBe(csvContent);
    });

    it('should call exportMaps with authenticated user ID', async () => {
      vi.mocked(exportMaps).mockResolvedValue(Buffer.from('header\n'));

      const token = generateValidToken('user-xyz');
      await request(app)
        .get('/api/csv/export/maps')
        .set('Authorization', `Bearer ${token}`);

      expect(exportMaps).toHaveBeenCalledWith('user-xyz');
    });

    it('should return 500 when exportMaps throws', async () => {
      vi.mocked(exportMaps).mockRejectedValue(new Error('Query failed'));

      const token = generateValidToken();
      const response = await request(app)
        .get('/api/csv/export/maps')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Query failed');
    });
  });

  describe('GET /api/csv/template', () => {
    it('should return CSV template with correct headers', async () => {
      const templateContent = 'content,content_type,tags,metadata\nExample,note,tag1,{}\n';
      vi.mocked(getTemplate).mockReturnValue(Buffer.from(templateContent));

      const token = generateValidToken();
      const response = await request(app)
        .get('/api/csv/template')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('import_template.csv');
      expect(response.text).toBe(templateContent);
    });

    it('should return 500 when getTemplate throws', async () => {
      vi.mocked(getTemplate).mockImplementation(() => {
        throw new Error('Template generation failed');
      });

      const token = generateValidToken();
      const response = await request(app)
        .get('/api/csv/template')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Template generation failed');
    });
  });
});
