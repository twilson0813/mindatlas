import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

/**
 * Property 14: API Key Access Equivalence
 * Verify API key auth produces same response as session token for same user/endpoint.
 * Generator: random user IDs, emails, and roles.
 *
 * The key property: for a given user, authenticateApiKey produces a req.user with
 * the same `sub` (userId), `email`, and `role` as the JWT-based authenticateToken would.
 *
 * **Validates: Requirements 9.7**
 */

// Mock the database module — returns user data when looking up by key hash
vi.mock('../../db/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

// Mock the integrations service functions used by apiKeyAuth middleware
vi.mock('../integrations/index.js', () => ({
  hashApiKey: vi.fn((key: string) => `hashed_${key}`),
  findActiveKeyByHash: vi.fn(),
  updateKeyLastUsed: vi.fn().mockResolvedValue(undefined),
}));

// Mock logger
vi.mock('../../logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock config for JWT verification
vi.mock('../../config.js', () => ({
  config: {
    jwtSecret: 'test-jwt-secret-for-property-testing',
  },
}));

import { authenticateApiKey } from '../../middleware/apiKeyAuth.js';
import { authenticateToken } from '../../middleware/auth.js';
import { query } from '../../db/db.js';
import { findActiveKeyByHash } from '../integrations/index.js';
import { config } from '../../config.js';

const mockedQuery = vi.mocked(query);
const mockedFindActiveKeyByHash = vi.mocked(findActiveKeyByHash);

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

describe('Property 14: API Key Access Equivalence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Generators
  const userIdArb = fc.uuid();
  const emailArb = fc.emailAddress();
  const roleArb = fc.constantFrom('user', 'admin');
  const apiKeyArb = fc.string({ minLength: 10, maxLength: 64 }).map((s) => `ma_${s}`);

  it('should produce req.user with same sub, email, and role as JWT auth for the same user', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        emailArb,
        roleArb,
        apiKeyArb,
        async (userId, email, role, rawApiKey) => {
          vi.clearAllMocks();

          // --- API Key Auth Path ---
          // Mock findActiveKeyByHash to return a key row for this user
          mockedFindActiveKeyByHash.mockResolvedValue({
            id: 'key-id-1',
            user_id: userId,
            key_hash: `hashed_${rawApiKey}`,
            label: 'test-key',
            is_active: true,
            last_used_at: null,
            created_at: new Date(),
          });

          // Mock the user lookup query that apiKeyAuth performs
          mockedQuery.mockResolvedValue({
            rows: [{ id: userId, email, role }],
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
          } as any);

          const apiKeyReq = createMockRequest({ 'x-api-key': rawApiKey }) as Request;
          const apiKeyRes = createMockResponse() as Response;
          const apiKeyNext: NextFunction = vi.fn();

          await authenticateApiKey(apiKeyReq, apiKeyRes, apiKeyNext);

          // API key auth should succeed
          expect(apiKeyNext).toHaveBeenCalled();
          expect(apiKeyReq.user).toBeDefined();

          // --- JWT Auth Path ---
          // Create a valid JWT for the same user
          const now = Math.floor(Date.now() / 1000);
          const token = jwt.sign(
            { sub: userId, email, role, iat: now, exp: now + 900 },
            config.jwtSecret,
          );

          const jwtReq = createMockRequest({ authorization: `Bearer ${token}` }) as Request;
          const jwtRes = createMockResponse() as Response;
          const jwtNext: NextFunction = vi.fn();

          authenticateToken(jwtReq, jwtRes, jwtNext);

          // JWT auth should succeed
          expect(jwtNext).toHaveBeenCalled();
          expect(jwtReq.user).toBeDefined();

          // --- Key Property: same sub, email, role ---
          expect(apiKeyReq.user!.sub).toBe(jwtReq.user!.sub);
          expect(apiKeyReq.user!.email).toBe(jwtReq.user!.email);
          expect(apiKeyReq.user!.role).toBe(jwtReq.user!.role);

          // Both should equal the user's actual values
          expect(apiKeyReq.user!.sub).toBe(userId);
          expect(apiKeyReq.user!.email).toBe(email);
          expect(apiKeyReq.user!.role).toBe(role);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should produce req.user with numeric iat and exp fields in both auth methods', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        emailArb,
        roleArb,
        apiKeyArb,
        async (userId, email, role, rawApiKey) => {
          vi.clearAllMocks();

          // Mock API key auth dependencies
          mockedFindActiveKeyByHash.mockResolvedValue({
            id: 'key-id-2',
            user_id: userId,
            key_hash: `hashed_${rawApiKey}`,
            label: 'test-key',
            is_active: true,
            last_used_at: null,
            created_at: new Date(),
          });

          mockedQuery.mockResolvedValue({
            rows: [{ id: userId, email, role }],
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
          } as any);

          const apiKeyReq = createMockRequest({ 'x-api-key': rawApiKey }) as Request;
          const apiKeyRes = createMockResponse() as Response;
          const apiKeyNext: NextFunction = vi.fn();

          await authenticateApiKey(apiKeyReq, apiKeyRes, apiKeyNext);

          // Create JWT for same user
          const now = Math.floor(Date.now() / 1000);
          const token = jwt.sign(
            { sub: userId, email, role, iat: now, exp: now + 900 },
            config.jwtSecret,
          );

          const jwtReq = createMockRequest({ authorization: `Bearer ${token}` }) as Request;
          const jwtRes = createMockResponse() as Response;
          const jwtNext: NextFunction = vi.fn();

          authenticateToken(jwtReq, jwtRes, jwtNext);

          // Both should have iat and exp as numbers
          expect(typeof apiKeyReq.user!.iat).toBe('number');
          expect(typeof apiKeyReq.user!.exp).toBe('number');
          expect(typeof jwtReq.user!.iat).toBe('number');
          expect(typeof jwtReq.user!.exp).toBe('number');

          // Both should have exp > iat (token is valid for some duration)
          expect(apiKeyReq.user!.exp).toBeGreaterThan(apiKeyReq.user!.iat);
          expect(jwtReq.user!.exp).toBeGreaterThan(jwtReq.user!.iat);
        },
      ),
      { numRuns: 200 },
    );
  });
});
