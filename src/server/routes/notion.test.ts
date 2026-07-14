import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock all dependencies
vi.mock('../middleware/auth.js', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { sub: 'user-1', email: 'test@test.com', role: 'user', iat: 0, exp: 9999999999 };
    next();
  },
}));

vi.mock('../middleware/rateLimiter.js', () => ({
  rateLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../middleware/entitlement.js', () => ({
  requireEntitlement: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/integrations/notion.js', () => ({
  connectNotion: vi.fn(),
  importFromNotion: vi.fn(),
  exportToNotion: vi.fn(),
  getConnection: vi.fn(),
  disconnectNotion: vi.fn(),
}));

import notionRouter from './notion.js';
import {
  connectNotion,
  importFromNotion,
  exportToNotion,
  getConnection,
  disconnectNotion,
} from '../services/integrations/notion.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations/notion', notionRouter);
  return app;
}

describe('Notion Routes', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  describe('POST /api/integrations/notion/connect', () => {
    it('should return 201 with connection details on success', async () => {
      const mockConnection = {
        id: 'conn-1',
        workspace_id: 'ws-123',
        workspace_name: 'My Workspace',
        connected_at: new Date('2024-01-01').toISOString(),
      };
      (connectNotion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockConnection);

      const res = await request(app)
        .post('/api/integrations/notion/connect')
        .send({ code: 'oauth_code_123' })
        .expect(201);

      expect(res.body).toMatchObject({
        workspace_id: 'ws-123',
        workspace_name: 'My Workspace',
      });
      expect(connectNotion).toHaveBeenCalledWith('user-1', 'oauth_code_123');
    });

    it('should return 400 when code is missing', async () => {
      const error = new Error('Authorization code is required') as Error & { statusCode?: number };
      error.statusCode = 400;
      (connectNotion as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

      const res = await request(app)
        .post('/api/integrations/notion/connect')
        .send({})
        .expect(400);

      expect(res.body.error).toBe('Authorization code is required');
    });

    it('should return 502 when Notion rejects the code', async () => {
      const error = new Error('Failed to exchange authorization code with Notion') as Error & { statusCode?: number };
      error.statusCode = 502;
      (connectNotion as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

      const res = await request(app)
        .post('/api/integrations/notion/connect')
        .send({ code: 'bad_code' })
        .expect(502);

      expect(res.body.error).toContain('Failed to exchange');
    });
  });

  describe('POST /api/integrations/notion/import', () => {
    it('should return 200 with import results', async () => {
      const mockResult = {
        items_imported: 2,
        items: [
          { id: 'item-1', title: 'Page 1' },
          { id: 'item-2', title: 'Page 2' },
        ],
      };
      (importFromNotion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResult);

      const res = await request(app)
        .post('/api/integrations/notion/import')
        .send({ page_ids: ['page-1', 'page-2'] })
        .expect(200);

      expect(res.body.items_imported).toBe(2);
      expect(res.body.items).toHaveLength(2);
      expect(importFromNotion).toHaveBeenCalledWith('user-1', ['page-1', 'page-2']);
    });

    it('should return 400 when page_ids is empty', async () => {
      const error = new Error('At least one page ID is required') as Error & { statusCode?: number };
      error.statusCode = 400;
      (importFromNotion as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

      const res = await request(app)
        .post('/api/integrations/notion/import')
        .send({ page_ids: [] })
        .expect(400);

      expect(res.body.error).toBe('At least one page ID is required');
    });

    it('should return 404 when no Notion connection exists', async () => {
      const error = new Error('No Notion workspace connected. Please connect first.') as Error & { statusCode?: number };
      error.statusCode = 404;
      (importFromNotion as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

      const res = await request(app)
        .post('/api/integrations/notion/import')
        .send({ page_ids: ['page-1'] })
        .expect(404);

      expect(res.body.error).toContain('No Notion workspace connected');
    });
  });

  describe('POST /api/integrations/notion/export', () => {
    it('should return 200 with export results', async () => {
      const mockResult = {
        pages_created: 1,
        page_ids: ['notion-page-1'],
      };
      (exportToNotion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResult);

      const res = await request(app)
        .post('/api/integrations/notion/export')
        .send({ item_ids: ['item-1'] })
        .expect(200);

      expect(res.body.pages_created).toBe(1);
      expect(res.body.page_ids).toEqual(['notion-page-1']);
      expect(exportToNotion).toHaveBeenCalledWith('user-1', ['item-1']);
    });

    it('should return 400 when item_ids is empty', async () => {
      const error = new Error('At least one item ID is required') as Error & { statusCode?: number };
      error.statusCode = 400;
      (exportToNotion as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

      const res = await request(app)
        .post('/api/integrations/notion/export')
        .send({ item_ids: [] })
        .expect(400);

      expect(res.body.error).toBe('At least one item ID is required');
    });
  });

  describe('GET /api/integrations/notion/status', () => {
    it('should return 200 with connection details', async () => {
      const mockConnection = {
        id: 'conn-1',
        workspace_id: 'ws-1',
        workspace_name: 'My Workspace',
        connected_at: new Date('2024-01-01').toISOString(),
      };
      (getConnection as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockConnection);

      const res = await request(app)
        .get('/api/integrations/notion/status')
        .expect(200);

      expect(res.body.workspace_id).toBe('ws-1');
    });

    it('should return 404 when not connected', async () => {
      const error = new Error('No Notion workspace connected. Please connect first.') as Error & { statusCode?: number };
      error.statusCode = 404;
      (getConnection as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

      const res = await request(app)
        .get('/api/integrations/notion/status')
        .expect(404);

      expect(res.body.error).toContain('No Notion workspace connected');
    });
  });

  describe('DELETE /api/integrations/notion/disconnect', () => {
    it('should return 204 on successful disconnect', async () => {
      (disconnectNotion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      await request(app)
        .delete('/api/integrations/notion/disconnect')
        .expect(204);

      expect(disconnectNotion).toHaveBeenCalledWith('user-1');
    });

    it('should return 404 when no connection to disconnect', async () => {
      const error = new Error('No Notion connection found') as Error & { statusCode?: number };
      error.statusCode = 404;
      (disconnectNotion as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

      const res = await request(app)
        .delete('/api/integrations/notion/disconnect')
        .expect(404);

      expect(res.body.error).toBe('No Notion connection found');
    });
  });
});
