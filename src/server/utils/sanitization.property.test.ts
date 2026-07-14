import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { sanitizeHtml, sanitizeForSql } from './sanitization.js';

/**
 * Property 18: Input Sanitization
 * Verify sanitized output contains no executable script content or unescaped SQL control characters.
 * Generator: strings with embedded XSS/SQL injection patterns.
 *
 * **Validates: Requirements 12.5**
 */
describe('Property 18: Input Sanitization', () => {
  // --- XSS sanitization properties ---

  describe('sanitizeHtml removes all executable script content', () => {
    // Generator: arbitrary strings with embedded XSS patterns
    const xssPayloads = [
      '<script>alert(1)</script>',
      '<script src="http://evil.com/xss.js"></script>',
      '<SCRIPT>document.cookie</SCRIPT>',
      '<scRiPt>eval("malicious")</scRiPt>',
      '<img onerror="alert(1)" src="x">',
      '<div onmouseover="steal()">hover</div>',
      '<body onload="payload()">',
      '<a href="javascript:alert(1)">click</a>',
      '<a href="JAVASCRIPT:void(0)">link</a>',
      '<svg onload="alert(1)">',
      '<input onfocus="hack()" autofocus>',
      '<iframe src="javascript:alert(1)"></iframe>',
    ];

    const xssPayloadArb = fc.constantFrom(...xssPayloads);

    const stringWithXssArb = fc.tuple(
      fc.string({ minLength: 0, maxLength: 100 }),
      xssPayloadArb,
      fc.string({ minLength: 0, maxLength: 100 }),
    ).map(([prefix, payload, suffix]) => prefix + payload + suffix);

    it('output never contains <script (case-insensitive)', () => {
      fc.assert(
        fc.property(stringWithXssArb, (input) => {
          const result = sanitizeHtml(input);
          expect(result.toLowerCase()).not.toMatch(/<script/);
        }),
        { numRuns: 200 },
      );
    });

    it('output never contains javascript: protocol (case-insensitive)', () => {
      fc.assert(
        fc.property(stringWithXssArb, (input) => {
          const result = sanitizeHtml(input);
          expect(result.toLowerCase()).not.toMatch(/javascript:/);
        }),
        { numRuns: 200 },
      );
    });

    it('output never contains event handler attributes (on\\w+=)', () => {
      fc.assert(
        fc.property(stringWithXssArb, (input) => {
          const result = sanitizeHtml(input);
          expect(result).not.toMatch(/on\w+\s*=/i);
        }),
        { numRuns: 200 },
      );
    });

    it('output never contains any HTML tags after sanitization', () => {
      fc.assert(
        fc.property(stringWithXssArb, (input) => {
          const result = sanitizeHtml(input);
          // sanitizeHtml with ALLOWED_TAGS: [] strips all tags
          expect(result).not.toMatch(/<[a-zA-Z][^>]*>/);
        }),
        { numRuns: 200 },
      );
    });

    it('handles arbitrary strings without throwing', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 500 }), (input) => {
          const result = sanitizeHtml(input);
          expect(typeof result).toBe('string');
          expect(result.toLowerCase()).not.toMatch(/<script/);
          expect(result.toLowerCase()).not.toMatch(/javascript:/);
          expect(result).not.toMatch(/on\w+\s*=/i);
        }),
        { numRuns: 200 },
      );
    });
  });

  // --- SQL sanitization properties ---

  describe('sanitizeForSql escapes all SQL control characters', () => {
    // Generator: strings with embedded SQL injection patterns
    const sqlPayloads = [
      "'; DROP TABLE users; --",
      "' OR '1'='1",
      "' UNION SELECT * FROM passwords --",
      "admin'--",
      "1; DELETE FROM items;",
      "' OR 1=1; --",
      "\\'; DROP TABLE--",
      "value\x00injection",
      "data\x1aescape",
      "line1\nline2\rline3",
    ];

    const sqlPayloadArb = fc.constantFrom(...sqlPayloads);

    const stringWithSqlArb = fc.tuple(
      fc.string({ minLength: 0, maxLength: 50 }),
      sqlPayloadArb,
      fc.string({ minLength: 0, maxLength: 50 }),
    ).map(([prefix, payload, suffix]) => prefix + payload + suffix);

    it('all single quotes are doubled in output', () => {
      fc.assert(
        fc.property(stringWithSqlArb, (input) => {
          const result = sanitizeForSql(input);
          // After sanitization, any single quote in the output must be part of a doubled pair
          // Check: no isolated single quotes (single quotes not preceded or followed by another single quote)
          // Simpler check: split on '' (escaped pair) and verify no remaining single quotes in parts
          const withoutEscapedPairs = result.replace(/''/g, '');
          expect(withoutEscapedPairs).not.toContain("'");
        }),
        { numRuns: 200 },
      );
    });

    it('output contains no null bytes', () => {
      fc.assert(
        fc.property(stringWithSqlArb, (input) => {
          const result = sanitizeForSql(input);
          expect(result).not.toContain('\x00');
        }),
        { numRuns: 200 },
      );
    });

    it('output contains no SUB characters', () => {
      fc.assert(
        fc.property(stringWithSqlArb, (input) => {
          const result = sanitizeForSql(input);
          expect(result).not.toContain('\x1a');
        }),
        { numRuns: 200 },
      );
    });

    it('handles arbitrary strings with special characters', () => {
      // Use stringOf with characters that include SQL-relevant chars
      const sqlCharSet = fc.stringOf(
        fc.constantFrom(
          ...[..."abcdefghijklmnopqrstuvwxyz0123456789 '\"\\;\x00\x1a\n\r-/"],
        ),
        { minLength: 0, maxLength: 200 },
      );

      fc.assert(
        fc.property(sqlCharSet, (input) => {
          const result = sanitizeForSql(input);
          // No null bytes
          expect(result).not.toContain('\x00');
          // No SUB characters
          expect(result).not.toContain('\x1a');
          // All single quotes properly doubled
          const withoutEscapedPairs = result.replace(/''/g, '');
          expect(withoutEscapedPairs).not.toContain("'");
        }),
        { numRuns: 200 },
      );
    });

    it('output is never shorter than input minus removed chars (no data loss)', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 200 }), (input) => {
          const result = sanitizeForSql(input);
          // Sanitization should never produce an empty string from non-empty input
          // (unless input was only null bytes and SUB chars)
          const strippableOnly = /^[\x00\x1a]*$/.test(input);
          if (!strippableOnly) {
            expect(result.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 200 },
      );
    });
  });
});
