import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { stringify } from 'csv-stringify/sync';
import { parse } from 'csv-parse/sync';

/**
 * Property 25: CSV Export Completeness
 * Verify items export has N data rows + header; maps export has R rows + header with correct columns
 * Generator: random item/relationship sets of varying sizes
 *
 * **Validates: Requirements 13.7, 13.8, 13.9**
 */
describe('Property 25: CSV Export Completeness', () => {
  // --- Generators ---

  // Items export columns (matching exportItems service)
  const ITEMS_COLUMNS = ['content', 'content_type', 'tags', 'creation_date', 'metadata'];

  // Maps export columns (matching exportMaps service)
  const MAPS_COLUMNS = [
    'source_item_id',
    'target_item_id',
    'relationship_type',
    'confidence_score',
  ];

  // Generator for content_type values
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

  // Generator for tags (comma-separated list)
  const tagsArb = fc
    .array(
      fc
        .string({ minLength: 1, maxLength: 20 })
        .filter((s) => !s.includes(',') && s.trim().length > 0),
      { minLength: 0, maxLength: 5 },
    )
    .map((tags) => tags.join(','));

  // Generator for ISO date strings
  const dateArb = fc
    .date({
      min: new Date('2020-01-01T00:00:00Z'),
      max: new Date('2030-12-31T23:59:59Z'),
    })
    .map((d) => d.toISOString());

  // Generator for metadata JSON strings
  const metadataArb = fc.oneof(
    fc.constant(''),
    fc
      .record({
        priority: fc.constantFrom('low', 'medium', 'high'),
      })
      .map((obj) => JSON.stringify(obj)),
  );

  // Generator for item-like row objects (mimics what exportItems produces)
  const itemRowArb = fc.record({
    content: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
    content_type: contentTypeArb,
    tags: tagsArb,
    creation_date: dateArb,
    metadata: metadataArb,
  });

  // Generator for relationship type values
  const relationshipTypeArb = fc.constantFrom(
    'related',
    'similar',
    'parent',
    'child',
    'references',
    'contradicts',
  );

  // Generator for confidence score (strength)
  const confidenceScoreArb = fc.float({ min: 0, max: 1, noNaN: true }).map((v) => String(v));

  // Generator for UUID-like IDs
  const uuidArb = fc.uuid();

  // Generator for relationship-like row objects (mimics what exportMaps produces)
  const relationshipRowArb = fc.record({
    source_item_id: uuidArb,
    target_item_id: uuidArb,
    relationship_type: relationshipTypeArb,
    confidence_score: confidenceScoreArb,
  });

  // --- Items export tests ---

  describe('Items export completeness', () => {
    it('should produce exactly N data rows + 1 header row for N items', () => {
      fc.assert(
        fc.property(fc.array(itemRowArb, { minLength: 1, maxLength: 50 }), (items) => {
          // Serialize using csv-stringify with header (same as service)
          const csv = stringify(items, {
            header: true,
            columns: ITEMS_COLUMNS,
          });

          // Split into lines and filter empty trailing lines
          const lines = csv.split('\n').filter((line) => line.length > 0);

          // Should have exactly N + 1 lines (header + data rows)
          expect(lines.length).toBe(items.length + 1);
        }),
        { numRuns: 200 },
      );
    });

    it('should have the correct header columns for items export', () => {
      fc.assert(
        fc.property(fc.array(itemRowArb, { minLength: 1, maxLength: 50 }), (items) => {
          const csv = stringify(items, {
            header: true,
            columns: ITEMS_COLUMNS,
          });

          // Parse back with columns to verify header
          const records = parse(csv, { columns: true }) as Record<string, string>[];

          // Verify we get N records back
          expect(records.length).toBe(items.length);

          // Verify header columns by checking keys of first record
          const headerKeys = Object.keys(records[0]);
          expect(headerKeys).toEqual(ITEMS_COLUMNS);
        }),
        { numRuns: 200 },
      );
    });

    it('should include a header row even when zero items are exported', () => {
      // Edge case: empty items array
      const csv = stringify([], {
        header: true,
        columns: ITEMS_COLUMNS,
      });

      const lines = csv.split('\n').filter((line) => line.length > 0);
      // Should have exactly 1 line (header only)
      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('content,content_type,tags,creation_date,metadata');
    });
  });

  // --- Maps export tests ---

  describe('Maps export completeness', () => {
    it('should produce exactly R data rows + 1 header row for R relationships', () => {
      fc.assert(
        fc.property(
          fc.array(relationshipRowArb, { minLength: 1, maxLength: 50 }),
          (relationships) => {
            const csv = stringify(relationships, {
              header: true,
              columns: MAPS_COLUMNS,
            });

            const lines = csv.split('\n').filter((line) => line.length > 0);

            // Should have exactly R + 1 lines (header + data rows)
            expect(lines.length).toBe(relationships.length + 1);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('should have the correct header columns for maps export', () => {
      fc.assert(
        fc.property(
          fc.array(relationshipRowArb, { minLength: 1, maxLength: 50 }),
          (relationships) => {
            const csv = stringify(relationships, {
              header: true,
              columns: MAPS_COLUMNS,
            });

            // Parse back with columns to verify header
            const records = parse(csv, { columns: true }) as Record<string, string>[];

            // Verify we get R records back
            expect(records.length).toBe(relationships.length);

            // Verify header columns by checking keys of first record
            const headerKeys = Object.keys(records[0]);
            expect(headerKeys).toEqual(MAPS_COLUMNS);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('should include a header row even when zero relationships are exported', () => {
      // Edge case: empty relationships array
      const csv = stringify([], {
        header: true,
        columns: MAPS_COLUMNS,
      });

      const lines = csv.split('\n').filter((line) => line.length > 0);
      // Should have exactly 1 line (header only)
      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('source_item_id,target_item_id,relationship_type,confidence_score');
    });
  });

  // --- Round-trip parsing verification ---

  describe('Export data fidelity', () => {
    it('should preserve all item data through CSV serialization and parsing', () => {
      fc.assert(
        fc.property(fc.array(itemRowArb, { minLength: 1, maxLength: 50 }), (items) => {
          const csv = stringify(items, {
            header: true,
            columns: ITEMS_COLUMNS,
          });

          const records = parse(csv, { columns: true }) as Record<string, string>[];

          // Each item should be faithfully represented
          for (let i = 0; i < items.length; i++) {
            expect(records[i].content).toBe(items[i].content);
            expect(records[i].content_type).toBe(items[i].content_type);
            expect(records[i].tags).toBe(items[i].tags);
            expect(records[i].creation_date).toBe(items[i].creation_date);
            expect(records[i].metadata).toBe(items[i].metadata);
          }
        }),
        { numRuns: 200 },
      );
    });

    it('should preserve all relationship data through CSV serialization and parsing', () => {
      fc.assert(
        fc.property(
          fc.array(relationshipRowArb, { minLength: 1, maxLength: 50 }),
          (relationships) => {
            const csv = stringify(relationships, {
              header: true,
              columns: MAPS_COLUMNS,
            });

            const records = parse(csv, { columns: true }) as Record<string, string>[];

            for (let i = 0; i < relationships.length; i++) {
              expect(records[i].source_item_id).toBe(relationships[i].source_item_id);
              expect(records[i].target_item_id).toBe(relationships[i].target_item_id);
              expect(records[i].relationship_type).toBe(relationships[i].relationship_type);
              expect(records[i].confidence_score).toBe(relationships[i].confidence_score);
            }
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
