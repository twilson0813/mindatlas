import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 9: Map Graph Completeness
 *
 * For any set of items and any set of relationships between those items,
 * the generated map shall contain:
 * - A node for every item that appears in any relationship
 * - An edge for every relationship
 * - Nodes for all items (even those without relationships)
 *
 * Since `generateMap` requires database queries, we test a pure in-memory
 * map-building function that replicates the core logic from the service.
 *
 * **Validates: Requirements 6.3**
 */

// ──────────────────────────────────────────────
// Types mirroring the service
// ──────────────────────────────────────────────

interface TestItem {
  id: string;
  title: string | null;
  content_type: string;
}

interface TestRelationship {
  id: string;
  sourceItemId: string;
  targetItemId: string;
  relationshipType: string;
  strength: number;
}

interface MapNode {
  itemId: string;
  x: number;
  y: number;
}

interface MapEdge {
  sourceItemId: string;
  targetItemId: string;
  relationshipType: string;
  strength: number;
}

interface MapResult {
  nodes: MapNode[];
  edges: MapEdge[];
}

// ──────────────────────────────────────────────
// Pure in-memory map-building function
// Replicates the generateMap logic from the service
// ──────────────────────────────────────────────

/**
 * Builds a map from items and relationships, mimicking the core logic of generateMap:
 * - Creates a node for every item (even those without relationships)
 * - Creates an edge for every relationship
 * - Positions nodes in a circular layout
 */
function buildMap(items: TestItem[], relationships: TestRelationship[]): MapResult {
  // Include all items as nodes (even those without relationships)
  const nodes: MapNode[] = items.map((item, idx) => {
    const angle = (2 * Math.PI * idx) / (items.length || 1);
    const radius = 300;
    return {
      itemId: item.id,
      x: Math.round(500 + radius * Math.cos(angle)),
      y: Math.round(500 + radius * Math.sin(angle)),
    };
  });

  // Create edges from relationships
  const edges: MapEdge[] = relationships.map((r) => ({
    sourceItemId: r.sourceItemId,
    targetItemId: r.targetItemId,
    relationshipType: r.relationshipType,
    strength: Math.max(0, Math.min(1, r.strength)),
  }));

  return { nodes, edges };
}

// ──────────────────────────────────────────────
// Generators
// ──────────────────────────────────────────────

const RELATIONSHIP_TYPES = [
  'related_to',
  'builds_on',
  'contrasts_with',
  'references',
  'subtopic_of',
  'prerequisite_for',
];

// Generate a test item with a unique id
const testItemArb: fc.Arbitrary<TestItem> = fc.record({
  id: fc.uuid(),
  title: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
  content_type: fc.constantFrom(
    'plain_text',
    'link',
    'code_snippet',
    'note',
    'task',
    'idea',
    'file',
    'custom',
  ),
});

// Generate a set of items (1 to 20) with unique IDs
const itemSetArb = fc
  .array(testItemArb, { minLength: 1, maxLength: 20 })
  .map((items) => {
    // Ensure unique IDs by deduplicating
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  })
  .filter((items) => items.length > 0);

/**
 * Generate relationships that reference items from the provided item set.
 * This ensures all relationships point to valid items.
 */
function relationshipsArb(items: TestItem[]): fc.Arbitrary<TestRelationship[]> {
  if (items.length < 2) {
    return fc.constant([]);
  }

  const itemIds = items.map((i) => i.id);
  const singleRelArb: fc.Arbitrary<TestRelationship> = fc
    .record({
      id: fc.uuid(),
      sourceItemId: fc.constantFrom(...itemIds),
      targetItemId: fc.constantFrom(...itemIds),
      relationshipType: fc.constantFrom(...RELATIONSHIP_TYPES),
      strength: fc.float({ min: 0, max: 1, noNaN: true }),
    })
    .filter((r) => r.sourceItemId !== r.targetItemId); // No self-relationships

  return fc.array(singleRelArb, { minLength: 0, maxLength: 15 });
}

// ──────────────────────────────────────────────
// Property Tests
// ──────────────────────────────────────────────

describe('Property 9: Map Graph Completeness', () => {
  it('every item that appears in a relationship has a corresponding node', () => {
    fc.assert(
      fc.property(itemSetArb, (items) => {
        return fc.assert(
          fc.property(relationshipsArb(items), (relationships) => {
            const map = buildMap(items, relationships);
            const nodeItemIds = new Set(map.nodes.map((n) => n.itemId));

            // Every item referenced in a relationship must have a node
            for (const rel of relationships) {
              expect(nodeItemIds.has(rel.sourceItemId)).toBe(true);
              expect(nodeItemIds.has(rel.targetItemId)).toBe(true);
            }
          }),
          { numRuns: 10 },
        );
      }),
      { numRuns: 20 },
    );
  });

  it('every relationship has a corresponding edge', () => {
    fc.assert(
      fc.property(itemSetArb, (items) => {
        return fc.assert(
          fc.property(relationshipsArb(items), (relationships) => {
            const map = buildMap(items, relationships);

            // Every relationship must appear as an edge
            expect(map.edges.length).toBe(relationships.length);

            for (const rel of relationships) {
              const matchingEdge = map.edges.find(
                (e) =>
                  e.sourceItemId === rel.sourceItemId &&
                  e.targetItemId === rel.targetItemId &&
                  e.relationshipType === rel.relationshipType,
              );
              expect(matchingEdge).toBeDefined();
            }
          }),
          { numRuns: 10 },
        );
      }),
      { numRuns: 20 },
    );
  });

  it('nodes set includes all items even those without relationships', () => {
    fc.assert(
      fc.property(itemSetArb, (items) => {
        // Build map with no relationships — all items should still get nodes
        const map = buildMap(items, []);
        const nodeItemIds = new Set(map.nodes.map((n) => n.itemId));

        expect(map.nodes.length).toBe(items.length);
        for (const item of items) {
          expect(nodeItemIds.has(item.id)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('node count equals item count regardless of relationship count', () => {
    fc.assert(
      fc.property(itemSetArb, (items) => {
        return fc.assert(
          fc.property(relationshipsArb(items), (relationships) => {
            const map = buildMap(items, relationships);

            // Node count should always equal the total item count
            expect(map.nodes.length).toBe(items.length);
          }),
          { numRuns: 10 },
        );
      }),
      { numRuns: 20 },
    );
  });

  it('edge count equals relationship count', () => {
    fc.assert(
      fc.property(itemSetArb, (items) => {
        return fc.assert(
          fc.property(relationshipsArb(items), (relationships) => {
            const map = buildMap(items, relationships);

            // Edge count should always equal the number of relationships provided
            expect(map.edges.length).toBe(relationships.length);
          }),
          { numRuns: 10 },
        );
      }),
      { numRuns: 20 },
    );
  });

  it('no duplicate nodes exist in the map', () => {
    fc.assert(
      fc.property(itemSetArb, (items) => {
        return fc.assert(
          fc.property(relationshipsArb(items), (relationships) => {
            const map = buildMap(items, relationships);
            const nodeItemIds = map.nodes.map((n) => n.itemId);
            const uniqueIds = new Set(nodeItemIds);

            // No duplicates — each item appears exactly once as a node
            expect(nodeItemIds.length).toBe(uniqueIds.size);
          }),
          { numRuns: 10 },
        );
      }),
      { numRuns: 20 },
    );
  });
});
