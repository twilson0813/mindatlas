import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import type { Request, Response, NextFunction } from 'express';
import { requireOwnership } from './authorization.js';

/**
 * Property 3: Ownership Enforcement
 * Verify user B accessing user A's item always receives 403.
 * Also verify that user A (the owner) always gets access (next() called).
 * Generator: random user pairs and item IDs (UUIDs).
 *
 * **Validates: Requirements 2.1, 2.3**
 */

// Mock the db module
vi.mock('../db/db.js', () => ({
  queryOne: vi.fn(),
}));

import { queryOne } from '../db/db.js';

const mockedQueryOne = vi.mocked(queryOne);

function createMockRequest(
  params: Record<string, string>,
  user?: { sub: string },
): Partial<Request> {
  return {
    params: params as Request['params'],
    user: user
      ? { sub: user.sub, email: 'test@example.com', role: 'user', iat: 0, exp: 0 }
      : undefined,
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

// Generator: pairs of distinct user IDs (UUIDs)
const distinctUserPairArb = fc.tuple(fc.uuid(), fc.uuid()).filter(([a, b]) => a !== b);

// Generator: random item/resource IDs
const resourceIdArb = fc.uuid();

// Generator: resource type
const resourceTypeArb = fc.constantFrom('item' as const, 'map' as const);

describe('Property 3: Ownership Enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should always return 403 when userB accesses userA's resource", async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctUserPairArb,
        resourceIdArb,
        resourceTypeArb,
        async ([userA, userB], resourceId, resourceType) => {
          // userA owns the resource, userB tries to access it
          mockedQueryOne.mockResolvedValue({ user_id: userA });

          const middleware = requireOwnership(resourceType);
          const req = createMockRequest({ id: resourceId }, { sub: userB }) as Request;
          const res = createMockResponse() as Response;
          const next: NextFunction = vi.fn();

          await middleware(req, res, next);

          // userB must always receive 403
          expect(res.status).toHaveBeenCalledWith(403);
          expect(res.json).toHaveBeenCalledWith({
            error: 'Forbidden: You do not have access to this resource',
          });
          // next() must never be called for a non-owner
          expect(next).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should always call next() when the owner accesses their own resource', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        resourceIdArb,
        resourceTypeArb,
        async (owner, resourceId, resourceType) => {
          // owner owns the resource and is the one requesting it
          mockedQueryOne.mockResolvedValue({ user_id: owner });

          const middleware = requireOwnership(resourceType);
          const req = createMockRequest({ id: resourceId }, { sub: owner }) as Request;
          const res = createMockResponse() as Response;
          const next: NextFunction = vi.fn();

          await middleware(req, res, next);

          // Owner must always be granted access
          expect(next).toHaveBeenCalled();
          // No error status should be sent
          expect(res.status).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 200 },
    );
  });
});
