import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import request from 'supertest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';

// Mock admin service
vi.mock('../services/admin/index.js', () => ({
  listUsers: vi.fn(),
  getUserById: vi.fn(),
  disableAccount: vi.fn(),
  deleteAccount: vi.fn(),
  unlockAccount: vi.fn(),
  getSystemMetrics: vi.fn(),
  getSubscriptionMetrics: vi.fn(),
  listPlans: vi.fn(),
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
  deactivatePlan: vi.fn(),
  getFeatureEntitlements: vi.fn(),
  setFeatureEntitlements: vi.fn(),
  getFeatureRegistry: vi.fn(),
  moderateAccount: vi.fn(),
  getAuditTrail: vi.fn(),
  logAuditEntry: vi.fn(),
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
    debug: vi.fn(),
  }),
}));

// Mock otplib
vi.mock('otplib', () => ({
  authenticator: {
    generateSecret: vi.fn().mockReturnValue('MOCKSECRET'),
    keyuri: vi.fn().mockReturnValue('otpauth://totp/test'),
    check: vi.fn().mockReturnValue(true),
  },
}));

// Mock config
vi.mock('../config.js', () => ({
  config: {
    jwtSecret: 'test-secret',
    jwtRefreshSecret: 'test-refresh-secret',
  },
}));

// Mock Redis
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

// Mock entitlement middleware
vi.mock('../middleware/entitlement.js', () => ({
  invalidateCache: vi.fn(),
  requireEntitlement: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  loadEntitlements: vi.fn(),
}));

// Mock feature registry
vi.mock('../services/feature-registry/index.js', () => ({
  getAll: vi.fn().mockReturnValue([]),
  isRegistered: vi.fn().mockReturnValue(true),
  register: vi.fn(),
  getByKey: vi.fn(),
  getByCategory: vi.fn(),
}));

// Mock credential store
vi.mock('../services/credentials/index.js', () => ({
  setPlatformCredentials: vi.fn(),
  getPlatformCredentials: vi.fn(),
  PlatformProviderMap: {},
}));

import adminRouter from './admin.js';

/**
 * Property 9: Unauthorized access rejection without credential leakage
 *
 * Requests lacking valid admin auth or entitlements.manage permission return
 * 401/403 with no credential values in body.
 *
 * **Validates: Requirements 9.1, 9.2, 9.3**
 */
describe('Property 9: Unauthorized access rejection without credential leakage', () => {
  // ─── Generators ──────────────────────────────────────────────────────────

  /**
   * Generate credential strings that are realistic API key-like values.
   * We use a prefix ("cred_") + random alphanumeric to ensure generated values
   * are long enough and distinct enough that they won't accidentally match
   * standard error message text (e.g., "Authentication required").
   */
  const credentialValueArb = fc.stringMatching(/^cred_[a-zA-Z0-9]{8,32}$/);

  // Generate OpenAI credential payloads
  const openaiPayloadArb = credentialValueArb.map((apiKey) => ({
    provider: 'openai' as const,
    body: { apiKey },
    values: [apiKey],
  }));

  // Generate Twilio credential payloads
  const twilioPayloadArb = fc.tuple(credentialValueArb, credentialValueArb, credentialValueArb).map(
    ([accountSid, authToken, phoneNumber]) => ({
      provider: 'twilio' as const,
      body: { accountSid, authToken, phoneNumber },
      values: [accountSid, authToken, phoneNumber],
    })
  );

  // Generate Stripe credential payloads
  const stripePayloadArb = fc.tuple(credentialValueArb, credentialValueArb).map(
    ([secretKey, webhookSecret]) => ({
      provider: 'stripe' as const,
      body: { secretKey, webhookSecret },
      values: [secretKey, webhookSecret],
    })
  );

  // Combined provider payload generator
  const credentialPayloadArb = fc.oneof(openaiPayloadArb, twilioPayloadArb, stripePayloadArb);

  // ─── Test App Factories ──────────────────────────────────────────────────

  /**
   * Creates an app with NO authentication at all.
   * The authenticateToken middleware would reject, so we simulate
   * the admin router receiving a request without req.adminUser set.
   * Since in real app authenticateToken runs first and returns 401,
   * we simulate that by not attaching any user.
   */
  function createUnauthenticatedApp(): express.Express {
    const app = express();
    app.use(express.json());

    // Simulate what happens when requireAdmin runs without a user:
    // In the real app, authenticateToken returns 401 before reaching the router.
    // We simulate this by adding middleware that returns 401 for missing auth.
    app.use('/api/admin', (req: Request, res: Response, next: NextFunction) => {
      // No req.user set — simulates missing/invalid JWT
      if (!req.headers.authorization) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      next();
    });

    app.use('/api/admin', adminRouter);
    return app;
  }

  /**
   * Creates an app with a valid admin user but WITHOUT the entitlements.manage permission.
   * This simulates the requirePermission('entitlements.manage') rejection with 403.
   */
  function createNoPermissionApp(): express.Express {
    const app = express();
    app.use(express.json());

    // Simulate authenticated admin without entitlements.manage permission
    app.use('/api/admin', (req: Request, _res: Response, next: NextFunction) => {
      (req as any).adminUser = {
        id: 'admin-1',
        user_id: 'user-admin',
        role_id: 'role-1',
        mfa_enabled: true,
        mfa_secret: 'secret',
        role_name: 'admin',
        permissions: ['users.read', 'metrics.read'], // NO entitlements.manage
      };
      next();
    });

    app.use('/api/admin', adminRouter);
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Scenario 1: No authentication → 401, no credential leakage ─────────

  describe('Unauthenticated requests (no valid admin auth)', () => {
    it('POST /credentials/:provider without auth returns 401 and does not leak credential values', async () => {
      const app = createUnauthenticatedApp();

      await fc.assert(
        fc.asyncProperty(credentialPayloadArb, async ({ provider, body, values }) => {
          const response = await request(app)
            .post(`/api/admin/credentials/${provider}`)
            .send(body);

          // Must reject with 401
          expect(response.status).toBe(401);

          // Response body must not contain any of the submitted credential values
          const responseText = JSON.stringify(response.body);
          for (const value of values) {
            expect(responseText).not.toContain(value);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('GET /credentials/status without auth returns 401 and does not leak credential data', async () => {
      const app = createUnauthenticatedApp();

      // For GET, there's no body with credentials, but we verify no credential data in response
      const response = await request(app)
        .get('/api/admin/credentials/status');

      expect(response.status).toBe(401);
      expect(response.body).not.toHaveProperty('providers');
    });
  });

  // ─── Scenario 2: Valid admin but missing permission → 403, no leakage ────

  describe('Admin without entitlements.manage permission', () => {
    it('POST /credentials/:provider without permission returns 403 and does not leak credential values', async () => {
      const app = createNoPermissionApp();

      await fc.assert(
        fc.asyncProperty(credentialPayloadArb, async ({ provider, body, values }) => {
          const response = await request(app)
            .post(`/api/admin/credentials/${provider}`)
            .send(body);

          // Must reject with 403
          expect(response.status).toBe(403);

          // Response body must not contain any of the submitted credential values
          const responseText = JSON.stringify(response.body);
          for (const value of values) {
            expect(responseText).not.toContain(value);
          }
        }),
        { numRuns: 50 },
      );
    }, 15000);

    it('GET /credentials/status without permission returns 403 and does not leak credential data', async () => {
      const app = createNoPermissionApp();

      const response = await request(app)
        .get('/api/admin/credentials/status');

      expect(response.status).toBe(403);
      expect(response.body).not.toHaveProperty('providers');
    });
  });
});
