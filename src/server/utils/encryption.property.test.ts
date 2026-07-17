import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { encrypt, decrypt, resetKeyCache } from './encryption';

/**
 * Property 16: Encryption Round Trip
 * Verify encrypting then decrypting any content string produces the original unchanged.
 * Generator: arbitrary strings including unicode, empty, large.
 *
 * **Validates: Requirements 12.2**
 */
describe('Property 16: Encryption Round Trip', () => {
  beforeEach(() => {
    resetKeyCache();
  });

  it('should round-trip any arbitrary string through encrypt then decrypt', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 10_000 }), (plaintext) => {
        const encrypted = encrypt(plaintext);
        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(plaintext);
      }),
      { numRuns: 200 },
    );
  });

  it('should round-trip unicode strings including emoji, CJK, and special characters', () => {
    const unicodeArb = fc.oneof(
      fc.fullUnicode(),
      fc.stringOf(fc.fullUnicode(), { minLength: 0, maxLength: 5_000 }),
    );

    fc.assert(
      fc.property(unicodeArb, (plaintext) => {
        const encrypted = encrypt(plaintext);
        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(plaintext);
      }),
      { numRuns: 200 },
    );
  });

  it('should produce different ciphertext for the same input (unique IV per encryption)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 1_000 }), (plaintext) => {
        const encrypted1 = encrypt(plaintext);
        const encrypted2 = encrypt(plaintext);
        // Different IVs means different ciphertext
        expect(encrypted1).not.toBe(encrypted2);
        // But both decrypt to the same original
        expect(decrypt(encrypted1)).toBe(plaintext);
        expect(decrypt(encrypted2)).toBe(plaintext);
      }),
      { numRuns: 200 },
    );
  });
});
