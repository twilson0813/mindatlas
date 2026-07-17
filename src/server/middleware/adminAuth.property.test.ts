import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import type { Request, Response, NextFunction } from 'express';

/**
 * Property 27: Admin Access Control
 *
 * For any request to an admin route, access shall be granted if and only if
 * the requesting user has an administrator role AND has completed multi-factor
 * authentication verification. Requests from non-admin users or admin users
 * without MFA verification shall be denied.
 *
 * **Validates: Requirements 17.1, 17.12**
 */

// Mock the db module to control admin user lookup
vi.mock('../db/db.js', () => ({
  queryOne: vi.fn(),
}));

// Mock the logger to suppress output
vi.mock('../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { queryOne } from '../db/db.js';
import { requireAdmin, verifyTotp } from './adminAuth.js';

const mockedQueryOne = vi.mocked(queryOne);

function createMockRequest(userId: string | undefined, mfaToken?: string): Partial<Request> {
  const headers: Record<string, string | undefined> = {};
  if (mfaToken !== undefined) {
    headers['x-mfa-token'] = mfaToken;
  }
  return {
    user: userId
      ? { sub: userId, email: 'test@example.com', role: 'user', iat: 0, exp: 0 }
      : undefined,
    headers,
    path: '/api/admin/users',
    method: 'GET',
  };
}

function createMockResponse(): Partial<Response> & {
  statusCode?: number;
  body?: unknown;
} {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = vi.fn().mockImplementation((data: unknown) => {
    res.body = data;
    return res as Response;
  });
  return res;
}

// Generators
const userIdArb = fc.uuid();
const roleNameArb = fc.constantFrom('super_admin', 'admin', 'moderator');
const mfaSecretArb = fc.string({ minLength: 16, maxLength: 32 });

describe('Property 27: Admin Access Control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should always return 403 when user is not in admin_users table (non-admin)', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, async (userId) => {
        // DB returns null → user is not an admin
        mockedQueryOne.mockResolvedValue(null);

        const req = createMockRequest(userId) as Request;
        const res = createMockResponse() as Response;
        const next: NextFunction = vi.fn();

        await requireAdmin(req, res, next);

        // Non-admin must always get 403
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
      }),
      { numRuns: 200 },
    );
  });

  it('should always return 401 when admin has MFA enabled but no token provided', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        mfaSecretArb,
        roleNameArb,
        async (userId, mfaSecret, roleName) => {
          // DB returns admin user with MFA enabled
          mockedQueryOne.mockResolvedValue({
            id: 'admin-id-1',
            user_id: userId,
            role_id: 'role-1',
            mfa_enabled: true,
            mfa_secret: mfaSecret,
            role_name: roleName,
            permissions: ['manage_users'],
          });

          // No MFA token provided in request
          const req = createMockRequest(userId) as Request;
          const res = createMockResponse() as Response;
          const next: NextFunction = vi.fn();

          await requireAdmin(req, res, next);

          // MFA required but missing → 401
          expect(res.status).toHaveBeenCalledWith(401);
          expect(next).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should always return 401 when admin has MFA enabled and token is invalid', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        mfaSecretArb,
        roleNameArb,
        fc.string({ minLength: 1, maxLength: 10 }),
        async (userId, mfaSecret, roleName, invalidToken) => {
          // DB returns admin with MFA enabled
          mockedQueryOne.mockResolvedValue({
            id: 'admin-id-1',
            user_id: userId,
            role_id: 'role-1',
            mfa_enabled: true,
            mfa_secret: mfaSecret,
            role_name: roleName,
            permissions: ['manage_users'],
          });

          // Use verifyTotp to confirm the token is indeed invalid for this secret
          // If by extreme coincidence the random token is valid, skip that iteration
          if (verifyTotp(invalidToken, mfaSecret)) {
            return; // Skip this rare case - token happened to be valid
          }

          const req = createMockRequest(userId, invalidToken) as Request;
          const res = createMockResponse() as Response;
          const next: NextFunction = vi.fn();

          await requireAdmin(req, res, next);

          // Invalid MFA → 401
          expect(res.status).toHaveBeenCalledWith(401);
          expect(next).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should always call next() when admin has MFA disabled (access granted without MFA)', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, roleNameArb, async (userId, roleName) => {
        // DB returns admin with MFA disabled
        mockedQueryOne.mockResolvedValue({
          id: 'admin-id-1',
          user_id: userId,
          role_id: 'role-1',
          mfa_enabled: false,
          mfa_secret: null,
          role_name: roleName,
          permissions: ['manage_users'],
        });

        const req = createMockRequest(userId) as Request;
        const res = createMockResponse() as Response;
        const next: NextFunction = vi.fn();

        await requireAdmin(req, res, next);

        // Admin with MFA disabled → access granted
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
      }),
      { numRuns: 200 },
    );
  });
});
