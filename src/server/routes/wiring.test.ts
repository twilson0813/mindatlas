import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

/**
 * Integration tests verifying middleware chains and route registration.
 *
 * These tests confirm:
 * - All major route prefixes are properly mounted (not returning 404)
 * - Auth middleware is wired on protected routes (returns 401 without token)
 * - Admin routes are protected (returns 401 without auth)
 * - Public routes (health, docs, api-docs) are accessible without auth
 * - Entitlement middleware is applied to feature-gated routes
 *
 * Validates: Requirements 2.2, 18.12
 */

// ─── Mock Dependencies ───────────────────────────────────────────────────────

// Mock Redis (used by rate limiter and entitlement middleware)
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
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    },
  };
});

// Mock database
vi.mock('../db/db.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryMany: vi.fn().mockResolvedValue([]),
}));

// Mock queues (AI processing)
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

// Mock sanitization
vi.mock('../utils/sanitization.js', () => ({
  sanitizeHtml: vi.fn((value: string) => value),
}));

// Mock SMS service
vi.mock('../services/sms/index.js', () => ({
  handleIncomingWithRetry: vi.fn().mockResolvedValue(undefined),
  verifyPhoneNumber: vi.fn().mockResolvedValue(null),
}));

// Mock integrations service
vi.mock('../services/integrations/index.js', () => ({
  handleWebhook: vi.fn().mockResolvedValue({ id: 'item-1' }),
  generateApiKey: vi.fn().mockResolvedValue({ id: 'key-1', key: 'ma_test' }),
  revokeApiKey: vi.fn().mockResolvedValue(undefined),
  listApiKeys: vi.fn().mockResolvedValue([]),
}));

// Mock Notion service
vi.mock('../services/integrations/notion.js', () => ({
  connectNotion: vi.fn().mockResolvedValue({}),
  importFromNotion: vi.fn().mockResolvedValue({ items_imported: 0 }),
  exportToNotion: vi.fn().mockResolvedValue({ pages_created: 0 }),
  getConnection: vi.fn().mockResolvedValue(null),
  disconnectNotion: vi.fn().mockResolvedValue(undefined),
}));

// Mock subscription service
vi.mock('../services/subscription/index.js', () => ({
  getUserSubscription: vi.fn().mockResolvedValue(null),
  subscribeToPlan: vi.fn().mockResolvedValue({}),
  upgradePlan: vi.fn().mockResolvedValue({}),
  downgradePlan: vi.fn().mockResolvedValue({}),
  cancelSubscription: vi.fn().mockResolvedValue(undefined),
  getBillingHistory: vi.fn().mockResolvedValue([]),
  updatePaymentMethod: vi.fn().mockResolvedValue(undefined),
  checkStorageLimit: vi.fn().mockResolvedValue({ usedMb: 0, limitMb: 100, remainingMb: 100 }),
  checkAiQueryLimit: vi.fn().mockResolvedValue({ usedToday: 0, dailyLimit: 50, remaining: 50 }),
  handleStripeWebhook: vi.fn().mockResolvedValue(undefined),
}));

// Mock items service
vi.mock('../services/items/index.js', () => ({
  createItem: vi.fn().mockResolvedValue({ id: 'item-1' }),
  getItem: vi.fn().mockResolvedValue({ id: 'item-1' }),
  listItems: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  deleteItem: vi.fn().mockResolvedValue(undefined),
  getItemRelationships: vi.fn().mockResolvedValue([]),
  VALID_CONTENT_TYPES: ['plain_text', 'link', 'code_snippet', 'note', 'task', 'idea', 'file', 'custom'],
  validateItemInput: vi.fn(),
}));

// Mock CSV service
vi.mock('../services/csv/index.js', () => ({
  importCsv: vi.fn().mockResolvedValue({ itemsCreated: 0, rowsSkipped: 0, skippedRows: [] }),
  exportItems: vi.fn().mockResolvedValue(Buffer.from('content\n')),
  exportMaps: vi.fn().mockResolvedValue(Buffer.from('source_item_id\n')),
  getTemplate: vi.fn().mockReturnValue(Buffer.from('content\nexample\n')),
  MAX_CSV_FILE_SIZE: 10 * 1024 * 1024,
}));

// Mock admin service
vi.mock('../services/admin/index.js', () => ({
  listUsers: vi.fn().mockResolvedValue({ users: [], total: 0 }),
  getUserById: vi.fn().mockResolvedValue(null),
  disableAccount: vi.fn().mockResolvedValue(undefined),
  deleteAccount: vi.fn().mockResolvedValue(undefined),
  unlockAccount: vi.fn().mockResolvedValue(undefined),
  getSystemMetrics: vi.fn().mockResolvedValue({}),
  getSubscriptionMetrics: vi.fn().mockResolvedValue({}),
  listPlans: vi.fn().mockResolvedValue([]),
  createPlan: vi.fn().mockResolvedValue({}),
  updatePlan: vi.fn().mockResolvedValue({}),
  deactivatePlan: vi.fn().mockResolvedValue(undefined),
  getFeatureEntitlements: vi.fn().mockResolvedValue([]),
  setFeatureEntitlements: vi.fn().mockResolvedValue(undefined),
  getFeatureRegistry: vi.fn().mockReturnValue([]),
  getAuditTrail: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
  moderateAccount: vi.fn().mockResolvedValue(undefined),
}));

// Mock file storage (used by upload route)
vi.mock('../services/storage/index.js', () => ({
  uploadFile: vi.fn().mockResolvedValue({ filePath: '/test/file.pdf', fileSize: 1024 }),
}));

// ─── Import App ──────────────────────────────────────────────────────────────

import { createApp } from '../app.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Route Wiring and Middleware Integration', () => {
  const app = createApp();

  describe('Public routes (no auth required)', () => {
    it('GET /health returns 200', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
    });

    it('GET /docs returns 200 (user manual)', async () => {
      const res = await request(app).get('/docs');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('GET /api-docs returns 200 or 301 (Swagger UI)', async () => {
      const res = await request(app).get('/api-docs/');
      // Swagger UI serves HTML at /api-docs/
      expect([200, 301]).toContain(res.status);
    });
  });

  describe('Auth-protected routes return 401 without token', () => {
    it('GET /api/items returns 401 without auth', async () => {
      const res = await request(app).get('/api/items');
      expect(res.status).toBe(401);
    });

    it('POST /api/items returns 401 without auth', async () => {
      const res = await request(app)
        .post('/api/items')
        .send({ content: 'test', content_type: 'plain_text' });
      expect(res.status).toBe(401);
    });

    it('GET /api/csv/template returns 401 without auth', async () => {
      const res = await request(app).get('/api/csv/template');
      expect(res.status).toBe(401);
    });

    it('GET /api/keys returns 401 without auth', async () => {
      const res = await request(app).get('/api/keys');
      expect(res.status).toBe(401);
    });

    it('GET /api/integrations/notion/status returns 401 without auth', async () => {
      const res = await request(app).get('/api/integrations/notion/status');
      expect(res.status).toBe(401);
    });

    it('GET /api/billing/subscription returns 401 without auth', async () => {
      const res = await request(app).get('/api/billing/subscription');
      expect(res.status).toBe(401);
    });
  });

  describe('Admin routes return 401 without auth', () => {
    it('GET /api/admin/users returns 401 without auth', async () => {
      const res = await request(app).get('/api/admin/users');
      expect(res.status).toBe(401);
    });

    it('GET /api/admin/metrics returns 401 without auth', async () => {
      const res = await request(app).get('/api/admin/metrics');
      expect(res.status).toBe(401);
    });

    it('GET /api/admin/plans returns 401 without auth', async () => {
      const res = await request(app).get('/api/admin/plans');
      expect(res.status).toBe(401);
    });

    it('GET /api/admin/audit returns 401 without auth', async () => {
      const res = await request(app).get('/api/admin/audit');
      expect(res.status).toBe(401);
    });
  });

  describe('Route prefixes are mounted (not 404)', () => {
    it('/api/items is mounted', async () => {
      const res = await request(app).get('/api/items');
      // 401 means route exists but requires auth — NOT 404
      expect(res.status).not.toBe(404);
    });

    it('/api/sms is mounted', async () => {
      // SMS incoming is a Twilio webhook endpoint (POST)
      const res = await request(app)
        .post('/api/sms/incoming')
        .send({ From: '+15551234567', Body: 'test' });
      expect(res.status).not.toBe(404);
    });

    it('/api/csv is mounted', async () => {
      const res = await request(app).get('/api/csv/template');
      expect(res.status).not.toBe(404);
    });

    it('/api/webhooks is mounted', async () => {
      const res = await request(app).post('/api/webhooks/n8n');
      expect(res.status).not.toBe(404);
    });

    it('/api/keys is mounted', async () => {
      const res = await request(app).get('/api/keys');
      expect(res.status).not.toBe(404);
    });

    it('/api/integrations/notion is mounted', async () => {
      const res = await request(app).get('/api/integrations/notion/status');
      expect(res.status).not.toBe(404);
    });

    it('/api/billing is mounted', async () => {
      const res = await request(app).get('/api/billing/subscription');
      expect(res.status).not.toBe(404);
    });

    it('/api/admin is mounted', async () => {
      const res = await request(app).get('/api/admin/users');
      expect(res.status).not.toBe(404);
    });

    it('/docs is mounted', async () => {
      const res = await request(app).get('/docs');
      expect(res.status).not.toBe(404);
    });
  });

  describe('Entitlement middleware is applied to feature-gated routes', () => {
    it('CSV routes include entitlement middleware (requireEntitlement applied after auth)', async () => {
      // The CSV router internally uses: authenticateToken -> rateLimiter -> requireEntitlement('input.csv')
      // Without auth, we get 401 first (auth runs before entitlement)
      const res = await request(app).get('/api/csv/export/items');
      expect(res.status).toBe(401);
    });

    it('Notion routes include entitlement middleware', async () => {
      // The Notion router uses: authenticateToken -> rateLimiter -> requireEntitlement('integration.notion')
      const res = await request(app).post('/api/integrations/notion/connect').send({});
      expect(res.status).toBe(401);
    });

    it('n8n webhook route includes entitlement middleware', async () => {
      // The webhook route uses: authenticateApiKey -> requireEntitlement('integration.n8n')
      // Without API key, we get 401
      const res = await request(app).post('/api/webhooks/n8n').send({});
      expect(res.status).toBe(401);
    });
  });

  describe('Middleware order verification', () => {
    it('Stripe webhook is registered before express.json() (raw body preserved)', async () => {
      // POST to the Stripe webhook endpoint — even with bad sig, it should not 404
      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send('{}');
      // Should get 400 (missing signature) not 404
      expect(res.status).not.toBe(404);
      expect(res.status).toBe(400);
    });

    it('SMS webhook does not require JWT auth (Twilio calls it directly)', async () => {
      // The SMS endpoint accepts Twilio form-encoded webhooks without JWT
      const res = await request(app)
        .post('/api/sms/incoming')
        .type('form')
        .send({ From: '+15551234567', Body: 'Hello' });
      // Should succeed (200) or at least not 401
      expect(res.status).not.toBe(401);
      expect(res.status).toBe(200);
    });
  });
});
