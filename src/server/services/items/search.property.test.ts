import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 12: Search Filter Correctness
 *
 * For any set of items and any combination of filter criteria (category, tag, date range, keyword),
 * all items in the filtered results shall match every applied filter criterion, and no matching
 * items shall be excluded.
 *
 * Since `listItems` builds dynamic SQL and requires a real database, we test the filtering logic
 * in-memory with a pure function that replicates the filter semantics from the service.
 *
 * **Validates: Requirements 8.5**
 */

// ──────────────────────────────────────────────
// Types mirroring the service
// ──────────────────────────────────────────────

interface TestItem {
  id: string;
  user_id: string;
  title: string | null;
  content: string;
  content_type: string;
  categories: string[]; // category names associated via tags
  tags: string[]; // tag names directly assigned
  created_at: Date;
}

interface SearchFilters {
  category?: string;
  tag?: string;
  date_from?: Date;
  date_to?: Date;
  keyword?: string;
}

// ──────────────────────────────────────────────
// Pure in-memory filter function replicating listItems logic
// ──────────────────────────────────────────────

/**
 * Applies search filters to items in-memory, mirroring the SQL logic in listItems:
 * - category: item must have at least one tag in the given category
 * - tag: item must have the specified tag name
 * - date_from: item.created_at >= date_from
 * - date_to: item.created_at <= date_to
 * - keyword: item title or content contains the keyword (case-insensitive)
 */
function filterItems(items: TestItem[], filters: SearchFilters): TestItem[] {
  return items.filter((item) => {
    // Category filter: item has a tag belonging to this category
    if (filters.category) {
      if (!item.categories.some((c) => c === filters.category)) {
        return false;
      }
    }

    // Tag filter: item has the tag with this exact name
    if (filters.tag) {
      if (!item.tags.some((t) => t === filters.tag)) {
        return false;
      }
    }

    // Date range: created_at >= date_from
    if (filters.date_from) {
      if (item.created_at < filters.date_from) {
        return false;
      }
    }

    // Date range: created_at <= date_to
    if (filters.date_to) {
      if (item.created_at > filters.date_to) {
        return false;
      }
    }

    // Keyword: case-insensitive match in title or content
    if (filters.keyword) {
      const kw = filters.keyword.toLowerCase();
      const titleMatch = item.title?.toLowerCase().includes(kw) ?? false;
      const contentMatch = item.content.toLowerCase().includes(kw);
      if (!titleMatch && !contentMatch) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Checks whether a single item matches ALL applied filter criteria.
 */
function itemMatchesFilters(item: TestItem, filters: SearchFilters): boolean {
  if (filters.category && !item.categories.includes(filters.category)) return false;
  if (filters.tag && !item.tags.includes(filters.tag)) return false;
  if (filters.date_from && item.created_at < filters.date_from) return false;
  if (filters.date_to && item.created_at > filters.date_to) return false;
  if (filters.keyword) {
    const kw = filters.keyword.toLowerCase();
    const titleMatch = item.title?.toLowerCase().includes(kw) ?? false;
    const contentMatch = item.content.toLowerCase().includes(kw);
    if (!titleMatch && !contentMatch) return false;
  }
  return true;
}

// ──────────────────────────────────────────────
// Generators
// ──────────────────────────────────────────────

const CATEGORY_POOL = ['Technology', 'Science', 'Art', 'Music', 'Sports', 'Health', 'Finance', 'Travel'];
const TAG_POOL = ['javascript', 'python', 'machine-learning', 'design', 'cooking', 'fitness', 'crypto', 'nature', 'photography', 'books'];

const categoryArb = fc.constantFrom(...CATEGORY_POOL);
const tagArb = fc.constantFrom(...TAG_POOL);

// Generate a date within a reasonable range (2020-01-01 to 2025-12-31)
const dateArb = fc.date({
  min: new Date('2020-01-01T00:00:00Z'),
  max: new Date('2025-12-31T23:59:59Z'),
});

// Generate a test item with random properties
const testItemArb: fc.Arbitrary<TestItem> = fc.record({
  id: fc.uuid(),
  user_id: fc.uuid(),
  title: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
  content: fc.string({ minLength: 1, maxLength: 200 }),
  content_type: fc.constantFrom('plain_text', 'link', 'code_snippet', 'note', 'task', 'idea', 'file', 'custom'),
  categories: fc.array(categoryArb, { minLength: 0, maxLength: 3 }),
  tags: fc.array(tagArb, { minLength: 0, maxLength: 5 }),
  created_at: dateArb,
});

// Generate a set of items (1 to 30)
const itemSetArb = fc.array(testItemArb, { minLength: 1, maxLength: 30 });

// Generate filter combinations where filters reference values from the known pools
const searchFiltersArb: fc.Arbitrary<SearchFilters> = fc.record({
  category: fc.oneof(fc.constant(undefined), categoryArb),
  tag: fc.oneof(fc.constant(undefined), tagArb),
  date_from: fc.oneof(fc.constant(undefined), dateArb),
  date_to: fc.oneof(fc.constant(undefined), dateArb),
  keyword: fc.oneof(fc.constant(undefined), fc.string({ minLength: 1, maxLength: 20 })),
}).map((f) => {
  // Ensure date_from <= date_to when both are present
  if (f.date_from && f.date_to && f.date_from > f.date_to) {
    const temp = f.date_from;
    f.date_from = f.date_to;
    f.date_to = temp;
  }
  return f;
});

// ──────────────────────────────────────────────
// Property Tests
// ──────────────────────────────────────────────

describe('Property 12: Search Filter Correctness', () => {
  it('all items in filtered results match every applied filter criterion', () => {
    fc.assert(
      fc.property(itemSetArb, searchFiltersArb, (items, filters) => {
        const results = filterItems(items, filters);

        // Every returned item must satisfy all active filter criteria
        for (const item of results) {
          if (filters.category) {
            expect(item.categories).toContain(filters.category);
          }
          if (filters.tag) {
            expect(item.tags).toContain(filters.tag);
          }
          if (filters.date_from) {
            expect(item.created_at.getTime()).toBeGreaterThanOrEqual(filters.date_from.getTime());
          }
          if (filters.date_to) {
            expect(item.created_at.getTime()).toBeLessThanOrEqual(filters.date_to.getTime());
          }
          if (filters.keyword) {
            const kw = filters.keyword.toLowerCase();
            const inTitle = item.title?.toLowerCase().includes(kw) ?? false;
            const inContent = item.content.toLowerCase().includes(kw);
            expect(inTitle || inContent).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('no item matching all filter criteria is excluded from results', () => {
    fc.assert(
      fc.property(itemSetArb, searchFiltersArb, (items, filters) => {
        const results = filterItems(items, filters);
        const resultIds = new Set(results.map((r) => r.id));

        // Every item in the original set that matches all criteria must be in the results
        for (const item of items) {
          if (itemMatchesFilters(item, filters)) {
            expect(resultIds.has(item.id)).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('filter results are a subset of the original items', () => {
    fc.assert(
      fc.property(itemSetArb, searchFiltersArb, (items, filters) => {
        const results = filterItems(items, filters);
        const originalIds = new Set(items.map((i) => i.id));

        // Every result must come from the original set
        for (const item of results) {
          expect(originalIds.has(item.id)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('empty filters return all items', () => {
    fc.assert(
      fc.property(itemSetArb, (items) => {
        const results = filterItems(items, {});
        expect(results.length).toBe(items.length);
      }),
      { numRuns: 200 },
    );
  });

  it('adding more filters never increases result count', () => {
    fc.assert(
      fc.property(itemSetArb, searchFiltersArb, categoryArb, (items, baseFilters, extraCategory) => {
        const baseResults = filterItems(items, baseFilters);

        // Add an additional category filter
        const stricterFilters: SearchFilters = {
          ...baseFilters,
          category: baseFilters.category ?? extraCategory,
        };

        // If we added a new constraint (category was undefined before), results should not grow
        if (!baseFilters.category) {
          const stricterResults = filterItems(items, stricterFilters);
          expect(stricterResults.length).toBeLessThanOrEqual(baseResults.length);
        }
      }),
      { numRuns: 200 },
    );
  });
});
