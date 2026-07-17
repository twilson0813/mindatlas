import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticateToken } from './auth.js';
import { config } from '../config.js';

/**
 * Unit tests for JWT auth middleware.
 * Validates: Requirements 1.4 (token expiry), 2.2 (unauthenticated rejection)
 */

function createMockRequest(authHeader?: string): Partial<Request> {
  return {
    headers: authHeader !== undefined ? { authorization: authHeader } : {},
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

describe('Auth Middleware - authenticateToken', () => {
  let mockNext: NextFunction;

  beforeEach(() => {
    mockNext = vi.fn();
  });

  describe('missing token scenarios', () => {
    it('should return 401 when Authorization header is missing', () => {
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;

      authenticateToken(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header does not start with Bearer', () => {
      const req = createMockRequest('Basic abc123') as Request;
      const res = createMockResponse() as Response;

      authenticateToken(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when Bearer token is empty', () => {
      const req = createMockRequest('Bearer ') as Request;
      const res = createMockResponse() as Response;

      authenticateToken(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('invalid token scenarios', () => {
    it('should return 401 for a completely malformed token', () => {
      const req = createMockRequest('Bearer not-a-valid-jwt') as Request;
      const res = createMockResponse() as Response;

      authenticateToken(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 for a token signed with wrong secret', () => {
      const token = jwt.sign(
        { sub: 'user-123', email: 'test@example.com', role: 'user' },
        'wrong-secret',
        { expiresIn: '15m' },
      );
      const req = createMockRequest(`Bearer ${token}`) as Request;
      const res = createMockResponse() as Response;

      authenticateToken(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 for an expired token', () => {
      const token = jwt.sign(
        { sub: 'user-123', email: 'test@example.com', role: 'user' },
        config.jwtSecret,
        { expiresIn: '-1s' }, // Already expired
      );
      const req = createMockRequest(`Bearer ${token}`) as Request;
      const res = createMockResponse() as Response;

      authenticateToken(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 for a token with tampered payload', () => {
      // Create a valid token, then tamper with it
      const token = jwt.sign(
        { sub: 'user-123', email: 'test@example.com', role: 'user' },
        config.jwtSecret,
        { expiresIn: '15m' },
      );
      // Tamper with the payload section
      const parts = token.split('.');
      parts[1] = Buffer.from('{"sub":"hacker","email":"hack@evil.com","role":"admin"}').toString(
        'base64url',
      );
      const tamperedToken = parts.join('.');

      const req = createMockRequest(`Bearer ${tamperedToken}`) as Request;
      const res = createMockResponse() as Response;

      authenticateToken(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('valid token scenarios', () => {
    it('should call next() and attach user to req for a valid token', () => {
      const token = jwt.sign(
        { sub: 'user-123', email: 'test@example.com', role: 'user' },
        config.jwtSecret,
        { expiresIn: '15m' },
      );
      const req = createMockRequest(`Bearer ${token}`) as Request;
      const res = createMockResponse() as Response;

      authenticateToken(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user!.sub).toBe('user-123');
      expect(req.user!.email).toBe('test@example.com');
      expect(req.user!.role).toBe('user');
    });

    it('should attach iat and exp fields to req.user', () => {
      const token = jwt.sign(
        { sub: 'user-456', email: 'admin@example.com', role: 'admin' },
        config.jwtSecret,
        { expiresIn: '15m' },
      );
      const req = createMockRequest(`Bearer ${token}`) as Request;
      const res = createMockResponse() as Response;

      authenticateToken(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(req.user!.iat).toBeDefined();
      expect(req.user!.exp).toBeDefined();
      expect(typeof req.user!.iat).toBe('number');
      expect(typeof req.user!.exp).toBe('number');
    });

    it('should work with tokens having various valid roles', () => {
      const roles = ['user', 'admin'];

      for (const role of roles) {
        const token = jwt.sign(
          { sub: 'user-789', email: 'test@example.com', role },
          config.jwtSecret,
          { expiresIn: '15m' },
        );
        const req = createMockRequest(`Bearer ${token}`) as Request;
        const res = createMockResponse() as Response;
        const next = vi.fn();

        authenticateToken(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.user!.role).toBe(role);
      }
    });
  });
});
