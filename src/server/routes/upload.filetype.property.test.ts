import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { isAllowedExtension, ALLOWED_EXTENSIONS } from './upload.js';

/**
 * Property 8: File Type Validation
 * Verify allowed extensions accepted, all others rejected.
 * Generator: random filenames with various extensions.
 *
 * **Validates: Requirements 5.5**
 */
describe('Property 8: File Type Validation', () => {
  // Generator for random filename bases (without extension)
  const filenameBaseArb = fc.stringOf(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split('')
    ),
    { minLength: 1, maxLength: 30 },
  );

  // Allowed extensions as array (lowercase)
  const allowedExtensions = Array.from(ALLOWED_EXTENSIONS);

  // Generator for allowed extensions
  const allowedExtArb = fc.constantFrom(...allowedExtensions);

  // Disallowed extensions - known dangerous and random ones
  const knownDisallowedExtensions = [
    '.exe', '.dll', '.sh', '.bat', '.zip', '.tar', '.gz',
    '.rar', '.7z', '.iso', '.bin', '.msi', '.app', '.deb',
    '.rpm', '.war', '.jar', '.com', '.scr', '.vbs', '.ps1',
  ];

  // Generator for random extensions that are NOT in allowed set
  const randomDisallowedExtArb = fc.oneof(
    // Known dangerous extensions
    fc.constantFrom(...knownDisallowedExtensions),
    // Random extensions (filter out allowed ones)
    fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
      { minLength: 1, maxLength: 6 },
    ).map((s) => `.${s}`).filter((ext) => !ALLOWED_EXTENSIONS.has(ext)),
  );

  it('should accept filenames with any allowed extension', () => {
    const validFilenameArb = fc.tuple(filenameBaseArb, allowedExtArb).map(
      ([base, ext]) => `${base}${ext}`,
    );

    fc.assert(
      fc.property(validFilenameArb, (filename) => {
        expect(isAllowedExtension(filename)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('should reject filenames with disallowed extensions', () => {
    const invalidFilenameArb = fc.tuple(filenameBaseArb, randomDisallowedExtArb).map(
      ([base, ext]) => `${base}${ext}`,
    );

    fc.assert(
      fc.property(invalidFilenameArb, (filename) => {
        expect(isAllowedExtension(filename)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('should accept allowed extensions regardless of casing (case-insensitive)', () => {
    // Generator that randomizes the casing of each character in an allowed extension
    const randomCaseExtArb = allowedExtArb.chain((ext) => {
      // For each character in the extension, randomly uppercase or lowercase
      const chars = ext.split('');
      return fc.tuple(
        ...chars.map((c) =>
          fc.boolean().map((upper) => (upper ? c.toUpperCase() : c.toLowerCase()))
        ),
      ).map((randomizedChars) => randomizedChars.join(''));
    });

    const caseInsensitiveFilenameArb = fc.tuple(filenameBaseArb, randomCaseExtArb).map(
      ([base, ext]) => `${base}${ext}`,
    );

    fc.assert(
      fc.property(caseInsensitiveFilenameArb, (filename) => {
        expect(isAllowedExtension(filename)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('should reject filenames with no extension', () => {
    // Filenames that do not contain a dot produce an empty extension
    const noExtFilenameArb = fc.stringOf(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split('')
      ),
      { minLength: 1, maxLength: 30 },
    );

    fc.assert(
      fc.property(noExtFilenameArb, (filename) => {
        expect(isAllowedExtension(filename)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
