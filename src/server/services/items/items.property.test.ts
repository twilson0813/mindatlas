import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateItemInput, VALID_CONTENT_TYPES } from './index.js';

/**
 * Property 5: Item Payload Validation
 * Verify acceptance iff payload has non-empty content and valid content_type enum.
 * Generator: random JSON objects with valid/invalid structures.
 *
 * **Validates: Requirements 3.2, 3.3**
 */
describe('Property 5: Item Payload Validation', () => {
  // Generator for valid content_type values
  const validContentTypeArb = fc.constantFrom(...VALID_CONTENT_TYPES);

  // Generator for non-empty content strings
  const nonEmptyContentArb = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

  // Generator for valid metadata (JSON objects)
  const validMetadataArb = fc.oneof(
    fc.constant(undefined),
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
    ),
  );

  it('should accept payloads with non-empty content and valid content_type', () => {
    const validPayloadArb = fc.record({
      content: nonEmptyContentArb,
      content_type: validContentTypeArb,
      metadata: validMetadataArb,
    });

    fc.assert(
      fc.property(validPayloadArb, (payload) => {
        const result = validateItemInput(payload);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });

  it('should reject payloads with empty or missing content', () => {
    // Generator for empty/whitespace-only/missing content
    const emptyContentArb = fc.oneof(
      fc.constant(''),
      fc.constant('   '),
      fc.constant('\t'),
      fc.constant('\n'),
      fc.constant('  \n\t  '),
      fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 20 }),
    );

    const invalidContentPayloadArb = fc.record({
      content: emptyContentArb,
      content_type: validContentTypeArb,
    });

    fc.assert(
      fc.property(invalidContentPayloadArb, (payload) => {
        const result = validateItemInput(payload);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.toLowerCase().includes('content'))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('should reject payloads with missing content field', () => {
    // Payload with no content field at all
    const missingContentPayloadArb = fc.record({
      content_type: validContentTypeArb,
      metadata: validMetadataArb,
    });

    fc.assert(
      fc.property(missingContentPayloadArb, (payload) => {
        const result = validateItemInput(payload as any);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.toLowerCase().includes('content'))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('should reject payloads with invalid content_type', () => {
    // Generator for strings that are NOT valid content types
    const invalidContentTypeArb = fc
      .string({ minLength: 1, maxLength: 30 })
      .filter((s) => !(VALID_CONTENT_TYPES as readonly string[]).includes(s));

    const invalidTypePayloadArb = fc.record({
      content: nonEmptyContentArb,
      content_type: invalidContentTypeArb as fc.Arbitrary<any>,
    });

    fc.assert(
      fc.property(invalidTypePayloadArb, (payload) => {
        const result = validateItemInput(payload);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.toLowerCase().includes('content_type'))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('should reject payloads with non-object metadata', () => {
    // Generator for invalid metadata values (non-objects)
    const invalidMetadataArb = fc.oneof(
      fc.string({ minLength: 1 }),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.array(fc.string()),
      fc.float(),
    );

    const invalidMetaPayloadArb = fc
      .tuple(nonEmptyContentArb, validContentTypeArb, invalidMetadataArb)
      .map(([content, content_type, metadata]) => ({
        content,
        content_type,
        metadata: metadata as any,
      }));

    fc.assert(
      fc.property(invalidMetaPayloadArb, (payload) => {
        const result = validateItemInput(payload);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.toLowerCase().includes('metadata'))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
