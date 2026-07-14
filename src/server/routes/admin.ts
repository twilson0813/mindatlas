import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticator } from 'otplib';
import { authenticateToken } from '../middleware/auth.js';
import { requireAdmin, requirePermission, type AdminAuthenticatedRequest } from '../middleware/adminAuth.js';
import { queryOne, query } from '../db/db.js';
import { createChildLogger } from '../logger.js';
import * as adminService from '../services/admin/index.js';
import path from 'path';

const logger = createChildLogger({ module: 'adminRoutes' });

const router = Router();

/**
 * POST /api/admin/mfa/setup
 * Generates a TOTP secret for the admin user to enroll in MFA.
 * Requires admin role (but MFA not yet enforced for setup).
 * Returns the secret and otpauth URI for QR code generation.
 *
 * Requirements: 17.12 (MFA for admin access)
 */
router.post('/mfa/setup', authenticateToken, async (req: Request, res: Response) => {
  if (!req.user?.sub) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const userId = req.user.sub;

  try {
    // Check the user is an admin
    const adminUser = await queryOne<{ id: string; mfa_enabled: boolean; mfa_secret: string | null }>(
      'SELECT id, mfa_enabled, mfa_secret FROM admin_users WHERE user_id = $1',
      [userId]
    );

    if (!adminUser) {
      res.status(403).json({ error: 'Forbidden: Admin access required' });
      return;
    }

    if (adminUser.mfa_enabled) {
      res.status(400).json({ error: 'MFA is already enabled for this account' });
      return;
    }

    // Generate a new TOTP secret
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(req.user.email, 'MindAtlas Admin', secret);

    // Store the secret (not yet enabled until verified)
    await query(
      'UPDATE admin_users SET mfa_secret = $1 WHERE id = $2',
      [secret, adminUser.id]
    );

    logger.info({ adminId: adminUser.id }, 'MFA setup initiated');

    res.status(200).json({
      secret,
      otpauthUrl,
      message: 'Scan the QR code with your authenticator app, then verify with /api/admin/mfa/verify',
    });
  } catch (error) {
    logger.error({ error, userId }, 'Error during MFA setup');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/mfa/verify
 * Verifies a TOTP token to complete MFA enrollment.
 * Once verified, MFA is enabled for the admin user.
 *
 * Body: { token: string }
 * Requirements: 17.12 (MFA for admin access)
 */
router.post('/mfa/verify', authenticateToken, async (req: Request, res: Response) => {
  if (!req.user?.sub) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const userId = req.user.sub;
  const { token } = req.body;

  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'Token is required' });
    return;
  }

  try {
    const adminUser = await queryOne<{ id: string; mfa_enabled: boolean; mfa_secret: string | null }>(
      'SELECT id, mfa_enabled, mfa_secret FROM admin_users WHERE user_id = $1',
      [userId]
    );

    if (!adminUser) {
      res.status(403).json({ error: 'Forbidden: Admin access required' });
      return;
    }

    if (adminUser.mfa_enabled) {
      res.status(400).json({ error: 'MFA is already enabled' });
      return;
    }

    if (!adminUser.mfa_secret) {
      res.status(400).json({ error: 'MFA setup not initiated. Call /api/admin/mfa/setup first' });
      return;
    }

    const isValid = authenticator.check(token, adminUser.mfa_secret);

    if (!isValid) {
      res.status(401).json({ error: 'Invalid TOTP token. Please try again.' });
      return;
    }

    // Enable MFA
    await query(
      'UPDATE admin_users SET mfa_enabled = true WHERE id = $1',
      [adminUser.id]
    );

    logger.info({ adminId: adminUser.id }, 'MFA enabled successfully');

    res.status(200).json({ message: 'MFA enabled successfully' });
  } catch (error) {
    logger.error({ error, userId }, 'Error during MFA verification');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Serve Admin Console SPA at /admin route.
 * All /admin/* routes serve the admin SPA's index.html for client-side routing.
 *
 * Requirements: 17.11 (Admin Console at /admin route)
 */
export function createAdminSpaRouter(): Router {
  const adminSpaRouter = Router();

  adminSpaRouter.get('/admin', authenticateToken, requireAdmin, (_req: Request, res: Response) => {
    // In production, this would serve the built admin SPA
    // For now, serve a placeholder or the built static files
    const adminBuildPath = path.resolve(process.cwd(), 'dist/client/admin/index.html');
    res.sendFile(adminBuildPath, (err) => {
      if (err) {
        res.status(200).send('<!DOCTYPE html><html><head><title>MindAtlas Admin</title></head><body><div id="admin-root"></div></body></html>');
      }
    });
  });

  adminSpaRouter.get('/admin/*', authenticateToken, requireAdmin, (_req: Request, res: Response) => {
    const adminBuildPath = path.resolve(process.cwd(), 'dist/client/admin/index.html');
    res.sendFile(adminBuildPath, (err) => {
      if (err) {
        res.status(200).send('<!DOCTYPE html><html><head><title>MindAtlas Admin</title></head><body><div id="admin-root"></div></body></html>');
      }
    });
  });

  return adminSpaRouter;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Admin API Routes (protected by admin auth + MFA via app-level middleware)
// Requirements: 17.2, 17.5, 17.6, 17.7, 17.9, 17.10, 17.11
// ═══════════════════════════════════════════════════════════════════════════════

// ─── User Management ─────────────────────────────────────────────────────────

/**
 * GET /api/admin/users
 * Lists user accounts with pagination and filtering (no card content).
 * Requirements: 17.2
 */
router.get('/users', requirePermission('users.read'), async (req: Request, res: Response) => {
  try {
    const filters: adminService.AdminUserFilters = {
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      pageSize: req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : undefined,
      email: req.query.email as string | undefined,
      status: req.query.status as 'active' | 'locked' | 'disabled' | undefined,
      plan: req.query.plan as string | undefined,
      sortBy: req.query.sortBy as 'registration_date' | 'email' | 'plan_name' | undefined,
      sortOrder: req.query.sortOrder as 'asc' | 'desc' | undefined,
    };

    const result = await adminService.listUsers(filters);
    res.status(200).json(result);
  } catch (error) {
    logger.error({ error }, 'Error listing users');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/users/:id
 * Gets a single user detail (no card content).
 * Requirements: 17.2
 */
router.get('/users/:id', requirePermission('users.read'), async (req: Request, res: Response) => {
  try {
    const user = await adminService.getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.status(200).json(user);
  } catch (error) {
    logger.error({ error, userId: req.params.id }, 'Error fetching user detail');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/users/:id/disable
 * Disables a user account.
 * Requirements: 17.2
 */
router.post('/users/:id/disable', requirePermission('users.write'), async (req: Request, res: Response) => {
  const adminReq = req as AdminAuthenticatedRequest;
  const { reason } = req.body;

  if (!reason || typeof reason !== 'string') {
    res.status(400).json({ error: 'Reason is required' });
    return;
  }

  try {
    await adminService.disableAccount(adminReq.adminUser.id, req.params.id, reason);
    res.status(200).json({ message: 'Account disabled successfully' });
  } catch (error) {
    logger.error({ error, userId: req.params.id }, 'Error disabling account');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/users/:id/delete
 * Marks user account for deletion.
 * Requirements: 17.2
 */
router.post('/users/:id/delete', requirePermission('users.write'), async (req: Request, res: Response) => {
  const adminReq = req as AdminAuthenticatedRequest;
  const { reason } = req.body;

  if (!reason || typeof reason !== 'string') {
    res.status(400).json({ error: 'Reason is required' });
    return;
  }

  try {
    await adminService.deleteAccount(adminReq.adminUser.id, req.params.id, reason);
    res.status(200).json({ message: 'Account marked for deletion' });
  } catch (error) {
    logger.error({ error, userId: req.params.id }, 'Error deleting account');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/users/:id/unlock
 * Unlocks a locked user account.
 * Requirements: 17.2
 */
router.post('/users/:id/unlock', requirePermission('users.write'), async (req: Request, res: Response) => {
  const adminReq = req as AdminAuthenticatedRequest;

  try {
    await adminService.unlockAccount(adminReq.adminUser.id, req.params.id);
    res.status(200).json({ message: 'Account unlocked successfully' });
  } catch (error) {
    logger.error({ error, userId: req.params.id }, 'Error unlocking account');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── System Metrics ──────────────────────────────────────────────────────────

/**
 * GET /api/admin/metrics
 * Returns aggregated system metrics.
 * Requirements: 17.5
 */
router.get('/metrics', requirePermission('metrics.read'), async (_req: Request, res: Response) => {
  try {
    const metrics = await adminService.getSystemMetrics();
    res.status(200).json(metrics);
  } catch (error) {
    logger.error({ error }, 'Error fetching system metrics');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/metrics/subscriptions
 * Returns subscription-specific metrics.
 * Requirements: 17.5, 18.10
 */
router.get('/metrics/subscriptions', requirePermission('metrics.read'), async (_req: Request, res: Response) => {
  try {
    const metrics = await adminService.getSubscriptionMetrics();
    res.status(200).json(metrics);
  } catch (error) {
    logger.error({ error }, 'Error fetching subscription metrics');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Plan Management ─────────────────────────────────────────────────────────

/**
 * GET /api/admin/plans
 * Lists all subscription plans.
 * Requirements: 17.6
 */
router.get('/plans', requirePermission('plans.read'), async (_req: Request, res: Response) => {
  try {
    const plans = await adminService.listPlans();
    res.status(200).json({ plans });
  } catch (error) {
    logger.error({ error }, 'Error listing plans');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/plans
 * Creates a new subscription plan.
 * Requirements: 17.6
 */
router.post('/plans', requirePermission('plans.write'), async (req: Request, res: Response) => {
  const adminReq = req as AdminAuthenticatedRequest;

  try {
    const plan = await adminService.createPlan(adminReq.adminUser.id, req.body);
    res.status(201).json(plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message.includes('required') || message.includes('must be') || message.includes('already exists')) {
      res.status(400).json({ error: message });
    } else {
      logger.error({ error }, 'Error creating plan');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

/**
 * PUT /api/admin/plans/:id
 * Updates a subscription plan.
 * Requirements: 17.6
 */
router.put('/plans/:id', requirePermission('plans.write'), async (req: Request, res: Response) => {
  const adminReq = req as AdminAuthenticatedRequest;

  try {
    const plan = await adminService.updatePlan(adminReq.adminUser.id, req.params.id, req.body);
    res.status(200).json(plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message === 'Plan not found') {
      res.status(404).json({ error: message });
    } else if (message.includes('required') || message.includes('must be') || message.includes('cannot be') || message.includes('No changes')) {
      res.status(400).json({ error: message });
    } else {
      logger.error({ error }, 'Error updating plan');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

/**
 * POST /api/admin/plans/:id/deactivate
 * Deactivates a subscription plan.
 * Requirements: 17.6
 */
router.post('/plans/:id/deactivate', requirePermission('plans.write'), async (req: Request, res: Response) => {
  const adminReq = req as AdminAuthenticatedRequest;

  try {
    await adminService.deactivatePlan(adminReq.adminUser.id, req.params.id);
    res.status(200).json({ message: 'Plan deactivated successfully' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message === 'Plan not found') {
      res.status(404).json({ error: message });
    } else if (message.includes('already inactive')) {
      res.status(400).json({ error: message });
    } else {
      logger.error({ error }, 'Error deactivating plan');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ─── Feature Entitlements ────────────────────────────────────────────────────

/**
 * GET /api/admin/plans/:id/entitlements
 * Gets feature entitlements for a plan.
 * Requirements: 17.7
 */
router.get('/plans/:id/entitlements', requirePermission('plans.read'), async (req: Request, res: Response) => {
  try {
    const entitlements = await adminService.getFeatureEntitlements(req.params.id);
    res.status(200).json({ entitlements });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message === 'Plan not found') {
      res.status(404).json({ error: message });
    } else {
      logger.error({ error }, 'Error fetching entitlements');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

/**
 * PUT /api/admin/plans/:id/entitlements
 * Updates feature entitlements for a plan.
 * Requirements: 17.7
 */
router.put('/plans/:id/entitlements', requirePermission('plans.write'), async (req: Request, res: Response) => {
  const adminReq = req as AdminAuthenticatedRequest;
  const { features } = req.body;

  if (!features || !Array.isArray(features)) {
    res.status(400).json({ error: 'Features array is required' });
    return;
  }

  try {
    await adminService.setFeatureEntitlements(adminReq.adminUser.id, req.params.id, features);
    res.status(200).json({ message: 'Entitlements updated successfully' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message === 'Plan not found') {
      res.status(404).json({ error: message });
    } else if (message.includes('required') || message.includes('must have') || message.includes('not registered')) {
      res.status(400).json({ error: message });
    } else {
      logger.error({ error }, 'Error updating entitlements');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ─── Feature Registry ────────────────────────────────────────────────────────

/**
 * GET /api/admin/features
 * Returns all registered features for the admin UI.
 * Requirements: 17.7, 17.8
 */
router.get('/features', requirePermission('plans.read'), async (_req: Request, res: Response) => {
  try {
    const features = adminService.getFeatureRegistry();
    res.status(200).json({ features });
  } catch (error) {
    logger.error({ error }, 'Error fetching features');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Audit Trail ─────────────────────────────────────────────────────────────

/**
 * GET /api/admin/audit
 * Returns admin action audit trail with filtering.
 * Requirements: 17.10
 */
router.get('/audit', requirePermission('audit.read'), async (req: Request, res: Response) => {
  try {
    const filters: adminService.AuditFilters = {
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      pageSize: req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : undefined,
      adminUserId: req.query.adminUserId as string | undefined,
      action: req.query.action as string | undefined,
      targetType: req.query.targetType as string | undefined,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
    };

    const result = await adminService.getAuditTrail(filters);
    res.status(200).json(result);
  } catch (error) {
    logger.error({ error }, 'Error fetching audit trail');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Moderation ──────────────────────────────────────────────────────────────

/**
 * POST /api/admin/moderate/:userId
 * Moderates a user account (flag/disable/unflag).
 * Requirements: 17.9
 */
router.post('/moderate/:userId', requirePermission('moderation.write'), async (req: Request, res: Response) => {
  const adminReq = req as AdminAuthenticatedRequest;
  const { action } = req.body;

  const validActions: adminService.ModerationAction[] = ['flag', 'disable', 'unflag'];
  if (!action || !validActions.includes(action)) {
    res.status(400).json({ error: `Action must be one of: ${validActions.join(', ')}` });
    return;
  }

  try {
    await adminService.moderateAccount(adminReq.adminUser.id, req.params.userId, action);
    res.status(200).json({ message: `Moderation action '${action}' applied successfully` });
  } catch (error) {
    logger.error({ error, userId: req.params.userId }, 'Error moderating account');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
