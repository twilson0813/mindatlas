import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import request from 'supertest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';

// Mock admin service
vi.mock('../services/admin/index.js', () => ({
  logAuditEntry: vi.fn().mockResolvedValue(undefined),
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
}));

// Mock credential store
vi.mock('../services/credentials/index.js', () => ({
  setPlatformCredentials: vi.fn().mockResolvedValue(undefined),
  PlatformProviderMap: {},
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

import adminRouter from './admin.js';
import * as adminService from '../services/admin/index.js';

const mockLogAuditEntry = vi.mocked(adminService.logAuditEntry);

/**
 * Creates a test Express app with admin auth middleware simulated.
 */
function createTestApp() {
  const app = express();
  app.use(express.json());

  app.use('/api/admin', (req: Request, _res: Response, next: NextFunction) => {
    (req as any).adminUser = {
      id: 'admin-test-id',
      user_id: 'user-admin',
      role_id: 'role-1',
      mfa_enabled: true,
      mfa_secret: 'secret',
      role_name: 'super_admin',
      permissions: ['entitlements.manage'],
    };
    next();
  });

  app.use('/api/admin', adminRouter);
  return app;
}

/**
 * Property 8: Audit log completeness without credential leakage
 *
 * For any admin credential update operation on any provider, the resulting
 * audit_log entry SHALL contain action, target_type, target_id, admin_user_id,
 * and details SHALL NOT contain credential values.
 *
 * **Validates: Requirements 8.1, 8.2, 8.3**
 */
describe('Property 8: Audit log completeness without credential leakage', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  // Generator for credential-like strings: alphanumeric with enough length
  // to be meaningful (avoids false positives from short strings appearing in JSON structure)
  const credentialStringArb = fc.stringOf(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split(''),
    ),
    {
      minLength: 5,
      maxLength: 100,
    },
  );

  // Generator for OpenAI credentials with arbitrary string values
  const openaiCredsArb = fc.record({
    apiKey: credentialStringArb,
  });

  // Generator for Twilio credentials with arbitrary string values
  const twilioCredsArb = fc.record({
    accountSid: credentialStringArb,
    authToken: credentialStringArb,
    phoneNumber: credentialStringArb,
  });

  // Generator for Stripe credentials with arbitrary string values
  const stripeCredsArb = fc.record({
    secretKey: credentialStringArb,
    webhookSecret: credentialStringArb,
  });

  // Combined generator: produces a provider name and matching credentials
  const providerWithCredsArb = fc.oneof(
    openaiCredsArb.map((creds) => ({ provider: 'openai' as const, creds })),
    twilioCredsArb.map((creds) => ({ provider: 'twilio' as const, creds })),
    stripeCredsArb.map((creds) => ({ provider: 'stripe' as const, creds })),
  );

  it('audit log SHALL contain action, target_type, target_id, admin_user_id and SHALL NOT contain credential values', async () => {
    await fc.assert(
      fc.asyncProperty(providerWithCredsArb, async ({ provider, creds }) => {
        // Reset mocks for each iteration
        mockLogAuditEntry.mockClear();

        // Make the credential update request
        const response = await request(app).post(`/api/admin/credentials/${provider}`).send(creds);

        expect(response.status).toBe(200);

        // Verify logAuditEntry was called exactly once
        expect(mockLogAuditEntry).toHaveBeenCalledTimes(1);

        const [adminId, action, targetType, targetId, details] = mockLogAuditEntry.mock.calls[0];

        // Verify required audit fields are present
        expect(adminId).toBe('admin-test-id');
        expect(action).toBe('credentials.update');
        expect(targetType).toBe('platform_credentials');
        expect(targetId).toBe(provider);

        // Verify details does NOT contain any credential values
        const detailsStr = JSON.stringify(details);
        const credentialValues = Object.values(creds);

        for (const credValue of credentialValues) {
          expect(detailsStr).not.toContain(credValue);
        }
      }),
      { numRuns: 100 },
    );
  });
});
