import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { authenticateToken } from './auth.js';
import { config } from '../config.js';

/**
 * Property 4: Unauthenticated Request Rejection
 * Verify requests without valid auth token always receive 401.
 * Generator: protected endpoints with missing/invalid/malformed tokens.
 *
 * **Validates: Requirements 2.2**
 */

function createMockRequest(headers: Record<string, string>): Partial<Request> {
  return { headers };
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

describe('Property 4: Unauthenticated Request Rejection', () => {
  it('should return 401 when Authorization header is missing entirely', () => {
    fc.assert(
      fc.property(
        // Generate random other headers that are NOT authorization
        fc.dictionary(
          fc.constantFrom('content-type', 'accept', 'x-request-id', 'user-agent', 'host'),
          fc.string({ minLength: 1, maxLength: 50 }),
        ),
        (otherHeaders) => {
          const req = createMockRequest(otherHeaders) as Request;
          const res = createMockResponse() as Response;
          const next: NextFunction = vi.fn();

          authenticateToken(req, res, next);

          expect(res.status).toHaveBeenCalledWith(401);
          expect(next).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should return 401 when Authorization header does not start with "Bearer "', () => {
    // Generate auth headers that don't have "Bearer " prefix
    const nonBearerPrefixArb = fc.oneof(
      // "Basic" scheme
      fc.string({ minLength: 1, maxLength: 100 }).map((s) => `Basic ${s}`),
      // "Token" scheme
      fc.string({ minLength: 1, maxLength: 100 }).map((s) => `Token ${s}`),
      // "Digest" scheme
      fc.string({ minLength: 1, maxLength: 100 }).map((s) => `Digest ${s}`),
      // Random strings that don't start with "Bearer "
      fc.string({ minLength: 1, maxLength: 200 }).filter(
        (s) => !s.startsWith('Bearer '),
      ),
      // Just the word "Bearer" without a space after it
      fc.constant('Bearer'),
      // "bearer" lowercase (case-sensitive check)
      fc.string({ minLength: 1, maxLength: 100 }).map((s) => `bearer ${s}`),
    );

    fc.assert(
      fc.property(nonBearerPrefixArb, (authHeader) => {
        const req = createMockRequest({ authorization: authHeader }) as Request;
        const res = createMockResponse() as Response;
        const next: NextFunction = vi.fn();

        authenticateToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
      }),
      { numRuns: 200 },
    );
  });

  it('should return 401 when Bearer token is empty', () => {
    // "Bearer " followed by empty or whitespace-only string
    const emptyTokenArb = fc.constantFrom('Bearer ', 'Bearer  ', 'Bearer   ');

    fc.assert(
      fc.property(emptyTokenArb, (authHeader) => {
        const req = createMockRequest({ authorization: authHeader }) as Request;
        const res = createMockResponse() as Response;
        const next: NextFunction = vi.fn();

        authenticateToken(req, res, next);

        // Empty tokens should be rejected
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
      }),
      { numRuns: 200 },
    );
  });

  it('should return 401 when Bearer token is a random non-JWT string', () => {
    // Generate random strings that are NOT valid JWTs (no dots or wrong structure)
    const randomNonJwtArb = fc.oneof(
      // Random alphanumeric strings
      fc.string({ minLength: 1, maxLength: 200 }),
      // Strings with only letters/numbers
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
        minLength: 5,
        maxLength: 100,
      }),
      // UUID-like strings
      fc.uuid(),
      // Hex strings
      fc.hexaString({ minLength: 10, maxLength: 64 }),
    );

    fc.assert(
      fc.property(randomNonJwtArb, (tokenStr) => {
        const req = createMockRequest({ authorization: `Bearer ${tokenStr}` }) as Request;
        const res = createMockResponse() as Response;
        const next: NextFunction = vi.fn();

        authenticateToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
      }),
      { numRuns: 200 },
    );
  });

  it('should return 401 when JWT is signed with a wrong secret', () => {
    // Generate JWTs with random wrong secrets (different from config.jwtSecret)
    const wrongSecretArb = fc.string({ minLength: 10, maxLength: 64 }).filter(
      (s) => s !== config.jwtSecret,
    );

    const userPayloadArb = fc.record({
      sub: fc.uuid(),
      email: fc.emailAddress(),
      role: fc.constantFrom('user', 'admin'),
    });

    fc.assert(
      fc.property(wrongSecretArb, userPayloadArb, (wrongSecret, payload) => {
        const now = Math.floor(Date.now() / 1000);
        const token = jwt.sign(
          { ...payload, iat: now, exp: now + 900 },
          wrongSecret,
        );

        const req = createMockRequest({ authorization: `Bearer ${token}` }) as Request;
        const res = createMockResponse() as Response;
        const next: NextFunction = vi.fn();

        authenticateToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
      }),
      { numRuns: 200 },
    );
  });

  it('should return 401 for malformed JWT-like strings (wrong number of dots, invalid base64)', () => {
    // Generate malformed JWT-like strings
    const malformedJwtArb = fc.oneof(
      // Only one dot (missing a segment)
      fc.tuple(
        fc.base64String({ minLength: 5, maxLength: 50 }),
        fc.base64String({ minLength: 5, maxLength: 50 }),
      ).map(([a, b]) => `${a}.${b}`),
      // Four dots (too many segments)
      fc.tuple(
        fc.base64String({ minLength: 5, maxLength: 30 }),
        fc.base64String({ minLength: 5, maxLength: 30 }),
        fc.base64String({ minLength: 5, maxLength: 30 }),
        fc.base64String({ minLength: 5, maxLength: 30 }),
      ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
      // Three dots but with invalid base64 content
      fc.tuple(
        fc.string({ minLength: 3, maxLength: 30 }),
        fc.string({ minLength: 3, maxLength: 30 }),
        fc.string({ minLength: 3, maxLength: 30 }),
      ).map(([a, b, c]) => `${a}.${b}.${c}`),
      // Empty segments with dots
      fc.constantFrom('..', '...', 'a..b', '.a.b', 'a.b.'),
    );

    fc.assert(
      fc.property(malformedJwtArb, (malformedToken) => {
        const req = createMockRequest({ authorization: `Bearer ${malformedToken}` }) as Request;
        const res = createMockResponse() as Response;
        const next: NextFunction = vi.fn();

        authenticateToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
      }),
      { numRuns: 200 },
    );
  });
});
