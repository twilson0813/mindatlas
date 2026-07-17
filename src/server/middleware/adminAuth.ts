import type { Request, Response, NextFunction } from 'express';
import { authenticator } from 'otplib';
import { queryOne } from '../db/db.js';
import { createChildLogger } from '../logger.js';

const logger = createChildLogger({ module: 'adminAuth' });

/**
 * Admin Auth Middleware
 *
 * Provides TOTP-based MFA verification for admin routes.
 * - Requires the user to be authenticated (JWT validated by upstream auth middleware)
 * - Verifies user has admin role (exists in admin_users table)
 * - If MFA is enabled, requires valid TOTP code in X-MFA-Token header
 * - Returns 403 if not an admin
 * - Returns 401 if MFA is required but not provided or invalid
 * - Logs denied access attempts
 *
 * Requirements: 17.1 (admin role RBAC), 17.11 (admin served at /admin), 17.12 (MFA required)
 */

export interface AdminUser {
  id: string;
  user_id: string;
  role_id: string;
  mfa_enabled: boolean;
  mfa_secret: string | null;
  role_name: string;
  permissions: string[];
}

/**
 * Verifies a TOTP token against a secret.
 * Extracted for testability.
 */
export function verifyTotp(token: string, secret: string): boolean {
  try {
    return authenticator.check(token, secret);
  } catch {
    return false;
  }
}

/**
 * Looks up an admin user record by their user ID.
 * Returns admin info with role name and permissions joined.
 */
export async function getAdminUser(userId: string): Promise<AdminUser | null> {
  const result = await queryOne<{
    id: string;
    user_id: string;
    role_id: string;
    mfa_enabled: boolean;
    mfa_secret: string | null;
    role_name: string;
    permissions: string[];
  }>(
    `SELECT au.id, au.user_id, au.role_id, au.mfa_enabled, au.mfa_secret,
            ar.name AS role_name, ar.permissions
     FROM admin_users au
     JOIN admin_roles ar ON ar.id = au.role_id
     WHERE au.user_id = $1`,
    [userId],
  );

  return result;
}

/**
 * Middleware that enforces admin role + MFA verification.
 * Must be placed after authenticateToken middleware.
 *
 * Flow:
 * 1. Check req.user is present (already authenticated via JWT)
 * 2. Look up user in admin_users table
 * 3. If not found → 403 Forbidden + log attempt
 * 4. If MFA enabled → require valid X-MFA-Token header
 * 5. Attach admin user info to request for downstream handlers
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Step 1: Ensure user is authenticated
  if (!req.user?.sub) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const userId = req.user.sub;

  try {
    // Step 2: Check admin_users table
    const adminUser = await getAdminUser(userId);

    if (!adminUser) {
      logger.warn(
        { userId, path: req.path, method: req.method },
        'Non-admin user attempted to access admin route',
      );
      res.status(403).json({ error: 'Forbidden: Admin access required' });
      return;
    }

    // Step 3: MFA verification
    if (adminUser.mfa_enabled) {
      const mfaToken = req.headers['x-mfa-token'] as string | undefined;

      if (!mfaToken) {
        logger.warn(
          { userId, adminId: adminUser.id, path: req.path },
          'Admin access attempt without MFA token',
        );
        res.status(401).json({ error: 'MFA verification required' });
        return;
      }

      if (!adminUser.mfa_secret) {
        logger.error(
          { userId, adminId: adminUser.id },
          'Admin has MFA enabled but no secret configured',
        );
        res.status(500).json({ error: 'MFA configuration error' });
        return;
      }

      const isValid = verifyTotp(mfaToken, adminUser.mfa_secret);

      if (!isValid) {
        logger.warn(
          { userId, adminId: adminUser.id, path: req.path },
          'Admin access attempt with invalid MFA token',
        );
        res.status(401).json({ error: 'Invalid MFA token' });
        return;
      }
    }

    // Step 4: Attach admin info to request for downstream handlers
    (req as AdminAuthenticatedRequest).adminUser = adminUser;

    next();
  } catch (error) {
    logger.error({ error, userId }, 'Error in admin auth middleware');
    next(error);
  }
}

/**
 * Extended request type with admin user info attached.
 */
export interface AdminAuthenticatedRequest extends Request {
  adminUser: AdminUser;
}

/**
 * Middleware to check if the admin has a specific permission.
 * Must be placed after requireAdmin middleware.
 */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const adminReq = req as AdminAuthenticatedRequest;

    if (!adminReq.adminUser) {
      res.status(403).json({ error: 'Forbidden: Admin access required' });
      return;
    }

    if (!adminReq.adminUser.permissions.includes(permission)) {
      logger.warn(
        {
          adminId: adminReq.adminUser.id,
          permission,
          path: req.path,
        },
        'Admin attempted action without required permission',
      );
      res.status(403).json({ error: `Forbidden: Missing permission '${permission}'` });
      return;
    }

    next();
  };
}
