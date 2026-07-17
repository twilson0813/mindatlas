import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseRow } from './index.js';

/**
 * Property 22: CSV Empty Content Row Skipping
 * Verify empty/whitespace content rows are skipped and row numbers accurately reported.
 * Generator: CSV files with random placement of empty content fields.
 *
 * **Validates: Requirements 13.3**
 */
describe('Property 22: CSV Empty Content Row Skipping', () => {
  // Generator for empty/whitespace-only content values
  const emptyContentArb = fc.oneof(
    fc.constant(''),
    fc.constant('   '),
    fc.constant('\t'),
    fc.constant('\n'),
    fc.constant('\r\n'),
    fc.constant('  \t\n  '),
    fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 0, maxLength: 15 }),
  );

  // Generator for non-empty content values (has at least one non-whitespace char)
  const nonEmptyContentArb = fc
    .string({ minLength: 1, maxLength: 200 })
    .filter((s) => s.trim().length > 0);

  // Generator for a row with empty content
  const emptyRowArb = emptyContentArb.map((content) => ({
    content,
    content_type: 'note',
  }));

  // Generator for a row with non-empty content
  const nonEmptyRowArb = nonEmptyContentArb.map((content) => ({
    content,
    content_type: 'note',
  }));

  // Generator for mixed rows with tracking of which are empty
  const mixedRowsArb = fc.array(
    fc.oneof(
      emptyRowArb.map((row) => ({ row, isEmpty: true })),
      nonEmptyRowArb.map((row) => ({ row, isEmpty: false })),
    ),
    { minLength: 1, maxLength: 50 },
  );

  it('should skip all empty/whitespace content rows', () => {
    fc.assert(
      fc.property(mixedRowsArb, (rows) => {
        for (let i = 0; i < rows.length; i++) {
          const result = parseRow(rows[i].row, i + 1);
          if (rows[i].isEmpty) {
            expect(result.type).toBe('skipped');
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('should report accurate row numbers for skipped empty rows', () => {
    fc.assert(
      fc.property(mixedRowsArb, (rows) => {
        const skippedRowNumbers: number[] = [];

        for (let i = 0; i < rows.length; i++) {
          const rowIndex = i + 1; // 1-based index
          const result = parseRow(rows[i].row, rowIndex);
          if (result.type === 'skipped') {
            skippedRowNumbers.push(result.rowNumber);
          }
        }

        // Verify skipped row numbers match the actual positions of empty rows
        const expectedSkippedPositions = rows
          .map((r, i) => (r.isEmpty ? i + 1 : null))
          .filter((n): n is number => n !== null);

        expect(skippedRowNumbers).toEqual(expect.arrayContaining(expectedSkippedPositions));
        expect(expectedSkippedPositions).toEqual(expect.arrayContaining(skippedRowNumbers));
        expect(skippedRowNumbers.length).toBe(expectedSkippedPositions.length);
      }),
      { numRuns: 200 },
    );
  });

  it('should not skip rows with non-empty content', () => {
    fc.assert(
      fc.property(mixedRowsArb, (rows) => {
        for (let i = 0; i < rows.length; i++) {
          const result = parseRow(rows[i].row, i + 1);
          if (!rows[i].isEmpty) {
            expect(result.type).toBe('parsed');
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('should correctly identify all empty row positions regardless of placement', () => {
    // Generate rows with specifically controlled placement of empty rows
    const placementArb = fc
      .tuple(
        fc.integer({ min: 1, max: 30 }), // total rows
        fc.array(fc.integer({ min: 0, max: 29 }), { minLength: 0, maxLength: 15 }),
      )
      .map(([totalRows, emptyIndices]) => {
        // Clamp empty indices to valid range and deduplicate
        const validEmptyIndices = [...new Set(emptyIndices.filter((i) => i < totalRows))];
        return { totalRows, emptyIndices: validEmptyIndices };
      })
      .filter(({ totalRows }) => totalRows > 0);

    fc.assert(
      fc.property(
        placementArb,
        nonEmptyContentArb,
        emptyContentArb,
        ({ totalRows, emptyIndices }, nonEmptyContent, emptyContent) => {
          // Build rows with empty content at specified indices
          const rows: Record<string, string>[] = [];
          for (let i = 0; i < totalRows; i++) {
            if (emptyIndices.includes(i)) {
              rows.push({ content: emptyContent, content_type: 'note' });
            } else {
              rows.push({ content: nonEmptyContent, content_type: 'note' });
            }
          }

          // Process all rows and collect skipped row numbers
          const skippedRowNumbers: number[] = [];
          for (let i = 0; i < rows.length; i++) {
            const result = parseRow(rows[i], i + 1);
            if (result.type === 'skipped') {
              skippedRowNumbers.push(result.rowNumber);
            }
          }

          // Expected skipped positions (1-based)
          const expectedSkipped = emptyIndices.map((i) => i + 1).sort((a, b) => a - b);
          const actualSkipped = [...skippedRowNumbers].sort((a, b) => a - b);

          expect(actualSkipped).toEqual(expectedSkipped);
        },
      ),
      { numRuns: 200 },
    );
  });
});
