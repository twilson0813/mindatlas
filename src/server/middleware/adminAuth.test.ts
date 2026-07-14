import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireAdmin, requirePermission, verifyTotp } from './adminAuth.js';
import { authenticator } from 'otplib';

/**
 * Unit tests for Admin Auth Middleware.
 * Validates: Requirements 17.1 (admin RBAC), 17.11 (admin at /admin), 17.12 (MFA required)
 */

// Mock the database module
vi.mock('../db/db.js', () => ({
  queryOne: vi.fn(),
}));

// Mock the logger
vi.mock('../logger.js', () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import { queryOne } from '../db/db.js';

const mockQueryOne = vi.mocked(queryOne);

function createMockRequest(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    user: { sub: 'user-123', email: 'admin@example.com', role: 'admin', iat: 0, exp: 0 },
    headers: {},
    path: '/api/admin/users',
    method: 'GET',
    ...overrides,
  };
}

function createMockResponse(): Partial<Response> & { statusCode?: number; body?: unknown } {
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

describe('Admin Auth Middleware - requireAdmin', () => {
  let mockNext: NextFunction;

  beforeEach(() => {
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  describe('unauthenticated scenarios', () => {
    it('should return 401 when req.user is not present', async () => {
      const req = createMockRequest({ user: undefined }) as Request;
      const res = createMockResponse() as Response;

      await requireAdmin(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when req.user.sub is missing', async () => {
      const req = createMockRequest({ user: { sub: '', email: '', role: '', iat: 0, exp: 0 } }) as Request;
      const res = createMockResponse() as Response;

      await requireAdmin(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('non-admin user scenarios', () => {
    it('should return 403 when user is not in admin_users table', async () => {
      mockQueryOne.mockResolvedValue(null);

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;

      await requireAdmin(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: Admin access required' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('admin without MFA', () => {
    it('should call next() when admin has MFA disabled', async () => {
      mockQueryOne.mockResolvedValue({
        id: 'admin-1',
        user_id: 'user-123',
        role_id: 'role-1',
        mfa_enabled: false,
        mfa_secret: null,
        role_name: 'admin',
        permissions: ['users.view', 'users.disable'],
      });

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;

      await requireAdmin(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should attach adminUser to request when access granted', async () => {
      const adminData = {
        id: 'admin-1',
        user_id: 'user-123',
        role_id: 'role-1',
        mfa_enabled: false,
        mfa_secret: null,
        role_name: 'super_admin',
        permissions: ['users.view', 'users.disable', 'roles.manage'],
      };
      mockQueryOne.mockResolvedValue(adminData);

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;

      await requireAdmin(req, res, mockNext);

      expect((req as any).adminUser).toEqual(adminData);
    });
  });

  describe('admin with MFA enabled', () => {
    const secret = authenticator.generateSecret();
    const adminData = {
      id: 'admin-1',
      user_id: 'user-123',
      role_id: 'role-1',
      mfa_enabled: true,
      mfa_secret: secret,
      role_name: 'admin',
      permissions: ['users.view'],
    };

    it('should return 401 when MFA token header is missing', async () => {
      mockQueryOne.mockResolvedValue(adminData);

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;

      await requireAdmin(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'MFA verification required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when MFA token is invalid', async () => {
      mockQueryOne.mockResolvedValue(adminData);

      const req = createMockRequest({
        headers: { 'x-mfa-token': '000000' },
      }) as Request;
      const res = createMockResponse() as Response;

      await requireAdmin(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid MFA token' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next() when MFA token is valid', async () => {
      mockQueryOne.mockResolvedValue(adminData);
      const validToken = authenticator.generate(secret);

      const req = createMockRequest({
        headers: { 'x-mfa-token': validToken },
      }) as Request;
      const res = createMockResponse() as Response;

      await requireAdmin(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 500 when MFA is enabled but secret is null', async () => {
      mockQueryOne.mockResolvedValue({
        ...adminData,
        mfa_secret: null,
      });

      const req = createMockRequest({
        headers: { 'x-mfa-token': '123456' },
      }) as Request;
      const res = createMockResponse() as Response;

      await requireAdmin(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'MFA configuration error' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('database error handling', () => {
    it('should call next with error when database query fails', async () => {
      const dbError = new Error('Connection refused');
      mockQueryOne.mockRejectedValue(dbError);

      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;

      await requireAdmin(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(dbError);
    });
  });
});

describe('Admin Auth Middleware - requirePermission', () => {
  let mockNext: NextFunction;

  beforeEach(() => {
    mockNext = vi.fn();
  });

  it('should return 403 when adminUser is not on request', () => {
    const req = { path: '/test' } as Request;
    const res = createMockResponse() as Response;

    requirePermission('users.view')(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: Admin access required' });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 403 when admin lacks the required permission', () => {
    const req = {
      path: '/test',
      adminUser: {
        id: 'admin-1',
        user_id: 'user-1',
        role_id: 'role-1',
        mfa_enabled: false,
        mfa_secret: null,
        role_name: 'moderator',
        permissions: ['users.view', 'moderation.flag'],
      },
    } as unknown as Request;
    const res = createMockResponse() as Response;

    requirePermission('users.delete')(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Forbidden: Missing permission 'users.delete'" });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should call next() when admin has the required permission', () => {
    const req = {
      path: '/test',
      adminUser: {
        id: 'admin-1',
        user_id: 'user-1',
        role_id: 'role-1',
        mfa_enabled: false,
        mfa_secret: null,
        role_name: 'admin',
        permissions: ['users.view', 'users.disable', 'users.delete'],
      },
    } as unknown as Request;
    const res = createMockResponse() as Response;

    requirePermission('users.delete')(req, res, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('verifyTotp', () => {
  it('should return true for a valid TOTP token', () => {
    const secret = authenticator.generateSecret();
    const token = authenticator.generate(secret);

    expect(verifyTotp(token, secret)).toBe(true);
  });

  it('should return false for an invalid TOTP token', () => {
    const secret = authenticator.generateSecret();

    expect(verifyTotp('000000', secret)).toBe(false);
  });

  it('should return false for an empty token', () => {
    const secret = authenticator.generateSecret();

    expect(verifyTotp('', secret)).toBe(false);
  });

  it('should return false for malformed inputs', () => {
    expect(verifyTotp('not-a-number', 'not-a-valid-secret-!')).toBe(false);
  });
});
