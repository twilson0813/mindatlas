import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { parseRow } from './index.js';

/**
 * Property 19: CSV Import-Export Round Trip
 * Verify import → export → import produces equivalent item set.
 * Tests that serializing data to CSV, parsing it back, re-serializing, and re-parsing
 * produces equivalent data — ensuring CSV round-trip fidelity.
 *
 * Generator: random valid CSV content with varying rows, columns, unicode, special chars
 *
 * **Validates: Requirements 13.11**
 */
describe('Property 19: CSV Import-Export Round Trip', () => {
  // Valid content types from the items service
  const contentTypeArb = fc.constantFrom(
    'plain_text',
    'link',
    'code_snippet',
    'note',
    'task',
    'idea',
    'file',
    'custom',
  );

  // Generator: non-empty content strings that survive CSV round-trip
  // Avoid strings that are only whitespace (they get skipped by parseRow)
  // Include unicode and special characters that CSV can handle
  const contentArb = fc
    .string({ minLength: 1, maxLength: 200 })
    .filter((s) => s.trim().length > 0)
    // Avoid null bytes which break CSV parsing
    .map((s) => s.replace(/\0/g, ''));

  // Generator: comma-separated tag strings
  const tagsArb = fc.oneof(
    fc.constant(''),
    fc
      .array(
        fc
          .string({ minLength: 1, maxLength: 20 })
          .filter((s) => s.trim().length > 0)
          .map((s) => s.replace(/,/g, '').replace(/\0/g, '').trim()),
        { minLength: 1, maxLength: 5 },
      )
      .map((tags) => tags.join(',')),
  );

  // Generator: a single CSV row data object
  const csvRowArb = fc.record({
    content: contentArb,
    content_type: contentTypeArb,
    tags: tagsArb,
  });

  // Generator: array of CSV rows
  const csvRowsArb = fc.array(csvRowArb, { minLength: 1, maxLength: 20 });

  /**
   * Helper: serialize rows to CSV string, then parse back
   */
  function serializeToCsv(
    rows: Array<{ content: string; content_type: string; tags: string }>,
  ): string {
    return stringify(rows, {
      header: true,
      columns: ['content', 'content_type', 'tags'],
    });
  }

  /**
   * Helper: parse CSV string back into records
   */
  function parseCsvString(csv: string): Record<string, string>[] {
    return parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Record<string, string>[];
  }

  /**
   * Helper: extract essential data from parseRow results for comparison.
   * Normalizes the data to focus on content fidelity.
   */
  function extractRowData(records: Record<string, string>[]) {
    return records
      .map((record, i) => {
        const result = parseRow(record, i + 1);
        if (result.type === 'parsed') {
          return {
            content: result.data.content,
            content_type: result.data.content_type || 'plain_text',
            tags:
              result.data.metadata &&
              Array.isArray((result.data.metadata as Record<string, unknown>).tags)
                ? ((result.data.metadata as Record<string, unknown>).tags as string[])
                    .sort()
                    .join(',')
                : '',
          };
        }
        return null;
      })
      .filter((r) => r !== null);
  }

  it('should produce equivalent data after serialize → parse → serialize → parse', () => {
    fc.assert(
      fc.property(csvRowsArb, (rows) => {
        // First pass: serialize to CSV and parse back
        const csv1 = serializeToCsv(rows);
        const records1 = parseCsvString(csv1);
        const data1 = extractRowData(records1);

        // Rebuild CSV from parsed data: simulate export step
        const exportedRows = data1.map((d) => ({
          content: d!.content,
          content_type: d!.content_type,
          tags: d!.tags,
        }));

        // Second pass: serialize again and parse again
        const csv2 = serializeToCsv(exportedRows);
        const records2 = parseCsvString(csv2);
        const data2 = extractRowData(records2);

        // Round-trip property: first parse and second parse produce equivalent data
        expect(data1.length).toBe(data2.length);

        for (let i = 0; i < data1.length; i++) {
          expect(data2[i]!.content).toBe(data1[i]!.content);
          expect(data2[i]!.content_type).toBe(data1[i]!.content_type);
          expect(data2[i]!.tags).toBe(data1[i]!.tags);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('should preserve content with unicode characters through round-trip', () => {
    // Specific generator for unicode-heavy content
    const unicodeContentArb = fc.oneof(
      fc
        .unicodeString({ minLength: 1, maxLength: 100 })
        .filter((s) => s.trim().length > 0)
        .map((s) => s.replace(/\0/g, '')),
      fc.constant('Hello 世界'),
      fc.constant('Ñoño señor'),
      fc.constant('émojis 🎉🚀✨'),
      fc.constant('中文测试内容'),
      fc.constant('Привет мир'),
      fc.constant('日本語テスト'),
    );

    const unicodeRowsArb = fc.array(
      fc.record({
        content: unicodeContentArb,
        content_type: contentTypeArb,
        tags: tagsArb,
      }),
      { minLength: 1, maxLength: 10 },
    );

    fc.assert(
      fc.property(unicodeRowsArb, (rows) => {
        const csv1 = serializeToCsv(rows);
        const records1 = parseCsvString(csv1);
        const data1 = extractRowData(records1);

        const exportedRows = data1.map((d) => ({
          content: d!.content,
          content_type: d!.content_type,
          tags: d!.tags,
        }));

        const csv2 = serializeToCsv(exportedRows);
        const records2 = parseCsvString(csv2);
        const data2 = extractRowData(records2);

        expect(data1.length).toBe(data2.length);
        for (let i = 0; i < data1.length; i++) {
          expect(data2[i]!.content).toBe(data1[i]!.content);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('should preserve content with special CSV characters (commas, quotes, newlines) through round-trip', () => {
    // Content that specifically includes CSV-problematic characters
    const specialCharsContentArb = fc.oneof(
      fc.constant('content with, commas in it'),
      fc.constant('content with "double quotes" inside'),
      fc.constant('content with\nnewlines in it'),
      fc.constant('mixed, "quotes", and\nnewlines'),
      fc.constant('tab\there and\tthere'),
      // Generate strings that include at least one special CSV character
      fc
        .tuple(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.constantFrom(',', '"', '\n', '\r\n'),
          fc.string({ minLength: 1, maxLength: 50 }),
        )
        .map(([before, special, after]) => `${before}${special}${after}`)
        .filter((s) => s.trim().length > 0)
        .map((s) => s.replace(/\0/g, '')),
    );

    const specialRowsArb = fc.array(
      fc.record({
        content: specialCharsContentArb,
        content_type: contentTypeArb,
        tags: fc.constant(''),
      }),
      { minLength: 1, maxLength: 10 },
    );

    fc.assert(
      fc.property(specialRowsArb, (rows) => {
        const csv1 = serializeToCsv(rows);
        const records1 = parseCsvString(csv1);
        const data1 = extractRowData(records1);

        const exportedRows = data1.map((d) => ({
          content: d!.content,
          content_type: d!.content_type,
          tags: d!.tags,
        }));

        const csv2 = serializeToCsv(exportedRows);
        const records2 = parseCsvString(csv2);
        const data2 = extractRowData(records2);

        expect(data1.length).toBe(data2.length);
        for (let i = 0; i < data1.length; i++) {
          expect(data2[i]!.content).toBe(data1[i]!.content);
          expect(data2[i]!.content_type).toBe(data1[i]!.content_type);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('should maintain row count through round-trip (no rows lost or gained)', () => {
    fc.assert(
      fc.property(csvRowsArb, (rows) => {
        const csv1 = serializeToCsv(rows);
        const records1 = parseCsvString(csv1);

        // All rows have non-empty content (by generator constraint), so none should be skipped
        const data1 = extractRowData(records1);
        expect(data1.length).toBe(rows.length);

        // Second pass should also have same count
        const exportedRows = data1.map((d) => ({
          content: d!.content,
          content_type: d!.content_type,
          tags: d!.tags,
        }));

        const csv2 = serializeToCsv(exportedRows);
        const records2 = parseCsvString(csv2);
        const data2 = extractRowData(records2);

        expect(data2.length).toBe(rows.length);
      }),
      { numRuns: 200 },
    );
  });
});
