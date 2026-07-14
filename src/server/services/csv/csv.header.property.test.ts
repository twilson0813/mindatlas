import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateCsvStructure } from './index.js';

/**
 * Property 21: CSV Header Validation
 * Verify acceptance iff header row contains "content" column.
 * Generator: random sets of column headers with/without "content".
 *
 * **Validates: Requirements 13.2**
 */

describe('Property 21: CSV Header Validation', () => {
  // Generator: random header names that are NOT "content" in any casing
  const nonContentHeaderArb = fc
    .string({ minLength: 1, maxLength: 30 })
    .filter((s) => s.toLowerCase().trim() !== 'content');

  // Generator: "content" in various casings and with optional surrounding whitespace
  const contentHeaderArb = fc
    .tuple(
      fc.constantFrom('content', 'Content', 'CONTENT', 'CoNtEnT', 'cONTENT'),
      fc.constantFrom('', ' ', '  ', '\t'),
      fc.constantFrom('', ' ', '  ', '\t'),
    )
    .map(([word, prefix, suffix]) => `${prefix}${word}${suffix}`);

  it('should return valid === true when headers include "content" in any casing', async () => {
    await fc.assert(
      fc.property(
        // Generate a random array of non-content headers, then insert "content" variant at random position
        fc.tuple(
          fc.array(nonContentHeaderArb, { minLength: 0, maxLength: 10 }),
          contentHeaderArb,
          fc.nat(),
        ),
        ([otherHeaders, contentHeader, insertIdx]) => {
          // Insert the content header at a random valid position
          const position = insertIdx % (otherHeaders.length + 1);
          const headers = [
            ...otherHeaders.slice(0, position),
            contentHeader,
            ...otherHeaders.slice(position),
          ];

          const result = validateCsvStructure(headers);
          expect(result.valid).toBe(true);
          expect(result.error).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should return valid === false when headers do NOT include "content"', async () => {
    await fc.assert(
      fc.property(
        // Generate a non-empty array of headers that definitely do not contain "content"
        fc.array(nonContentHeaderArb, { minLength: 1, maxLength: 10 }),
        (headers) => {
          const result = validateCsvStructure(headers);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should return valid === false for empty header arrays', () => {
    const result = validateCsvStructure([]);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});
