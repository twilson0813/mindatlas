import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseRow } from './index.js';

/**
 * Property 20: CSV Row Creation Count
 * Verify N rows with M non-empty content → M items created, (N-M) skipped, created + skipped = N
 * Generator: random CSV files with mixes of populated/empty content rows
 *
 * **Validates: Requirements 13.1, 13.3, 13.10**
 */
describe('Property 20: CSV Row Creation Count', () => {
  // Generator for non-empty content values
  const nonEmptyContentArb = fc
    .string({ minLength: 1, maxLength: 100 })
    .filter((s) => s.trim().length > 0);

  // Generator for empty/whitespace-only content values
  const emptyContentArb = fc.oneof(
    fc.constant(''),
    fc.constant('   '),
    fc.constant('\t'),
    fc.constant('\n'),
    fc.constant('  \n\t  '),
    fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 0, maxLength: 10 }),
  );

  // Generator for a row with non-empty content (should be parsed)
  const populatedRowArb = nonEmptyContentArb.map((content) => ({
    content,
    content_type: 'note',
  }));

  // Generator for a row with empty content (should be skipped)
  const emptyRowArb = emptyContentArb.map((content) => ({
    content,
    content_type: 'note',
  }));

  // Generator for a mix of populated and empty rows
  const mixedRowsArb = fc
    .array(
      fc.oneof(
        populatedRowArb.map((row) => ({ row, expectParsed: true })),
        emptyRowArb.map((row) => ({ row, expectParsed: false })),
      ),
      { minLength: 1, maxLength: 50 },
    );

  it('should satisfy: parsed_count + skipped_count = total_rows', () => {
    fc.assert(
      fc.property(mixedRowsArb, (rows) => {
        let parsedCount = 0;
        let skippedCount = 0;

        for (let i = 0; i < rows.length; i++) {
          const result = parseRow(rows[i].row, i + 1);
          if (result.type === 'parsed') {
            parsedCount++;
          } else {
            skippedCount++;
          }
        }

        expect(parsedCount + skippedCount).toBe(rows.length);
      }),
      { numRuns: 200 },
    );
  });

  it('should parse all rows with non-empty content and skip all rows with empty content', () => {
    fc.assert(
      fc.property(mixedRowsArb, (rows) => {
        let parsedCount = 0;
        let skippedCount = 0;

        for (let i = 0; i < rows.length; i++) {
          const result = parseRow(rows[i].row, i + 1);
          if (rows[i].expectParsed) {
            expect(result.type).toBe('parsed');
            parsedCount++;
          } else {
            expect(result.type).toBe('skipped');
            skippedCount++;
          }
        }

        // Count of expected parsed should match actual parsed
        const expectedParsed = rows.filter((r) => r.expectParsed).length;
        const expectedSkipped = rows.filter((r) => !r.expectParsed).length;
        expect(parsedCount).toBe(expectedParsed);
        expect(skippedCount).toBe(expectedSkipped);
      }),
      { numRuns: 200 },
    );
  });

  it('should produce M items created and (N-M) skipped for N rows with M non-empty content', () => {
    // Generate specific counts of populated and empty rows
    const countedRowsArb = fc
      .tuple(
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 30 }),
      )
      .filter(([populated, empty]) => populated + empty > 0)
      .chain(([populatedCount, emptyCount]) =>
        fc.tuple(
          fc.array(populatedRowArb, { minLength: populatedCount, maxLength: populatedCount }),
          fc.array(emptyRowArb, { minLength: emptyCount, maxLength: emptyCount }),
        ).map(([populatedRows, emptyRows]) => ({
          populatedCount,
          emptyCount,
          // Shuffle populated and empty rows together
          allRows: [...populatedRows, ...emptyRows],
        })),
      )
      .chain(({ populatedCount, emptyCount, allRows }) =>
        fc.shuffledSubarray(allRows, { minLength: allRows.length, maxLength: allRows.length })
          .map((shuffled) => ({
            rows: shuffled,
            expectedCreated: populatedCount,
            expectedSkipped: emptyCount,
            totalRows: populatedCount + emptyCount,
          })),
      );

    fc.assert(
      fc.property(countedRowsArb, ({ rows, expectedCreated, expectedSkipped, totalRows }) => {
        let parsedCount = 0;
        let skippedCount = 0;

        for (let i = 0; i < rows.length; i++) {
          const result = parseRow(rows[i], i + 1);
          if (result.type === 'parsed') {
            parsedCount++;
          } else {
            skippedCount++;
          }
        }

        // N rows with M non-empty content → M items created
        expect(parsedCount).toBe(expectedCreated);
        // (N-M) skipped
        expect(skippedCount).toBe(expectedSkipped);
        // created + skipped = N
        expect(parsedCount + skippedCount).toBe(totalRows);
      }),
      { numRuns: 200 },
    );
  });
});
