import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { authenticateToken } from './auth.js';
import { config } from '../config.js';

/**
 * Property 2: Expired Token Rejection
 * Verify JWTs with past expiry timestamps are always rejected.
 * Generator: JWTs with random past timestamps and random user data.
 *
 * **Validates: Requirements 1.4**
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

describe('Property 2: Expired Token Rejection', () => {
  // Generator for random user payloads
  const userPayloadArb = fc.record({
    sub: fc.uuid(),
    email: fc.emailAddress(),
    role: fc.constantFrom('user', 'admin'),
  });

  // Generator for past timestamps (1 second to 10 years in the past)
  const pastOffsetSecondsArb = fc.integer({ min: 1, max: 315_360_000 });

  it('should reject all JWTs with expiry timestamps in the past', () => {
    fc.assert(
      fc.property(
        userPayloadArb,
        pastOffsetSecondsArb,
        (payload, pastOffsetSeconds) => {
          // Create a token that expired `pastOffsetSeconds` ago
          const now = Math.floor(Date.now() / 1000);
          const expiredAt = now - pastOffsetSeconds;
          const issuedAt = expiredAt - 900; // issued 15 min before expiry

          const token = jwt.sign(
            { ...payload, iat: issuedAt, exp: expiredAt },
            config.jwtSecret,
          );

          const req = createMockRequest(`Bearer ${token}`) as Request;
          const res = createMockResponse() as Response;
          const next: NextFunction = vi.fn();

          authenticateToken(req, res, next);

          // Expired tokens must always be rejected with 401
          expect(res.status).toHaveBeenCalledWith(401);
          expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
          expect(next).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should accept all JWTs with expiry timestamps in the future', () => {
    // Generator for future offsets (60 seconds to 1 hour in the future)
    const futureOffsetSecondsArb = fc.integer({ min: 60, max: 3600 });

    fc.assert(
      fc.property(
        userPayloadArb,
        futureOffsetSecondsArb,
        (payload, futureOffsetSeconds) => {
          // Create a token that expires `futureOffsetSeconds` from now
          const now = Math.floor(Date.now() / 1000);
          const expiresAt = now + futureOffsetSeconds;
          const issuedAt = now;

          const token = jwt.sign(
            { ...payload, iat: issuedAt, exp: expiresAt },
            config.jwtSecret,
          );

          const req = createMockRequest(`Bearer ${token}`) as Request;
          const res = createMockResponse() as Response;
          const next: NextFunction = vi.fn();

          authenticateToken(req, res, next);

          // Valid future-expiry tokens must be accepted
          expect(next).toHaveBeenCalled();
          expect(res.status).not.toHaveBeenCalled();
          expect(req.user).toBeDefined();
          expect(req.user!.sub).toBe(payload.sub);
          expect(req.user!.email).toBe(payload.email);
          expect(req.user!.role).toBe(payload.role);
        },
      ),
      { numRuns: 100 },
    );
  });
});
