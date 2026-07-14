import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validatePassword } from './index.js';

/**
 * Property 1: Password Complexity Validation
 * Verify validator accepts strings meeting all criteria and rejects those missing any.
 * Generator: arbitrary strings with/without required character classes.
 *
 * **Validates: Requirements 1.3**
 */
describe('Property 1: Password Complexity Validation', () => {
  // Character class arbitraries
  const uppercaseArb = fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));
  const lowercaseArb = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split(''));
  const digitArb = fc.constantFrom(...'0123456789'.split(''));
  const specialChars = '!@#$%^&*()_+-=[]{};\':"|,.<>/?`~';
  const specialArb = fc.constantFrom(...specialChars.split(''));

  // Generator for valid passwords: ensures all criteria are met
  const validPasswordArb = fc
    .tuple(
      uppercaseArb,
      lowercaseArb,
      digitArb,
      specialArb,
      // Padding to reach at least 8 chars total (4 required + at least 4 more)
      fc.array(
        fc.oneof(uppercaseArb, lowercaseArb, digitArb, specialArb),
        { minLength: 4, maxLength: 50 },
      ),
    )
    .map(([upper, lower, digit, special, padding]) => {
      const chars = [upper, lower, digit, special, ...padding];
      // Shuffle to avoid positional bias
      return fc.shuffledSubarray(chars, { minLength: chars.length, maxLength: chars.length });
    })
    .chain((shuffledArb) => shuffledArb.map((arr) => arr.join('')));

  it('should accept any password that has >= 8 chars, uppercase, lowercase, digit, and special', () => {
    fc.assert(
      fc.property(validPasswordArb, (password) => {
        const result = validatePassword(password);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });

  it('should reject passwords shorter than 8 characters even if they contain all character classes', () => {
    // Generate short passwords (1-7 chars) that try to include all classes
    const shortPasswordArb = fc
      .tuple(uppercaseArb, lowercaseArb, digitArb, specialArb)
      .chain(([u, l, d, s]) => {
        // Build string of exactly 4-7 chars with all classes represented
        const base = [u, l, d, s];
        return fc
          .array(
            fc.oneof(uppercaseArb, lowercaseArb, digitArb, specialArb),
            { minLength: 0, maxLength: 3 },
          )
          .map((extra) => {
            const chars = [...base, ...extra];
            // Simple shuffle using sort
            return chars.sort(() => Math.random() - 0.5).join('');
          });
      })
      .filter((pw) => pw.length < 8);

    fc.assert(
      fc.property(shortPasswordArb, (password) => {
        const result = validatePassword(password);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must be at least 8 characters long');
      }),
      { numRuns: 200 },
    );
  });

  it('should reject passwords missing uppercase letters', () => {
    // Generate passwords with only lowercase, digits, specials (no uppercase)
    const noUpperArb = fc
      .array(fc.oneof(lowercaseArb, digitArb, specialArb), { minLength: 8, maxLength: 30 })
      .map((chars) => chars.join(''))
      .filter(
        (pw) => /[a-z]/.test(pw) && /\d/.test(pw) && /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(pw),
      );

    fc.assert(
      fc.property(noUpperArb, (password) => {
        const result = validatePassword(password);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one uppercase letter');
      }),
      { numRuns: 200 },
    );
  });

  it('should reject passwords missing lowercase letters', () => {
    // Generate passwords with only uppercase, digits, specials (no lowercase)
    const noLowerArb = fc
      .array(fc.oneof(uppercaseArb, digitArb, specialArb), { minLength: 8, maxLength: 30 })
      .map((chars) => chars.join(''))
      .filter(
        (pw) => /[A-Z]/.test(pw) && /\d/.test(pw) && /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(pw),
      );

    fc.assert(
      fc.property(noLowerArb, (password) => {
        const result = validatePassword(password);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one lowercase letter');
      }),
      { numRuns: 200 },
    );
  });

  it('should reject passwords missing digits', () => {
    // Generate passwords with only uppercase, lowercase, specials (no digits)
    const noDigitArb = fc
      .array(fc.oneof(uppercaseArb, lowercaseArb, specialArb), { minLength: 8, maxLength: 30 })
      .map((chars) => chars.join(''))
      .filter(
        (pw) =>
          /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(pw),
      );

    fc.assert(
      fc.property(noDigitArb, (password) => {
        const result = validatePassword(password);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one digit');
      }),
      { numRuns: 200 },
    );
  });

  it('should reject passwords missing special characters', () => {
    // Generate passwords with only uppercase, lowercase, digits (no specials)
    const noSpecialArb = fc
      .array(fc.oneof(uppercaseArb, lowercaseArb, digitArb), { minLength: 8, maxLength: 30 })
      .map((chars) => chars.join(''))
      .filter((pw) => /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw));

    fc.assert(
      fc.property(noSpecialArb, (password) => {
        const result = validatePassword(password);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one special character');
      }),
      { numRuns: 200 },
    );
  });
});
