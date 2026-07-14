import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { hashPassword, verifyPassword } from './index';

/**
 * Property 17: Password Hashing Correctness
 * Verify hashing produces valid bcrypt hash with cost >= 12 and verifying original password succeeds.
 * Generator: arbitrary password strings.
 *
 * **Validates: Requirements 12.3**
 */
describe('Property 17: Password Hashing Correctness', () => {
  it('should produce a valid bcrypt hash with cost factor >= 12', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 16 }),
        async (password) => {
          const hash = await hashPassword(password);

          // bcrypt hashes start with $2b$ (or $2a$) followed by cost factor
          expect(hash).toMatch(/^\$2[ab]\$\d{2}\$/);

          // Extract cost factor and verify it's >= 12
          const costMatch = hash.match(/^\$2[ab]\$(\d{2})\$/);
          expect(costMatch).not.toBeNull();
          const cost = parseInt(costMatch![1], 10);
          expect(cost).toBeGreaterThanOrEqual(12);
        },
      ),
      { numRuns: 10 },
    );
  }, 30_000);

  it('should verify the original password against its hash', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 16 }),
        async (password) => {
          const hash = await hashPassword(password);
          const result = await verifyPassword(password, hash);
          expect(result).toBe(true);
        },
      ),
      { numRuns: 10 },
    );
  }, 30_000);

  it('should reject a different password against the hash', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.string({ minLength: 1, maxLength: 16 }),
        async (password, otherPassword) => {
          // Only test when passwords are actually different
          fc.pre(password !== otherPassword);

          const hash = await hashPassword(password);
          const result = await verifyPassword(otherPassword, hash);
          expect(result).toBe(false);
        },
      ),
      { numRuns: 10 },
    );
  }, 30_000);
});
