import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { AdminDataAccess, ContentAccessViolationError } from './index.js';

/**
 * Property 26: Admin Content Isolation
 * Verify admin responses never contain content_encrypted, item text, URLs, code, or file data.
 * Generator: random admin operations, random user data with content fields.
 *
 * **Validates: Requirements 17.3, 17.4**
 */
describe('Property 26: Admin Content Isolation', () => {
  // ─── Forbidden fields that must never appear in admin responses ─────────────
  const FORBIDDEN_FIELDS = [
    'content_encrypted',
    'file_path',
    'content',
    'file_data',
  ] as const;

  // ─── Generators ────────────────────────────────────────────────────────────

  // Generator for arbitrary non-forbidden field names
  const safeFieldNameArb = fc
    .string({ minLength: 1, maxLength: 30 })
    .filter(
      (s) =>
        s.trim().length > 0 &&
        !FORBIDDEN_FIELDS.includes(s as any) &&
        /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)
    );

  // Generator for arbitrary field values (simulating user content)
  const fieldValueArb = fc.oneof(
    fc.string({ minLength: 0, maxLength: 200 }),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 5 }),
  );

  // Generator for objects that contain one or more forbidden content fields
  const objectWithForbiddenFieldsArb = fc
    .record({
      // Always include at least some safe fields (typical admin response data)
      id: fc.uuid(),
      email: fc.emailAddress(),
      role: fc.constantFrom('user', 'admin'),
      is_locked: fc.boolean(),
      created_at: fc.date().map((d) => d.toISOString()),
    })
    .chain((baseObj) =>
      // Add a random subset of forbidden fields with random content values
      fc
        .record({
          content_encrypted: fc.option(fc.string({ minLength: 1, maxLength: 500 })),
          file_path: fc.option(fc.string({ minLength: 1, maxLength: 200 })),
          content: fc.option(fc.string({ minLength: 1, maxLength: 500 })),
          file_data: fc.option(fc.string({ minLength: 1, maxLength: 500 })),
        })
        .map((forbiddenFields) => {
          const result: Record<string, unknown> = { ...baseObj };
          // Include forbidden fields that were generated as non-null
          for (const [key, value] of Object.entries(forbiddenFields)) {
            if (value !== null) {
              result[key] = value;
            }
          }
          return result;
        })
    )
    // Ensure at least one forbidden field is present
    .filter((obj) => FORBIDDEN_FIELDS.some((field) => field in obj));

  // Generator for random SQL fragments containing forbidden field names
  const sqlWithForbiddenFieldArb = fc
    .tuple(
      fc.constantFrom(...FORBIDDEN_FIELDS),
      fc.constantFrom(
        'SELECT {field} FROM items',
        'SELECT id, {field}, created_at FROM items',
        'SELECT * FROM items WHERE {field} IS NOT NULL',
        'INSERT INTO items ({field}) VALUES ($1)',
        'UPDATE items SET {field} = $1 WHERE id = $2',
        'SELECT u.email, i.{field} FROM users u JOIN items i ON u.id = i.user_id',
        'SELECT {field} AS data FROM items WHERE user_id = $1',
      ),
    )
    .map(([field, template]) => template.replace('{field}', field));

  // ─── Property Tests ────────────────────────────────────────────────────────

  it('sanitizeResponse strips ALL forbidden content fields from any object', () => {
    fc.assert(
      fc.property(objectWithForbiddenFieldsArb, (inputObj) => {
        const sanitized = AdminDataAccess.sanitizeResponse(inputObj);

        // No forbidden field should remain in the output
        for (const field of FORBIDDEN_FIELDS) {
          expect(sanitized).not.toHaveProperty(field);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('sanitizeResponse preserves all non-forbidden fields unchanged', () => {
    fc.assert(
      fc.property(objectWithForbiddenFieldsArb, (inputObj) => {
        const sanitized = AdminDataAccess.sanitizeResponse(inputObj);

        // All non-forbidden fields should remain intact
        for (const [key, value] of Object.entries(inputObj)) {
          if (!FORBIDDEN_FIELDS.includes(key as any)) {
            expect(sanitized[key]).toEqual(value);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('validateQuerySafety always throws ContentAccessViolationError for SQL containing forbidden fields', () => {
    fc.assert(
      fc.property(sqlWithForbiddenFieldArb, (sql) => {
        expect(() => AdminDataAccess.validateQuerySafety(sql)).toThrow(
          ContentAccessViolationError,
        );
      }),
      { numRuns: 200 },
    );
  });

  it('validateQuerySafety does not throw for SQL without forbidden fields', () => {
    // Generator for SQL strings that only use safe field names
    const safeSqlArb = fc
      .tuple(
        fc.constantFrom(
          'SELECT id, email, role, is_locked, created_at FROM users',
          'SELECT COUNT(*)::integer AS total FROM items WHERE is_deleted = false',
          'UPDATE users SET is_locked = true WHERE id = $1',
          'SELECT plan_name, COUNT(id) FROM subscriptions GROUP BY plan_name',
          'SELECT id, admin_user_id, action FROM audit_log',
          'INSERT INTO audit_log (admin_user_id, action) VALUES ($1, $2)',
        ),
        fc.constantFrom('', ' LIMIT 25', ' OFFSET 0', ' ORDER BY created_at DESC'),
      )
      .map(([base, suffix]) => base + suffix);

    fc.assert(
      fc.property(safeSqlArb, (sql) => {
        expect(() => AdminDataAccess.validateQuerySafety(sql)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });
});
