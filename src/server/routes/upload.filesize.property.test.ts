import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { isAllowedFileSize, MAX_FILE_SIZE } from './upload.js';

/**
 * Property 7: File Size Validation
 * Verify files > 25 MB are always rejected with error message.
 * Generator: random integers representing file sizes.
 *
 * **Validates: Requirements 5.4**
 */
describe('Property 7: File Size Validation', () => {
  it('should reject file sizes greater than 25 MB', () => {
    // Generator: integers strictly above MAX_FILE_SIZE (25 MB)
    const oversizedArb = fc.integer({ min: MAX_FILE_SIZE + 1, max: MAX_FILE_SIZE * 10 });

    fc.assert(
      fc.property(oversizedArb, (size) => {
        expect(isAllowedFileSize(size)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('should accept file sizes between 1 byte and 25 MB inclusive', () => {
    // Generator: integers from 1 to MAX_FILE_SIZE (valid range)
    const validSizeArb = fc.integer({ min: 1, max: MAX_FILE_SIZE });

    fc.assert(
      fc.property(validSizeArb, (size) => {
        expect(isAllowedFileSize(size)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('should reject zero and negative file sizes', () => {
    // Generator: integers <= 0
    const invalidSizeArb = fc.integer({ min: -MAX_FILE_SIZE, max: 0 });

    fc.assert(
      fc.property(invalidSizeArb, (size) => {
        expect(isAllowedFileSize(size)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('should correctly handle boundary values around exactly 25 MB', () => {
    // Exact boundary: MAX_FILE_SIZE should be accepted
    expect(isAllowedFileSize(MAX_FILE_SIZE)).toBe(true);

    // One byte over: should be rejected
    expect(isAllowedFileSize(MAX_FILE_SIZE + 1)).toBe(false);

    // One byte under: should be accepted
    expect(isAllowedFileSize(MAX_FILE_SIZE - 1)).toBe(true);

    // Zero: should be rejected (empty file)
    expect(isAllowedFileSize(0)).toBe(false);

    // 1 byte: should be accepted (minimum valid size)
    expect(isAllowedFileSize(1)).toBe(true);
  });
});
