import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateCsvSize, MAX_CSV_FILE_SIZE, MAX_CSV_ROWS } from './index.js';

/**
 * Property 24: CSV Size and Row Limit Enforcement
 * Verify rejection if > 10 MB or > 5000 rows; acceptance if both within limits.
 * Generator: random file sizes [0–20 MB] and row counts [0–10000]
 *
 * **Validates: Requirements 13.5, 13.6**
 */
describe('Property 24: CSV Size and Row Limit Enforcement', () => {
  it('should reject files exceeding 10 MB regardless of row count', () => {
    // Generator: file sizes strictly above MAX_CSV_FILE_SIZE (10 MB) up to 20 MB
    const oversizedFileArb = fc.integer({ min: MAX_CSV_FILE_SIZE + 1, max: 20 * 1024 * 1024 });
    const anyRowCountArb = fc.integer({ min: 0, max: 10000 });

    fc.assert(
      fc.property(oversizedFileArb, anyRowCountArb, (fileSize, rowCount) => {
        const result = validateCsvSize(fileSize, rowCount);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('maximum size');
      }),
      { numRuns: 200 },
    );
  });

  it('should reject files exceeding 5000 rows regardless of file size', () => {
    // Generator: row counts strictly above MAX_CSV_ROWS, file size within limits
    const validFileSizeArb = fc.integer({ min: 0, max: MAX_CSV_FILE_SIZE });
    const oversizedRowCountArb = fc.integer({ min: MAX_CSV_ROWS + 1, max: 10000 });

    fc.assert(
      fc.property(validFileSizeArb, oversizedRowCountArb, (fileSize, rowCount) => {
        const result = validateCsvSize(fileSize, rowCount);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('maximum of 5000 rows');
      }),
      { numRuns: 200 },
    );
  });

  it('should accept files with both size <= 10 MB and rows <= 5000', () => {
    // Generator: file sizes within [0, MAX_CSV_FILE_SIZE] and row counts within [0, MAX_CSV_ROWS]
    const validFileSizeArb = fc.integer({ min: 0, max: MAX_CSV_FILE_SIZE });
    const validRowCountArb = fc.integer({ min: 0, max: MAX_CSV_ROWS });

    fc.assert(
      fc.property(validFileSizeArb, validRowCountArb, (fileSize, rowCount) => {
        const result = validateCsvSize(fileSize, rowCount);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 200 },
    );
  });
});
