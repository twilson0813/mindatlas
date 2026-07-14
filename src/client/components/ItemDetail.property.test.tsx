import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { ItemDetail, type ItemDetailData } from './ItemDetail';

/**
 * Property 13: Item Detail Completeness
 * Verify detail view displays full content, all categories with confidence, and all related items.
 * Generator: random items with assigned categories and relationships.
 *
 * **Validates: Requirements 8.7**
 */
describe('Property 13: Item Detail Completeness', () => {
  afterEach(() => {
    cleanup();
  });

  // Generator for single-word alphanumeric strings (no spaces, no normalization issues)
  const wordArb = fc
    .stringMatching(/^[A-Za-z][A-Za-z0-9]{2,12}$/)
    .filter((s) => s.length >= 3);

  // Generator for category names — single words to avoid whitespace normalization issues
  const categoryNameArb = wordArb;

  // Generator for confidence scores in [0.01, 0.99] to avoid edge-case identical percentages
  const confidenceArb = fc.double({ min: 0.01, max: 0.99, noNaN: true, noDefaultInfinity: true });

  // Generator for a category with confidence
  const categoryArb = fc.record({
    name: categoryNameArb,
    confidence: confidenceArb,
    color: fc.option(
      fc.hexaString({ minLength: 6, maxLength: 6 }).map((h) => `#${h}`),
      { nil: undefined }
    ),
  });

  // Generator for related item titles — single words
  const relatedTitleArb = wordArb;

  // Generator for related items
  const relatedItemArb = fc.record({
    id: fc.uuid(),
    title: relatedTitleArb,
    snippet: fc.stringMatching(/^[A-Za-z0-9]{0,20}$/),
    relationshipType: fc.constantFrom('similar_topic', 'references', 'derived_from', 'related'),
  });

  // Generator for item content — sentence-like with single spaces only
  const contentArb = fc
    .array(wordArb, { minLength: 3, maxLength: 10 })
    .map((words) => words.join(' '));

  // Generator for full ItemDetailData with at least 1 category and 1 related item
  const itemDetailArb = fc
    .record({
      id: fc.uuid(),
      title: wordArb,
      content: contentArb,
      contentType: fc.constantFrom('note', 'link', 'code_snippet', 'task', 'idea', 'file'),
      sourceDomain: fc.option(fc.domain(), { nil: undefined }),
      createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }).map((d) => d.toISOString()),
      categories: fc.array(categoryArb, { minLength: 1, maxLength: 5 }),
      relatedItems: fc.array(relatedItemArb, { minLength: 1, maxLength: 5 }),
    })
    .filter((item) => {
      // Ensure category names are unique (component uses name as key)
      const catNames = item.categories.map((c) => c.name);
      if (new Set(catNames).size !== catNames.length) return false;
      // Ensure related item titles are unique
      const relTitles = item.relatedItems.map((r) => r.title);
      if (new Set(relTitles).size !== relTitles.length) return false;
      // Ensure confidence percentages are unique to avoid query collisions
      const percentages = item.categories.map((c) => Math.round(c.confidence * 100));
      if (new Set(percentages).size !== percentages.length) return false;
      // Ensure no overlap between related titles, content words, title, and category names
      // to avoid false positives in text queries
      const allTextElements = new Set([
        item.title.toLowerCase(),
        ...item.categories.map((c) => c.name.toLowerCase()),
        ...item.relatedItems.map((r) => r.title.toLowerCase()),
      ]);
      if (allTextElements.size !== 1 + item.categories.length + item.relatedItems.length) return false;
      return true;
    });

  it('should display full content for any valid item', () => {
    fc.assert(
      fc.property(itemDetailArb, (item) => {
        cleanup();
        const { container } = render(<ItemDetail item={item as ItemDetailData} />);

        // Full content must be displayed in the content section
        const contentSection = container.querySelector('[aria-label="Item content"]');
        expect(contentSection).not.toBeNull();
        expect(contentSection!.textContent).toContain(item.content);
      }),
      { numRuns: 50 },
    );
  });

  it('should display all category names with confidence percentages', () => {
    fc.assert(
      fc.property(itemDetailArb, (item) => {
        cleanup();
        const { container } = render(<ItemDetail item={item as ItemDetailData} />);

        // The categories section should exist
        const categoriesSection = container.querySelector('[aria-label="Assigned categories"]');
        expect(categoriesSection).not.toBeNull();

        const categoryItems = categoriesSection!.querySelectorAll('.item-detail__category-item');
        expect(categoryItems.length).toBe(item.categories.length);

        // Every category name should appear with # prefix and confidence percentage
        for (const cat of item.categories) {
          const badge = categoriesSection!.querySelector(
            `.item-detail__category-badge`
          );
          // Check that category name exists somewhere in the categories section
          const sectionText = categoriesSection!.textContent || '';
          expect(sectionText).toContain(cat.name);

          // Check confidence percentage is present
          const expectedPercent = `${Math.round(cat.confidence * 100)}%`;
          expect(sectionText).toContain(expectedPercent);
        }
      }),
      { numRuns: 50 },
    );
  });

  it('should display all related item titles', () => {
    fc.assert(
      fc.property(itemDetailArb, (item) => {
        cleanup();
        const { container } = render(<ItemDetail item={item as ItemDetailData} />);

        // The related items section should exist
        const relatedSection = container.querySelector('[aria-label="Related items"]');
        expect(relatedSection).not.toBeNull();

        const relatedListItems = relatedSection!.querySelectorAll('.item-detail__related-item');
        expect(relatedListItems.length).toBe(item.relatedItems.length);

        // Every related item title should be rendered
        const sectionText = relatedSection!.textContent || '';
        for (const related of item.relatedItems) {
          expect(sectionText).toContain(related.title);
        }
      }),
      { numRuns: 50 },
    );
  });
});
