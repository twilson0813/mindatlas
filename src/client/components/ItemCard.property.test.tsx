import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { render } from '@testing-library/react';
import { ItemCard, type Item } from './ItemCard';

/** Convert a hex color string to the rgb() format used by the DOM style API */
function hexToRgb(hex: string): string {
  const sanitized = hex.replace('#', '');
  const r = parseInt(sanitized.slice(0, 2), 16);
  const g = parseInt(sanitized.slice(2, 4), 16);
  const b = parseInt(sanitized.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Property 11: Item Card Rendering Completeness
 * Verify card displays title, snippet, source domain, timestamp, and all tag badges with hashtag + color.
 * Generator: random items with populated fields.
 *
 * **Validates: Requirements 8.2, 8.4**
 */
describe('Property 11: Item Card Rendering Completeness', () => {
  // Generator for valid hex colors (6-character)
  const hexColorArb = fc
    .array(fc.integer({ min: 0, max: 255 }), { minLength: 3, maxLength: 3 })
    .map(
      ([r, g, b]) =>
        `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
    );

  // Generator for tag names (alphanumeric, non-empty)
  const tagNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{1,14}$/).filter((s) => s.length >= 2);

  // Generator for a tag with id, name, and color
  const tagArb = fc.record({
    id: fc.uuid(),
    name: tagNameArb,
    color: hexColorArb,
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  });

  // Generator for source domains (looks like a domain)
  const sourceDomainArb = fc
    .stringMatching(/^[a-z]{3,10}\.[a-z]{2,5}$/)
    .filter((s) => s.length >= 5);

  // Generator for item titles (non-empty alphanumeric, no consecutive spaces)
  const titleArb = fc
    .stringMatching(/^[A-Za-z][A-Za-z0-9 ]{2,30}$/)
    .filter((s) => s.trim().length >= 3 && !s.includes('  '));

  // Generator for snippets (non-empty alphanumeric, no consecutive spaces)
  const snippetArb = fc
    .stringMatching(/^[A-Za-z][A-Za-z0-9 ]{4,50}$/)
    .filter((s) => s.trim().length >= 5 && !s.includes('  '));

  // Generator for ISO date strings (recent dates)
  const createdAtArb = fc
    .date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
    .map((d) => d.toISOString());

  // Generator for content types
  const contentTypeArb = fc.constantFrom(
    'plain_text',
    'link',
    'code_snippet',
    'note',
    'task',
    'idea',
    'file',
  );

  // Generator for a complete Item with populated fields
  const itemArb: fc.Arbitrary<Item> = fc.record({
    id: fc.uuid(),
    title: titleArb,
    snippet: snippetArb,
    sourceDomain: sourceDomainArb,
    thumbnailUrl: fc.constant(undefined),
    createdAt: createdAtArb,
    contentType: contentTypeArb,
    tags: fc.array(tagArb, { minLength: 1, maxLength: 5 }),
  });

  it('should render title, snippet, source domain, and timestamp for any item', () => {
    fc.assert(
      fc.property(itemArb, (item) => {
        const { container, unmount } = render(<ItemCard item={item} />);
        const article = container.querySelector('article')!;

        // Title is rendered in the h3 element
        const titleEl = article.querySelector('.item-card-title');
        expect(titleEl).not.toBeNull();
        expect(titleEl!.textContent).toBe(item.title);

        // Snippet is rendered in the p element
        const snippetEl = article.querySelector('.item-card-snippet');
        expect(snippetEl).not.toBeNull();
        expect(snippetEl!.textContent).toBe(item.snippet);

        // Source domain is rendered
        const sourceEl = article.querySelector('.item-card-source');
        expect(sourceEl).not.toBeNull();
        expect(sourceEl!.textContent).toBe(item.sourceDomain);

        // Timestamp element is present with correct dateTime attribute
        const timeEl = article.querySelector('time.item-card-timestamp');
        expect(timeEl).not.toBeNull();
        expect(timeEl!.getAttribute('datetime')).toBe(item.createdAt);
        // Timestamp should have some displayed text (not empty)
        expect(timeEl!.textContent!.length).toBeGreaterThan(0);

        unmount();
      }),
      { numRuns: 50 },
    );
  });

  it('should render all tag badges with their names and hashtag notation', () => {
    fc.assert(
      fc.property(itemArb, (item) => {
        const { container, unmount } = render(<ItemCard item={item} />);
        const article = container.querySelector('article')!;

        // Get all badge elements
        const badges = article.querySelectorAll('.category-badge');
        expect(badges.length).toBe(item.tags.length);

        // Each tag should be rendered as a CategoryBadge with its name
        for (const tag of item.tags) {
          const badge = article.querySelector(`[aria-label="Category: ${tag.name}"]`);
          expect(badge).not.toBeNull();
          // Verify the badge text includes the tag name
          expect(badge!.textContent).toContain(tag.name);
          // Verify the hashtag notation is present
          expect(badge!.textContent).toContain('#');
          // Verify the badge color is applied as inline style (DOM normalizes hex to rgb)
          expect((badge as HTMLElement).style.color).toBe(hexToRgb(tag.color));
        }

        unmount();
      }),
      { numRuns: 50 },
    );
  });
});
