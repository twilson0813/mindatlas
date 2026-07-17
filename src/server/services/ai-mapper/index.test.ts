import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  categorizeItem,
  mapRelationships,
  generateMap,
  queryItems,
  suggestRelated,
  setOpenAIClient,
  type CategoryResult,
  type QueryResult,
  type SuggestResult,
  type MapResult,
  type RelationshipResult,
} from './index.js';
import type { Item } from '../items/index.js';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

vi.mock('../../db/db.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryMany: vi.fn().mockResolvedValue([]),
  withTransaction: vi.fn(async (fn: (...args: unknown[]) => unknown) => {
    const mockTxQuery = vi
      .fn()
      .mockResolvedValue({
        rows: [{ id: 'mock-id', name: 'mock', color: '#000', category_id: 'cat-1' }],
      });
    return fn(mockTxQuery);
  }),
}));

vi.mock('../../utils/encryption.js', () => ({
  encrypt: vi.fn((text: string) => `encrypted:${text}`),
  decrypt: vi.fn((text: string) => text.replace('encrypted:', '')),
}));

vi.mock('../credentials/index.js', () => ({
  getOpenAICredentials: vi.fn().mockResolvedValue({
    apiKey: 'test-openai-api-key',
  }),
}));

vi.mock('../../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockItem(overrides?: Partial<Item>): Item {
  return {
    id: 'item-1',
    user_id: 'user-1',
    title: 'Test Item',
    content: 'This is a test item about machine learning and Python programming.',
    content_type: 'note',
    metadata: null,
    source_channel: 'api',
    source_domain: null,
    file_path: null,
    file_size: null,
    is_deleted: false,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function createMockOpenAIClient(responseContent: string) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: responseContent } }],
        }),
      },
    },
  } as any;
}

function createFailingOpenAIClient(error: Error) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockRejectedValue(error),
      },
    },
  } as any;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AI Mapper Service', () => {
  afterEach(() => {
    setOpenAIClient(null);
    vi.clearAllMocks();
  });

  // ─── categorizeItem ──────────────────────────────────────────────────────

  describe('categorizeItem', () => {
    it('should categorize an item with categories and tags', async () => {
      const mockResponse = JSON.stringify({
        categories: [
          { name: 'Technology', confidence: 0.95 },
          { name: 'Education', confidence: 0.7 },
        ],
        tags: [
          { name: 'machine-learning', categoryName: 'technology', confidence: 0.92 },
          { name: 'python', categoryName: 'technology', confidence: 0.88 },
        ],
      });

      setOpenAIClient(createMockOpenAIClient(mockResponse));
      const item = createMockItem();

      const result = await categorizeItem(item);

      expect(result.itemId).toBe('item-1');
      expect(result.categories).toHaveLength(2);
      expect(result.tags).toHaveLength(2);
      expect(result.error).toBeUndefined();
      // Categories should be lowercased
      expect(result.categories[0].name).toBe('technology');
      expect(result.categories[1].name).toBe('education');
      // Confidence clamped to [0, 1]
      expect(result.categories[0].confidence).toBeGreaterThanOrEqual(0);
      expect(result.categories[0].confidence).toBeLessThanOrEqual(1);
    });

    it('should clamp confidence scores to [0, 1]', async () => {
      const mockResponse = JSON.stringify({
        categories: [
          { name: 'tech', confidence: 1.5 },
          { name: 'other', confidence: -0.3 },
        ],
        tags: [{ name: 'ai', categoryName: 'tech', confidence: 2.0 }],
      });

      setOpenAIClient(createMockOpenAIClient(mockResponse));
      const item = createMockItem();

      const result = await categorizeItem(item);

      expect(result.categories[0].confidence).toBe(1);
      expect(result.categories[1].confidence).toBe(0);
      expect(result.tags[0].confidence).toBe(1);
    });

    it('should return error state when OpenAI fails', async () => {
      setOpenAIClient(createFailingOpenAIClient(new Error('Rate limit exceeded')));
      const item = createMockItem();

      const result = await categorizeItem(item);

      expect(result.itemId).toBe('item-1');
      expect(result.categories).toHaveLength(0);
      expect(result.tags).toHaveLength(0);
      expect(result.error).toContain('AI categorization failed');
      expect(result.error).toContain('Rate limit exceeded');
      expect(result.error).toContain('Please retry');
    });

    it('should return error when AI response is empty', async () => {
      const client = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: null } }],
            }),
          },
        },
      } as any;

      setOpenAIClient(client);
      const item = createMockItem();

      const result = await categorizeItem(item);

      expect(result.error).toBe('Empty response from AI');
      expect(result.categories).toHaveLength(0);
    });

    it('should return error when AI response is not valid JSON', async () => {
      setOpenAIClient(createMockOpenAIClient('not json at all'));
      const item = createMockItem();

      const result = await categorizeItem(item);

      expect(result.error).toBe('Failed to parse AI response');
    });
  });

  // ─── mapRelationships ────────────────────────────────────────────────────

  describe('mapRelationships', () => {
    it('should identify relationships between items', async () => {
      const item = createMockItem({ id: 'new-item' });
      const existingItems = [
        createMockItem({ id: 'existing-1', title: 'Python Basics' }),
        createMockItem({ id: 'existing-2', title: 'Data Science' }),
      ];

      const mockResponse = JSON.stringify({
        relationships: [
          { targetItemId: 'existing-1', relationshipType: 'related_to', strength: 0.85 },
          { targetItemId: 'existing-2', relationshipType: 'builds_on', strength: 0.6 },
        ],
      });

      setOpenAIClient(createMockOpenAIClient(mockResponse));

      const result = await mapRelationships(item, existingItems);

      expect(result).toHaveLength(2);
      expect(result[0].sourceItemId).toBe('new-item');
      expect(result[0].targetItemId).toBe('existing-1');
      expect(result[0].relationshipType).toBe('related_to');
      expect(result[0].strength).toBeGreaterThanOrEqual(0);
      expect(result[0].strength).toBeLessThanOrEqual(1);
    });

    it('should return empty array when no existing items', async () => {
      const item = createMockItem();
      const result = await mapRelationships(item, []);
      expect(result).toHaveLength(0);
    });

    it('should filter out invalid target IDs from AI response', async () => {
      const item = createMockItem({ id: 'new-item' });
      const existingItems = [createMockItem({ id: 'existing-1' })];

      const mockResponse = JSON.stringify({
        relationships: [
          { targetItemId: 'existing-1', relationshipType: 'related_to', strength: 0.8 },
          { targetItemId: 'nonexistent-id', relationshipType: 'related_to', strength: 0.7 },
        ],
      });

      setOpenAIClient(createMockOpenAIClient(mockResponse));

      const result = await mapRelationships(item, existingItems);

      expect(result).toHaveLength(1);
      expect(result[0].targetItemId).toBe('existing-1');
    });

    it('should return empty array when OpenAI fails', async () => {
      setOpenAIClient(createFailingOpenAIClient(new Error('API error')));
      const item = createMockItem();
      const existingItems = [createMockItem({ id: 'existing-1' })];

      const result = await mapRelationships(item, existingItems);

      expect(result).toHaveLength(0);
    });

    it('should clamp strength values to [0, 1]', async () => {
      const item = createMockItem({ id: 'new-item' });
      const existingItems = [createMockItem({ id: 'existing-1' })];

      const mockResponse = JSON.stringify({
        relationships: [
          { targetItemId: 'existing-1', relationshipType: 'related_to', strength: 1.5 },
        ],
      });

      setOpenAIClient(createMockOpenAIClient(mockResponse));

      const result = await mapRelationships(item, existingItems);

      expect(result[0].strength).toBe(1);
    });
  });

  // ─── generateMap ─────────────────────────────────────────────────────────

  describe('generateMap', () => {
    it('should return empty map when user has no items', async () => {
      const { queryMany } = await import('../../db/db.js');
      vi.mocked(queryMany).mockResolvedValue([]);

      const result = await generateMap('user-1');

      expect(result.userId).toBe('user-1');
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
      expect(result.title).toBe('Empty Map');
    });

    it('should build map with nodes and edges from user items', async () => {
      const { queryMany, queryOne, query: queryFn } = await import('../../db/db.js');

      // First call: items, second call: relationships
      vi.mocked(queryMany)
        .mockResolvedValueOnce([
          {
            id: 'item-1',
            user_id: 'user-1',
            title: 'Item 1',
            content_encrypted: 'encrypted:content1',
            content_type: 'note',
            metadata: null,
            source_channel: 'api',
            created_at: new Date(),
          },
          {
            id: 'item-2',
            user_id: 'user-1',
            title: 'Item 2',
            content_encrypted: 'encrypted:content2',
            content_type: 'note',
            metadata: null,
            source_channel: 'api',
            created_at: new Date(),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'rel-1',
            source_item_id: 'item-1',
            target_item_id: 'item-2',
            relationship_type: 'related_to',
            strength: 0.8,
          },
        ]);

      vi.mocked(queryOne).mockResolvedValue({ id: 'map-1' });
      vi.mocked(queryFn).mockResolvedValue({ rows: [], rowCount: 0 } as any);

      const result = await generateMap('user-1');

      expect(result.userId).toBe('user-1');
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].sourceItemId).toBe('item-1');
      expect(result.edges[0].targetItemId).toBe('item-2');
      expect(result.edges[0].strength).toBeLessThanOrEqual(1);
      expect(result.edges[0].strength).toBeGreaterThanOrEqual(0);
    });

    it('should return error state when database query fails', async () => {
      const { queryMany } = await import('../../db/db.js');
      vi.mocked(queryMany).mockRejectedValue(new Error('DB connection failed'));

      const result = await generateMap('user-1');

      expect(result.error).toContain('Map generation failed');
      expect(result.error).toContain('Please retry');
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });
  });

  // ─── queryItems ──────────────────────────────────────────────────────────

  describe('queryItems', () => {
    it('should return matching items and summary from natural language query', async () => {
      const { queryMany } = await import('../../db/db.js');
      vi.mocked(queryMany).mockResolvedValue([
        {
          id: 'item-1',
          user_id: 'user-1',
          title: 'ML Notes',
          content_encrypted: 'encrypted:Machine learning basics',
          content_type: 'note',
          metadata: null,
          source_channel: 'api',
          created_at: new Date(),
        },
        {
          id: 'item-2',
          user_id: 'user-1',
          title: 'Python Tips',
          content_encrypted: 'encrypted:Python programming tips',
          content_type: 'note',
          metadata: null,
          source_channel: 'api',
          created_at: new Date(),
        },
      ]);

      const mockResponse = JSON.stringify({
        relevantItems: [{ id: 'item-1', relevanceScore: 0.95 }],
        summary: 'Your ML Notes cover the basics of machine learning.',
      });

      setOpenAIClient(createMockOpenAIClient(mockResponse));

      const result = await queryItems('user-1', 'What do I know about machine learning?');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('item-1');
      expect(result.items[0].relevanceScore).toBe(0.95);
      expect(result.summary).toContain('ML Notes');
      expect(result.error).toBeUndefined();
    });

    it('should return empty result when user has no items', async () => {
      const { queryMany } = await import('../../db/db.js');
      vi.mocked(queryMany).mockResolvedValue([]);

      const result = await queryItems('user-1', 'anything');

      expect(result.items).toHaveLength(0);
      expect(result.summary).toBe('No items found in your collection.');
    });

    it('should return error state when OpenAI fails', async () => {
      const { queryMany } = await import('../../db/db.js');
      vi.mocked(queryMany).mockResolvedValue([
        {
          id: 'item-1',
          user_id: 'user-1',
          title: 'Test',
          content_encrypted: 'encrypted:test',
          content_type: 'note',
          metadata: null,
          source_channel: 'api',
          created_at: new Date(),
        },
      ]);

      setOpenAIClient(createFailingOpenAIClient(new Error('Timeout')));

      const result = await queryItems('user-1', 'test query');

      expect(result.error).toContain('Query processing failed');
      expect(result.error).toContain('Please retry');
    });

    it('should filter out invalid item IDs from AI response', async () => {
      const { queryMany } = await import('../../db/db.js');
      vi.mocked(queryMany).mockResolvedValue([
        {
          id: 'item-1',
          user_id: 'user-1',
          title: 'Test',
          content_encrypted: 'encrypted:content',
          content_type: 'note',
          metadata: null,
          source_channel: 'api',
          created_at: new Date(),
        },
      ]);

      const mockResponse = JSON.stringify({
        relevantItems: [
          { id: 'item-1', relevanceScore: 0.9 },
          { id: 'nonexistent', relevanceScore: 0.8 },
        ],
        summary: 'Results found.',
      });

      setOpenAIClient(createMockOpenAIClient(mockResponse));

      const result = await queryItems('user-1', 'test');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('item-1');
    });
  });

  // ─── suggestRelated ──────────────────────────────────────────────────────

  describe('suggestRelated', () => {
    it('should return related items with recommendations', async () => {
      const { queryOne, queryMany } = await import('../../db/db.js');

      vi.mocked(queryOne).mockResolvedValue({
        id: 'item-1',
        user_id: 'user-1',
        title: 'Target Item',
        content_encrypted: 'encrypted:Target content about AI',
        content_type: 'note',
        metadata: null,
        source_channel: 'api',
        created_at: new Date(),
      });

      vi.mocked(queryMany).mockResolvedValue([
        {
          id: 'item-2',
          user_id: 'user-1',
          title: 'Related Note',
          content_encrypted: 'encrypted:AI related content',
          content_type: 'note',
          metadata: null,
          source_channel: 'api',
          created_at: new Date(),
        },
      ]);

      const mockResponse = JSON.stringify({
        suggestions: [
          {
            itemId: 'item-2',
            relationshipType: 'similar_topic',
            strength: 0.85,
            recommendedAction: 'Merge these notes',
          },
        ],
      });

      setOpenAIClient(createMockOpenAIClient(mockResponse));

      const result = await suggestRelated('user-1', 'item-1');

      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].itemId).toBe('item-2');
      expect(result.suggestions[0].title).toBe('Related Note');
      expect(result.suggestions[0].relationshipType).toBe('similar_topic');
      expect(result.suggestions[0].strength).toBe(0.85);
      expect(result.suggestions[0].recommendedAction).toBe('Merge these notes');
      expect(result.error).toBeUndefined();
    });

    it('should return error when target item not found', async () => {
      const { queryOne } = await import('../../db/db.js');
      vi.mocked(queryOne).mockResolvedValue(null);

      const result = await suggestRelated('user-1', 'nonexistent');

      expect(result.suggestions).toHaveLength(0);
      expect(result.error).toBe('Item not found or access denied');
    });

    it('should return empty suggestions when no other items exist', async () => {
      const { queryOne, queryMany } = await import('../../db/db.js');

      vi.mocked(queryOne).mockResolvedValue({
        id: 'item-1',
        user_id: 'user-1',
        title: 'Solo Item',
        content_encrypted: 'encrypted:Only item',
        content_type: 'note',
        metadata: null,
        source_channel: 'api',
        created_at: new Date(),
      });

      vi.mocked(queryMany).mockResolvedValue([]);

      const result = await suggestRelated('user-1', 'item-1');

      expect(result.suggestions).toHaveLength(0);
      expect(result.error).toBeUndefined();
    });

    it('should return error state when OpenAI fails', async () => {
      const { queryOne, queryMany } = await import('../../db/db.js');

      vi.mocked(queryOne).mockResolvedValue({
        id: 'item-1',
        user_id: 'user-1',
        title: 'Test',
        content_encrypted: 'encrypted:test',
        content_type: 'note',
        metadata: null,
        source_channel: 'api',
        created_at: new Date(),
      });

      vi.mocked(queryMany).mockResolvedValue([
        {
          id: 'item-2',
          user_id: 'user-1',
          title: 'Other',
          content_encrypted: 'encrypted:other',
          content_type: 'note',
          metadata: null,
          source_channel: 'api',
          created_at: new Date(),
        },
      ]);

      setOpenAIClient(createFailingOpenAIClient(new Error('Network error')));

      const result = await suggestRelated('user-1', 'item-1');

      expect(result.suggestions).toHaveLength(0);
      expect(result.error).toContain('Suggestion generation failed');
      expect(result.error).toContain('Please retry');
    });

    it('should filter out suggestions with invalid item IDs', async () => {
      const { queryOne, queryMany } = await import('../../db/db.js');

      vi.mocked(queryOne).mockResolvedValue({
        id: 'item-1',
        user_id: 'user-1',
        title: 'Target',
        content_encrypted: 'encrypted:target',
        content_type: 'note',
        metadata: null,
        source_channel: 'api',
        created_at: new Date(),
      });

      vi.mocked(queryMany).mockResolvedValue([
        {
          id: 'item-2',
          user_id: 'user-1',
          title: 'Valid',
          content_encrypted: 'encrypted:valid',
          content_type: 'note',
          metadata: null,
          source_channel: 'api',
          created_at: new Date(),
        },
      ]);

      const mockResponse = JSON.stringify({
        suggestions: [
          {
            itemId: 'item-2',
            relationshipType: 'related',
            strength: 0.8,
            recommendedAction: 'Link',
          },
          {
            itemId: 'fake-id',
            relationshipType: 'related',
            strength: 0.7,
            recommendedAction: 'N/A',
          },
        ],
      });

      setOpenAIClient(createMockOpenAIClient(mockResponse));

      const result = await suggestRelated('user-1', 'item-1');

      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].itemId).toBe('item-2');
    });
  });

  // ─── Confidence Score Clamping ───────────────────────────────────────────

  describe('Confidence Score Clamping', () => {
    it('should handle NaN confidence values', async () => {
      const mockResponse = JSON.stringify({
        categories: [{ name: 'test', confidence: NaN }],
        tags: [{ name: 'tag', categoryName: 'test', confidence: NaN }],
      });

      setOpenAIClient(createMockOpenAIClient(mockResponse));
      const item = createMockItem();

      const result = await categorizeItem(item);

      expect(result.categories[0].confidence).toBe(0);
      expect(result.tags[0].confidence).toBe(0);
    });
  });
});
