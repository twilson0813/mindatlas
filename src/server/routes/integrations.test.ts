import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock dependencies
vi.mock('../middleware/auth.js', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { sub: 'user-1', email: 'test@test.com', role: 'user', iat: 0, exp: 9999999999 };
    next();
  },
}));

vi.mock('../middleware/rateLimiter.js', () => ({
  rateLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/credentials/index.js', () => ({
  getUserIntegration: vi.fn(),
  setUserIntegration: vi.fn(),
  deleteUserIntegration: vi.fn(),
}));

import integrationsRouter from './integrations.js';
import {
  getUserIntegration,
  setUserIntegration,
  deleteUserIntegration,
} from '../services/credentials/index.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations', integrationsRouter);
  return app;
}

describe('Integrations Routes - n8n', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  describe('PUT /api/integrations/n8n', () => {
    it('should return 200 on successful save', async () => {
      (setUserIntegration as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      const res = await request(app)
        .put('/api/integrations/n8n')
        .send({ webhookUrl: 'https://n8n.example.com/webhook/123', apiKey: 'key-abc-123' })
        .expect(200);

      expect(res.body.message).toBe('n8n integration saved successfully');
      expect(setUserIntegration).toHaveBeenCalledWith('user-1', 'n8n', {
        webhookUrl: 'https://n8n.example.com/webhook/123',
        apiKey: 'key-abc-123',
      });
    });

    it('should return 400 when webhookUrl is missing', async () => {
      const res = await request(app)
        .put('/api/integrations/n8n')
        .send({ apiKey: 'key-abc-123' })
        .expect(400);

      expect(res.body.error).toBe('webhookUrl is required and must be a string');
      expect(setUserIntegration).not.toHaveBeenCalled();
    });

    it('should return 400 when webhookUrl is not a string', async () => {
      const res = await request(app)
        .put('/api/integrations/n8n')
        .send({ webhookUrl: 123, apiKey: 'key-abc-123' })
        .expect(400);

      expect(res.body.error).toBe('webhookUrl is required and must be a string');
      expect(setUserIntegration).not.toHaveBeenCalled();
    });

    it('should return 400 when apiKey is missing', async () => {
      const res = await request(app)
        .put('/api/integrations/n8n')
        .send({ webhookUrl: 'https://n8n.example.com/webhook/123' })
        .expect(400);

      expect(res.body.error).toBe('apiKey is required and must be a string');
      expect(setUserIntegration).not.toHaveBeenCalled();
    });

    it('should return 400 when apiKey is not a string', async () => {
      const res = await request(app)
        .put('/api/integrations/n8n')
        .send({ webhookUrl: 'https://n8n.example.com/webhook/123', apiKey: null })
        .expect(400);

      expect(res.body.error).toBe('apiKey is required and must be a string');
      expect(setUserIntegration).not.toHaveBeenCalled();
    });

    it('should return 500 on service error', async () => {
      (setUserIntegration as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const res = await request(app)
        .put('/api/integrations/n8n')
        .send({ webhookUrl: 'https://n8n.example.com/webhook/123', apiKey: 'key-abc-123' })
        .expect(500);

      expect(res.body.error).toBe('Database connection failed');
    });
  });

  describe('GET /api/integrations/n8n', () => {
    it('should return 200 with integration data when configured', async () => {
      (getUserIntegration as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        credentials: { webhookUrl: 'https://n8n.example.com/webhook/123', apiKey: 'key-abc-123' },
        metadata: null,
      });

      const res = await request(app)
        .get('/api/integrations/n8n')
        .expect(200);

      expect(res.body.integration).toEqual({
        webhookUrl: 'https://n8n.example.com/webhook/123',
        apiKey: 'key-abc-123',
        metadata: null,
      });
      expect(getUserIntegration).toHaveBeenCalledWith('user-1', 'n8n');
    });

    it('should return 200 with null when not configured', async () => {
      (getUserIntegration as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/integrations/n8n')
        .expect(200);

      expect(res.body.integration).toBeNull();
      expect(getUserIntegration).toHaveBeenCalledWith('user-1', 'n8n');
    });

    it('should return 500 on service error', async () => {
      (getUserIntegration as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Decryption failed')
      );

      const res = await request(app)
        .get('/api/integrations/n8n')
        .expect(500);

      expect(res.body.error).toBe('Decryption failed');
    });
  });

  describe('DELETE /api/integrations/n8n', () => {
    it('should return 204 on successful deletion', async () => {
      (deleteUserIntegration as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      await request(app)
        .delete('/api/integrations/n8n')
        .expect(204);

      expect(deleteUserIntegration).toHaveBeenCalledWith('user-1', 'n8n');
    });

    it('should return 500 on service error', async () => {
      (deleteUserIntegration as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const res = await request(app)
        .delete('/api/integrations/n8n')
        .expect(500);

      expect(res.body.error).toBe('Database connection failed');
    });
  });
});
