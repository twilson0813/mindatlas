import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import adminRouter from './admin.js';

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

import * as adminService from '../services/admin/index.js';

const mockListUsers = vi.mocked(adminService.listUsers);
const mockGetUserById = vi.mocked(adminService.getUserById);
const mockDisableAccount = vi.mocked(adminService.disableAccount);
const mockDeleteAccount = vi.mocked(adminService.deleteAccount);
const mockUnlockAccount = vi.mocked(adminService.unlockAccount);
const mockGetSystemMetrics = vi.mocked(adminService.getSystemMetrics);
const mockGetSubscriptionMetrics = vi.mocked(adminService.getSubscriptionMetrics);
const mockListPlans = vi.mocked(adminService.listPlans);
const mockCreatePlan = vi.mocked(adminService.createPlan);
const mockUpdatePlan = vi.mocked(adminService.updatePlan);
const mockDeactivatePlan = vi.mocked(adminService.deactivatePlan);
const mockGetFeatureEntitlements = vi.mocked(adminService.getFeatureEntitlements);
const mockSetFeatureEntitlements = vi.mocked(adminService.setFeatureEntitlements);
const mockGetFeatureRegistry = vi.mocked(adminService.getFeatureRegistry);
const mockModerateAccount = vi.mocked(adminService.moderateAccount);
const mockGetAuditTrail = vi.mocked(adminService.getAuditTrail);

/**
 * Creates a test Express app that mimics the admin route setup from app.ts.
 * Since the real app applies authenticateToken + requireAdmin at app level,
 * we simulate that by attaching admin user info directly on each request.
 */
function createTestApp(permissions: string[] = ['users.read', 'users.write', 'metrics.read', 'plans.read', 'plans.write', 'audit.read', 'moderation.write']) {
  const app = express();
  app.use(express.json());

  // Simulate the admin auth middleware that would run at app level
  app.use('/api/admin', (req: Request, _res: Response, next: NextFunction) => {
    (req as any).adminUser = {
      id: 'admin-1',
      user_id: 'user-admin',
      role_id: 'role-1',
      mfa_enabled: true,
      mfa_secret: 'secret',
      role_name: 'super_admin',
      permissions,
    };
    next();
  });

  app.use('/api/admin', adminRouter);
  return app;
}

describe('Admin API Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  // ─── User Management Routes ──────────────────────────────────────────────

  describe('GET /api/admin/users', () => {
    it('should return paginated user list', async () => {
      mockListUsers.mockResolvedValue({
        users: [
          {
            userId: 'u1',
            email: 'user1@example.com',
            role: 'user',
            isLocked: false,
            lockedUntil: null,
            registrationDate: new Date('2024-01-01'),
            updatedAt: new Date('2024-06-01'),
            subscriptionId: 'sub-1',
            planName: 'pro',
            planDisplayName: 'Pro',
            subscriptionStatus: 'active',
            currentPeriodEnd: new Date('2024-07-01'),
            cardCount: 42,
            totalStorageUsedBytes: 1024000,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      const response = await request(app).get('/api/admin/users');

      expect(response.status).toBe(200);
      expect(response.body.users).toHaveLength(1);
      expect(response.body.users[0].email).toBe('user1@example.com');
      expect(response.body.total).toBe(1);
      expect(mockListUsers).toHaveBeenCalledWith(expect.objectContaining({}));
    });

    it('should pass query filters to service', async () => {
      mockListUsers.mockResolvedValue({
        users: [],
        total: 0,
        page: 2,
        pageSize: 10,
        totalPages: 0,
      });

      await request(app)
        .get('/api/admin/users?page=2&pageSize=10&email=test&status=locked&plan=pro');

      expect(mockListUsers).toHaveBeenCalledWith({
        page: 2,
        pageSize: 10,
        email: 'test',
        status: 'locked',
        plan: 'pro',
        sortBy: undefined,
        sortOrder: undefined,
      });
    });

    it('should return 403 without users.read permission', async () => {
      const restrictedApp = createTestApp(['metrics.read']);
      const response = await request(restrictedApp).get('/api/admin/users');
      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/admin/users/:id', () => {
    it('should return user detail', async () => {
      mockGetUserById.mockResolvedValue({
        userId: 'u1',
        email: 'user1@example.com',
        role: 'user',
        isLocked: false,
        lockedUntil: null,
        registrationDate: new Date('2024-01-01'),
        updatedAt: new Date('2024-06-01'),
        subscriptionId: 'sub-1',
        planName: 'pro',
        planDisplayName: 'Pro',
        subscriptionStatus: 'active',
        currentPeriodEnd: new Date('2024-07-01'),
        cardCount: 42,
        totalStorageUsedBytes: 1024000,
      });

      const response = await request(app).get('/api/admin/users/u1');

      expect(response.status).toBe(200);
      expect(response.body.userId).toBe('u1');
      expect(response.body.email).toBe('user1@example.com');
    });

    it('should return 404 for non-existent user', async () => {
      mockGetUserById.mockResolvedValue(null);

      const response = await request(app).get('/api/admin/users/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });
  });

  describe('POST /api/admin/users/:id/disable', () => {
    it('should disable a user account', async () => {
      mockDisableAccount.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/admin/users/u1/disable')
        .send({ reason: 'Policy violation' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Account disabled successfully');
      expect(mockDisableAccount).toHaveBeenCalledWith('admin-1', 'u1', 'Policy violation');
    });

    it('should return 400 without reason', async () => {
      const response = await request(app)
        .post('/api/admin/users/u1/disable')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Reason is required');
    });
  });

  describe('POST /api/admin/users/:id/delete', () => {
    it('should mark account for deletion', async () => {
      mockDeleteAccount.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/admin/users/u1/delete')
        .send({ reason: 'User requested' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Account marked for deletion');
      expect(mockDeleteAccount).toHaveBeenCalledWith('admin-1', 'u1', 'User requested');
    });

    it('should return 400 without reason', async () => {
      const response = await request(app)
        .post('/api/admin/users/u1/delete')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Reason is required');
    });
  });

  describe('POST /api/admin/users/:id/unlock', () => {
    it('should unlock a user account', async () => {
      mockUnlockAccount.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/admin/users/u1/unlock')
        .send();

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Account unlocked successfully');
      expect(mockUnlockAccount).toHaveBeenCalledWith('admin-1', 'u1');
    });
  });

  // ─── Metrics Routes ────────────────────────────────────────────────────────

  describe('GET /api/admin/metrics', () => {
    it('should return system metrics', async () => {
      mockGetSystemMetrics.mockResolvedValue({
        totalUsers: 100,
        activeUsersDaily: 30,
        activeUsersWeekly: 60,
        activeUsersMonthly: 80,
        totalCards: 5000,
        apiRequestVolume: { last24h: 1200, last7d: 8000 },
        aiQueueDepth: 5,
        errorRates: { last24h: 2, last7d: 15 },
      });

      const response = await request(app).get('/api/admin/metrics');

      expect(response.status).toBe(200);
      expect(response.body.totalUsers).toBe(100);
      expect(response.body.activeUsersDaily).toBe(30);
      expect(response.body.totalCards).toBe(5000);
    });

    it('should return 403 without metrics.read permission', async () => {
      const restrictedApp = createTestApp(['users.read']);
      const response = await request(restrictedApp).get('/api/admin/metrics');
      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/admin/metrics/subscriptions', () => {
    it('should return subscription metrics', async () => {
      mockGetSubscriptionMetrics.mockResolvedValue({
        freeCount: 50,
        proCount: 30,
        enterpriseCount: 5,
        mrr: 350000,
        churnRate: 0.05,
        upgradeCount30d: 10,
        downgradeCount30d: 3,
      });

      const response = await request(app).get('/api/admin/metrics/subscriptions');

      expect(response.status).toBe(200);
      expect(response.body.freeCount).toBe(50);
      expect(response.body.proCount).toBe(30);
      expect(response.body.mrr).toBe(350000);
    });
  });

  // ─── Plan Management Routes ────────────────────────────────────────────────

  describe('GET /api/admin/plans', () => {
    it('should list all plans', async () => {
      mockListPlans.mockResolvedValue([
        {
          id: 'plan-1',
          name: 'free',
          displayName: 'Free',
          stripePriceId: null,
          priceMonthyCents: 0,
          storageLimitMb: 500,
          aiQueriesPerDay: 10,
          isActive: true,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        {
          id: 'plan-2',
          name: 'pro',
          displayName: 'Pro',
          stripePriceId: 'price_123',
          priceMonthyCents: 1999,
          storageLimitMb: 5120,
          aiQueriesPerDay: 100,
          isActive: true,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ]);

      const response = await request(app).get('/api/admin/plans');

      expect(response.status).toBe(200);
      expect(response.body.plans).toHaveLength(2);
      expect(response.body.plans[0].name).toBe('free');
      expect(response.body.plans[1].name).toBe('pro');
    });
  });

  describe('POST /api/admin/plans', () => {
    it('should create a new plan', async () => {
      mockCreatePlan.mockResolvedValue({
        id: 'plan-new',
        name: 'starter',
        displayName: 'Starter',
        stripePriceId: 'price_starter',
        priceMonthyCents: 999,
        storageLimitMb: 1024,
        aiQueriesPerDay: 50,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app)
        .post('/api/admin/plans')
        .send({
          name: 'starter',
          displayName: 'Starter',
          stripePriceId: 'price_starter',
          priceMonthyCents: 999,
          storageLimitMb: 1024,
          aiQueriesPerDay: 50,
        });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe('starter');
      expect(mockCreatePlan).toHaveBeenCalledWith('admin-1', expect.objectContaining({ name: 'starter' }));
    });

    it('should return 400 for validation errors', async () => {
      mockCreatePlan.mockRejectedValue(new Error('Plan name is required'));

      const response = await request(app)
        .post('/api/admin/plans')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Plan name is required');
    });
  });

  describe('PUT /api/admin/plans/:id', () => {
    it('should update an existing plan', async () => {
      mockUpdatePlan.mockResolvedValue({
        id: 'plan-1',
        name: 'pro',
        displayName: 'Pro Plus',
        stripePriceId: 'price_123',
        priceMonthyCents: 2499,
        storageLimitMb: 10240,
        aiQueriesPerDay: 200,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app)
        .put('/api/admin/plans/plan-1')
        .send({ displayName: 'Pro Plus', priceMonthyCents: 2499 });

      expect(response.status).toBe(200);
      expect(response.body.displayName).toBe('Pro Plus');
    });

    it('should return 404 for non-existent plan', async () => {
      mockUpdatePlan.mockRejectedValue(new Error('Plan not found'));

      const response = await request(app)
        .put('/api/admin/plans/nonexistent')
        .send({ displayName: 'Test' });

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/admin/plans/:id/deactivate', () => {
    it('should deactivate a plan', async () => {
      mockDeactivatePlan.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/admin/plans/plan-1/deactivate')
        .send();

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Plan deactivated successfully');
    });

    it('should return 404 for non-existent plan', async () => {
      mockDeactivatePlan.mockRejectedValue(new Error('Plan not found'));

      const response = await request(app)
        .post('/api/admin/plans/nonexistent/deactivate')
        .send();

      expect(response.status).toBe(404);
    });

    it('should return 400 for already inactive plan', async () => {
      mockDeactivatePlan.mockRejectedValue(new Error('Plan is already inactive'));

      const response = await request(app)
        .post('/api/admin/plans/plan-1/deactivate')
        .send();

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Plan is already inactive');
    });
  });

  // ─── Feature Entitlement Routes ────────────────────────────────────────────

  describe('GET /api/admin/plans/:id/entitlements', () => {
    it('should return feature entitlements for a plan', async () => {
      mockGetFeatureEntitlements.mockResolvedValue([
        { featureKey: 'input.sms', enabled: true },
        { featureKey: 'ai.categorization', enabled: true },
        { featureKey: 'integration.notion', enabled: false },
      ]);

      const response = await request(app).get('/api/admin/plans/plan-1/entitlements');

      expect(response.status).toBe(200);
      expect(response.body.entitlements).toHaveLength(3);
      expect(response.body.entitlements[0].featureKey).toBe('input.sms');
    });

    it('should return 404 for non-existent plan', async () => {
      mockGetFeatureEntitlements.mockRejectedValue(new Error('Plan not found'));

      const response = await request(app).get('/api/admin/plans/nonexistent/entitlements');

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /api/admin/plans/:id/entitlements', () => {
    it('should update feature entitlements', async () => {
      mockSetFeatureEntitlements.mockResolvedValue(undefined);

      const response = await request(app)
        .put('/api/admin/plans/plan-1/entitlements')
        .send({
          features: [
            { featureKey: 'input.sms', enabled: true },
            { featureKey: 'ai.categorization', enabled: false },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Entitlements updated successfully');
      expect(mockSetFeatureEntitlements).toHaveBeenCalledWith(
        'admin-1',
        'plan-1',
        [
          { featureKey: 'input.sms', enabled: true },
          { featureKey: 'ai.categorization', enabled: false },
        ]
      );
    });

    it('should return 400 without features array', async () => {
      const response = await request(app)
        .put('/api/admin/plans/plan-1/entitlements')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Features array is required');
    });

    it('should return 400 for unregistered feature', async () => {
      mockSetFeatureEntitlements.mockRejectedValue(
        new Error("Feature 'unknown.feature' is not registered in the feature registry")
      );

      const response = await request(app)
        .put('/api/admin/plans/plan-1/entitlements')
        .send({ features: [{ featureKey: 'unknown.feature', enabled: true }] });

      expect(response.status).toBe(400);
    });
  });

  // ─── Feature Registry Route ────────────────────────────────────────────────

  describe('GET /api/admin/features', () => {
    it('should return all registered features', async () => {
      mockGetFeatureRegistry.mockReturnValue([
        {
          key: 'input.sms',
          name: 'SMS Input Channel',
          description: 'Receive items via SMS',
          category: 'input_channels',
          registeredAt: '2024-01-01T00:00:00Z',
        },
        {
          key: 'ai.categorization',
          name: 'AI Categorization',
          description: 'Auto-categorize items',
          category: 'ai_capabilities',
          registeredAt: '2024-01-01T00:00:00Z',
        },
      ] as any);

      const response = await request(app).get('/api/admin/features');

      expect(response.status).toBe(200);
      expect(response.body.features).toHaveLength(2);
      expect(response.body.features[0].key).toBe('input.sms');
    });
  });

  // ─── Audit Trail Route ─────────────────────────────────────────────────────

  describe('GET /api/admin/audit', () => {
    it('should return audit trail', async () => {
      mockGetAuditTrail.mockResolvedValue({
        entries: [
          {
            id: 'audit-1',
            adminUserId: 'admin-1',
            action: 'disable_account',
            targetType: 'user',
            targetId: 'u1',
            details: { reason: 'Policy violation' },
            createdAt: new Date('2024-06-01'),
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      });

      const response = await request(app).get('/api/admin/audit');

      expect(response.status).toBe(200);
      expect(response.body.entries).toHaveLength(1);
      expect(response.body.entries[0].action).toBe('disable_account');
    });

    it('should pass query filters to audit service', async () => {
      mockGetAuditTrail.mockResolvedValue({
        entries: [],
        total: 0,
        page: 1,
        pageSize: 50,
        totalPages: 0,
      });

      await request(app)
        .get('/api/admin/audit?page=2&pageSize=10&action=disable_account&targetType=user');

      expect(mockGetAuditTrail).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          pageSize: 10,
          action: 'disable_account',
          targetType: 'user',
        })
      );
    });

    it('should return 403 without audit.read permission', async () => {
      const restrictedApp = createTestApp(['users.read']);
      const response = await request(restrictedApp).get('/api/admin/audit');
      expect(response.status).toBe(403);
    });
  });

  // ─── Moderation Route ──────────────────────────────────────────────────────

  describe('POST /api/admin/moderate/:userId', () => {
    it('should apply moderation action', async () => {
      mockModerateAccount.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/admin/moderate/u1')
        .send({ action: 'flag' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Moderation action 'flag' applied successfully");
      expect(mockModerateAccount).toHaveBeenCalledWith('admin-1', 'u1', 'flag');
    });

    it('should accept disable action', async () => {
      mockModerateAccount.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/admin/moderate/u1')
        .send({ action: 'disable' });

      expect(response.status).toBe(200);
    });

    it('should accept unflag action', async () => {
      mockModerateAccount.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/admin/moderate/u1')
        .send({ action: 'unflag' });

      expect(response.status).toBe(200);
    });

    it('should return 400 for invalid action', async () => {
      const response = await request(app)
        .post('/api/admin/moderate/u1')
        .send({ action: 'invalid_action' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Action must be one of');
    });

    it('should return 400 for missing action', async () => {
      const response = await request(app)
        .post('/api/admin/moderate/u1')
        .send({});

      expect(response.status).toBe(400);
    });

    it('should return 403 without moderation.write permission', async () => {
      const restrictedApp = createTestApp(['users.read']);
      const response = await request(restrictedApp)
        .post('/api/admin/moderate/u1')
        .send({ action: 'flag' });
      expect(response.status).toBe(403);
    });
  });
});
