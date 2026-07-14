import OpenAI from 'openai';
import { config } from '../../config.js';
import { query, queryOne, queryMany, withTransaction } from '../../db/db.js';
import { decrypt } from '../../utils/encryption.js';
import { createChildLogger } from '../../logger.js';
import type { Item } from '../items/index.js';

const log = createChildLogger({ module: 'ai-mapper' });

// ─── Types ───────────────────────────────────────────────────────────────────

/** Result of AI categorization for an item */
export interface CategoryResult {
  itemId: string;
  categories: Array<{
    name: string;
    confidence: number;
  }>;
  tags: Array<{
    name: string;
    categoryName: string;
    confidence: number;
  }>;
  error?: string;
}

/** A relationship identified between two items */
export interface RelationshipResult {
  sourceItemId: string;
  targetItemId: string;
  relationshipType: string;
  strength: number;
}

/** A generated map of user's item relationships */
export interface MapResult {
  id: string;
  userId: string;
  title: string;
  nodes: Array<{
    itemId: string;
    x: number;
    y: number;
  }>;
  edges: Array<{
    sourceItemId: string;
    targetItemId: string;
    relationshipType: string;
    strength: number;
  }>;
  generatedAt: string;
  error?: string;
}

/** Result from a natural language query */
export interface QueryResult {
  items: Array<{
    id: string;
    title: string | null;
    content: string;
    relevanceScore: number;
  }>;
  summary: string;
  error?: string;
}

/** Suggestion for related items and actions */
export interface Suggestion {
  itemId: string;
  title: string | null;
  relationshipType: string;
  strength: number;
  recommendedAction: string;
}

export interface SuggestResult {
  suggestions: Suggestion[];
  error?: string;
}

// ─── OpenAI Client ───────────────────────────────────────────────────────────

/**
 * Creates and returns an OpenAI client instance.
 * Exposed for testability (can be overridden in tests).
 */
export function createOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: config.openaiApiKey,
  });
}

/** Module-level client, lazily created */
let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = createOpenAIClient();
  }
  return openaiClient;
}

/**
 * Allows injecting a mock/stub OpenAI client for testing.
 */
export function setOpenAIClient(client: OpenAI | null): void {
  openaiClient = client;
}

// ─── Helper Utilities ────────────────────────────────────────────────────────

/**
 * Clamps a value between 0 and 1 (inclusive).
 */
function clampConfidence(value: number): number {
  if (typeof value !== 'number' || isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Safely parses a JSON response from OpenAI.
 */
function safeParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ─── Database Row Types ──────────────────────────────────────────────────────

interface ItemRow {
  id: string;
  user_id: string;
  title: string | null;
  content_encrypted: string;
  content_type: string;
  metadata: Record<string, unknown> | null;
  source_channel: string | null;
  created_at: Date;
}

interface CategoryRow {
  id: string;
  name: string;
  color: string;
}

interface TagRow {
  id: string;
  name: string;
  category_id: string;
  color: string;
}

// ─── categorizeItem ──────────────────────────────────────────────────────────

/**
 * Assigns categories and tags to an item using OpenAI.
 * Calls the chat completions API with JSON mode to get structured categorization.
 * Confidence scores are clamped to [0, 1].
 *
 * Requirements: 6.1, 6.5
 */
export async function categorizeItem(item: Item): Promise<CategoryResult> {
  const client = getClient();

  try {
    const prompt = `You are an AI content categorizer. Analyze the following content and assign relevant categories and tags.

Content Title: ${item.title || 'Untitled'}
Content Type: ${item.content_type}
Content: ${item.content}

Respond with a JSON object with this exact structure:
{
  "categories": [
    { "name": "category_name", "confidence": 0.0 to 1.0 }
  ],
  "tags": [
    { "name": "tag_name", "categoryName": "parent_category_name", "confidence": 0.0 to 1.0 }
  ]
}

Rules:
- Assign 1-5 categories that best describe the content
- Assign 1-10 tags within those categories
- Confidence scores must be between 0.0 and 1.0
- Use descriptive, lowercase category and tag names
- Categories should be broad (e.g., "technology", "health", "finance")
- Tags should be specific (e.g., "machine-learning", "python", "api-design")`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { itemId: item.id, categories: [], tags: [], error: 'Empty response from AI' };
    }

    const parsed = safeParseJson<{
      categories: Array<{ name: string; confidence: number }>;
      tags: Array<{ name: string; categoryName: string; confidence: number }>;
    }>(content);

    if (!parsed) {
      return { itemId: item.id, categories: [], tags: [], error: 'Failed to parse AI response' };
    }

    // Clamp all confidence scores to [0, 1]
    const categories = (parsed.categories || []).map((c) => ({
      name: c.name?.toLowerCase() || 'uncategorized',
      confidence: clampConfidence(c.confidence),
    }));

    const tags = (parsed.tags || []).map((t) => ({
      name: t.name?.toLowerCase() || 'untagged',
      categoryName: t.categoryName?.toLowerCase() || 'general',
      confidence: clampConfidence(t.confidence),
    }));

    // Persist categories and tags to database
    await persistCategorization(item.id, categories, tags);

    log.info({ itemId: item.id, categoryCount: categories.length, tagCount: tags.length }, 'Item categorized');

    return { itemId: item.id, categories, tags };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown AI error';
    log.error({ itemId: item.id, error: message }, 'AI categorization failed');
    return { itemId: item.id, categories: [], tags: [], error: `AI categorization failed: ${message}. Please retry.` };
  }
}

/**
 * Persists categorization results (categories and tags) to the database.
 * Creates categories/tags if they don't exist, then links them to the item.
 */
async function persistCategorization(
  itemId: string,
  categories: Array<{ name: string; confidence: number }>,
  tags: Array<{ name: string; categoryName: string; confidence: number }>
): Promise<void> {
  await withTransaction(async (txQuery) => {
    for (const tag of tags) {
      // Ensure category exists
      let categoryRow = await txQuery<CategoryRow>(
        `SELECT id, name, color FROM categories WHERE name = $1`,
        [tag.categoryName]
      ).then((r) => r.rows[0] ?? null);

      if (!categoryRow) {
        const insertResult = await txQuery<CategoryRow>(
          `INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id, name, color`,
          [tag.categoryName]
        );
        categoryRow = insertResult.rows[0];
      }

      // Ensure tag exists
      let tagRow = await txQuery<TagRow>(
        `SELECT id, name, category_id, color FROM tags WHERE name = $1 AND category_id = $2`,
        [tag.name, categoryRow.id]
      ).then((r) => r.rows[0] ?? null);

      if (!tagRow) {
        const insertResult = await txQuery<TagRow>(
          `INSERT INTO tags (name, category_id) VALUES ($1, $2) ON CONFLICT (name, category_id) DO UPDATE SET name = EXCLUDED.name RETURNING id, name, category_id, color`,
          [tag.name, categoryRow.id]
        );
        tagRow = insertResult.rows[0];
      }

      // Link tag to item with confidence score
      await txQuery(
        `INSERT INTO item_tags (item_id, tag_id, confidence_score)
         VALUES ($1, $2, $3)
         ON CONFLICT (item_id, tag_id) DO UPDATE SET confidence_score = EXCLUDED.confidence_score`,
        [itemId, tagRow.id, tag.confidence]
      );
    }
  });
}

// ─── mapRelationships ────────────────────────────────────────────────────────

/**
 * Identifies relationships between a new item and existing items owned by the same user.
 * Uses OpenAI to analyze content similarity and semantic connections.
 *
 * Requirements: 6.2
 */
export async function mapRelationships(
  item: Item,
  existingItems: Item[]
): Promise<RelationshipResult[]> {
  const client = getClient();

  if (existingItems.length === 0) {
    return [];
  }

  try {
    // Limit context to avoid token overflow — take most recent 20 items
    const contextItems = existingItems.slice(0, 20);

    const existingItemsSummary = contextItems.map((ei, idx) => (
      `[${idx}] ID: ${ei.id} | Title: ${ei.title || 'Untitled'} | Type: ${ei.content_type} | Content: ${ei.content.substring(0, 200)}`
    )).join('\n');

    const prompt = `You are an AI relationship mapper. Analyze the NEW item and identify its relationships with the EXISTING items.

NEW ITEM:
ID: ${item.id}
Title: ${item.title || 'Untitled'}
Type: ${item.content_type}
Content: ${item.content}

EXISTING ITEMS:
${existingItemsSummary}

Respond with a JSON object:
{
  "relationships": [
    {
      "targetItemId": "id of the existing item",
      "relationshipType": "type of relationship (e.g., 'related_to', 'builds_on', 'contrasts_with', 'references', 'subtopic_of', 'prerequisite_for')",
      "strength": 0.0 to 1.0
    }
  ]
}

Rules:
- Only include relationships with strength >= 0.3
- Relationship types should be descriptive and lowercase
- Strength must be between 0.0 and 1.0 (1.0 = very strong relationship)
- Return an empty array if no meaningful relationships exist
- Maximum 10 relationships`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return [];
    }

    const parsed = safeParseJson<{
      relationships: Array<{
        targetItemId: string;
        relationshipType: string;
        strength: number;
      }>;
    }>(content);

    if (!parsed || !Array.isArray(parsed.relationships)) {
      return [];
    }

    // Validate target IDs exist in provided items and clamp strength
    const validItemIds = new Set(contextItems.map((i) => i.id));
    const relationships: RelationshipResult[] = parsed.relationships
      .filter((r) => validItemIds.has(r.targetItemId))
      .map((r) => ({
        sourceItemId: item.id,
        targetItemId: r.targetItemId,
        relationshipType: r.relationshipType || 'related_to',
        strength: clampConfidence(r.strength),
      }));

    // Persist relationships to database
    await persistRelationships(relationships);

    log.info({ itemId: item.id, relationshipCount: relationships.length }, 'Relationships mapped');

    return relationships;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown AI error';
    log.error({ itemId: item.id, error: message }, 'AI relationship mapping failed');
    return [];
  }
}

/**
 * Persists relationship results to the database.
 */
async function persistRelationships(relationships: RelationshipResult[]): Promise<void> {
  for (const rel of relationships) {
    await query(
      `INSERT INTO relationships (source_item_id, target_item_id, relationship_type, strength)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [rel.sourceItemId, rel.targetItemId, rel.relationshipType, rel.strength]
    );
  }
}

// ─── generateMap ─────────────────────────────────────────────────────────────

/**
 * Builds a full relationship map for a user's items.
 * Fetches all user's items and their relationships, then uses AI to suggest layout.
 *
 * Requirements: 6.3, 6.4
 */
export async function generateMap(userId: string): Promise<MapResult> {
  try {
    // Fetch all non-deleted items for the user
    const itemRows = await queryMany<ItemRow>(
      `SELECT id, user_id, title, content_encrypted, content_type, metadata, source_channel, created_at
       FROM items
       WHERE user_id = $1 AND is_deleted = false
       ORDER BY created_at DESC`,
      [userId]
    );

    if (itemRows.length === 0) {
      return {
        id: '',
        userId,
        title: 'Empty Map',
        nodes: [],
        edges: [],
        generatedAt: new Date().toISOString(),
      };
    }

    // Fetch all relationships between user's items
    const relationships = await queryMany<{
      id: string;
      source_item_id: string;
      target_item_id: string;
      relationship_type: string;
      strength: number;
    }>(
      `SELECT r.id, r.source_item_id, r.target_item_id, r.relationship_type, r.strength
       FROM relationships r
       JOIN items src ON r.source_item_id = src.id AND src.user_id = $1 AND src.is_deleted = false
       JOIN items tgt ON r.target_item_id = tgt.id AND tgt.user_id = $1 AND tgt.is_deleted = false`,
      [userId]
    );

    // Build nodes — items that participate in relationships
    const itemIdsInRelationships = new Set<string>();
    for (const rel of relationships) {
      itemIdsInRelationships.add(rel.source_item_id);
      itemIdsInRelationships.add(rel.target_item_id);
    }

    // Include all items as nodes (even those without relationships)
    const nodes = itemRows.map((item, idx) => {
      // Simple force-directed-like layout using circular positioning
      const angle = (2 * Math.PI * idx) / itemRows.length;
      const radius = 300;
      return {
        itemId: item.id,
        x: Math.round(500 + radius * Math.cos(angle)),
        y: Math.round(500 + radius * Math.sin(angle)),
      };
    });

    const edges = relationships.map((r) => ({
      sourceItemId: r.source_item_id,
      targetItemId: r.target_item_id,
      relationshipType: r.relationship_type,
      strength: clampConfidence(r.strength),
    }));

    // Persist map to database
    const mapRow = await queryOne<{ id: string }>(
      `INSERT INTO maps (user_id, title, layout_data, generated_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id`,
      [userId, 'Auto-generated Map', JSON.stringify({ nodes, edges })]
    );

    const mapId = mapRow?.id || '';

    // Persist map nodes
    for (const node of nodes) {
      await query(
        `INSERT INTO map_nodes (map_id, item_id, x_position, y_position)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (map_id, item_id) DO UPDATE SET x_position = EXCLUDED.x_position, y_position = EXCLUDED.y_position`,
        [mapId, node.itemId, node.x, node.y]
      );
    }

    // Persist map edges
    for (const rel of relationships) {
      await query(
        `INSERT INTO map_edges (map_id, relationship_id)
         VALUES ($1, $2)
         ON CONFLICT (map_id, relationship_id) DO NOTHING`,
        [mapId, rel.id]
      );
    }

    log.info({ userId, mapId, nodeCount: nodes.length, edgeCount: edges.length }, 'Map generated');

    return {
      id: mapId,
      userId,
      title: 'Auto-generated Map',
      nodes,
      edges,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error({ userId, error: message }, 'Map generation failed');
    return {
      id: '',
      userId,
      title: 'Error',
      nodes: [],
      edges: [],
      generatedAt: new Date().toISOString(),
      error: `Map generation failed: ${message}. Please retry.`,
    };
  }
}

// ─── queryItems ──────────────────────────────────────────────────────────────

/**
 * Natural language search over a user's items.
 * Uses OpenAI to understand the query and identify relevant items, then generates a summary.
 *
 * Requirements: 7.1
 */
export async function queryItems(userId: string, queryText: string): Promise<QueryResult> {
  const client = getClient();

  try {
    // Fetch user's items for context
    const itemRows = await queryMany<ItemRow>(
      `SELECT id, user_id, title, content_encrypted, content_type, metadata, source_channel, created_at
       FROM items
       WHERE user_id = $1 AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );

    if (itemRows.length === 0) {
      return { items: [], summary: 'No items found in your collection.' };
    }

    // Decrypt content for AI analysis
    const decryptedItems = itemRows.map((row) => ({
      id: row.id,
      title: row.title,
      content: decrypt(row.content_encrypted),
      content_type: row.content_type,
    }));

    const itemsSummary = decryptedItems.map((item, idx) => (
      `[${idx}] ID: ${item.id} | Title: ${item.title || 'Untitled'} | Type: ${item.content_type} | Content: ${item.content.substring(0, 300)}`
    )).join('\n');

    const prompt = `You are an AI search assistant. A user is searching their personal items collection.

USER QUERY: "${queryText}"

AVAILABLE ITEMS:
${itemsSummary}

Respond with a JSON object:
{
  "relevantItems": [
    { "id": "item_id", "relevanceScore": 0.0 to 1.0 }
  ],
  "summary": "A brief natural language summary answering the user's query based on the relevant items"
}

Rules:
- Only include items with relevance score >= 0.3
- Relevance score must be between 0.0 and 1.0
- Provide a concise, helpful summary (2-4 sentences)
- Order by relevance (highest first)
- Maximum 10 items in results`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { items: [], summary: 'Unable to process query.', error: 'Empty response from AI' };
    }

    const parsed = safeParseJson<{
      relevantItems: Array<{ id: string; relevanceScore: number }>;
      summary: string;
    }>(content);

    if (!parsed) {
      return { items: [], summary: 'Unable to process query.', error: 'Failed to parse AI response' };
    }

    // Map results with full item data
    const validItemIds = new Set(decryptedItems.map((i) => i.id));
    const resultItems = (parsed.relevantItems || [])
      .filter((r) => validItemIds.has(r.id))
      .map((r) => {
        const item = decryptedItems.find((i) => i.id === r.id)!;
        return {
          id: item.id,
          title: item.title,
          content: item.content,
          relevanceScore: clampConfidence(r.relevanceScore),
        };
      });

    log.info({ userId, query: queryText, resultCount: resultItems.length }, 'Query completed');

    return {
      items: resultItems,
      summary: parsed.summary || 'No relevant information found.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown AI error';
    log.error({ userId, error: message }, 'AI query failed');
    return {
      items: [],
      summary: '',
      error: `Query processing failed: ${message}. Please retry.`,
    };
  }
}

// ─── suggestRelated ──────────────────────────────────────────────────────────

/**
 * Returns related items and recommended actions for a specific item.
 * Scoped to the same user's collection.
 *
 * Requirements: 7.3
 */
export async function suggestRelated(userId: string, itemId: string): Promise<SuggestResult> {
  const client = getClient();

  try {
    // Fetch the target item (verify ownership)
    const targetRow = await queryOne<ItemRow>(
      `SELECT id, user_id, title, content_encrypted, content_type, metadata, source_channel, created_at
       FROM items
       WHERE id = $1 AND user_id = $2 AND is_deleted = false`,
      [itemId, userId]
    );

    if (!targetRow) {
      return { suggestions: [], error: 'Item not found or access denied' };
    }

    const targetContent = decrypt(targetRow.content_encrypted);

    // Fetch other items from same user for comparison
    const otherRows = await queryMany<ItemRow>(
      `SELECT id, user_id, title, content_encrypted, content_type, metadata, source_channel, created_at
       FROM items
       WHERE user_id = $1 AND id != $2 AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT 30`,
      [userId, itemId]
    );

    if (otherRows.length === 0) {
      return { suggestions: [] };
    }

    const otherItems = otherRows.map((row) => ({
      id: row.id,
      title: row.title,
      content: decrypt(row.content_encrypted),
      content_type: row.content_type,
    }));

    const otherSummary = otherItems.map((item, idx) => (
      `[${idx}] ID: ${item.id} | Title: ${item.title || 'Untitled'} | Type: ${item.content_type} | Content: ${item.content.substring(0, 200)}`
    )).join('\n');

    const prompt = `You are an AI suggestion engine. Analyze the TARGET item and suggest related items from the user's collection, along with recommended actions.

TARGET ITEM:
ID: ${targetRow.id}
Title: ${targetRow.title || 'Untitled'}
Type: ${targetRow.content_type}
Content: ${targetContent}

OTHER ITEMS IN COLLECTION:
${otherSummary}

Respond with a JSON object:
{
  "suggestions": [
    {
      "itemId": "id of the related item",
      "relationshipType": "type (e.g., 'similar_topic', 'complementary', 'follow_up', 'references')",
      "strength": 0.0 to 1.0,
      "recommendedAction": "action to take (e.g., 'Merge these notes', 'Create a link', 'Review for updates', 'Add as subtask', 'Group in same category')"
    }
  ]
}

Rules:
- Maximum 5 suggestions
- Only include items with strength >= 0.3
- Provide actionable, specific recommended actions
- Strength must be between 0.0 and 1.0`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { suggestions: [], error: 'Empty response from AI' };
    }

    const parsed = safeParseJson<{
      suggestions: Array<{
        itemId: string;
        relationshipType: string;
        strength: number;
        recommendedAction: string;
      }>;
    }>(content);

    if (!parsed || !Array.isArray(parsed.suggestions)) {
      return { suggestions: [], error: 'Failed to parse AI response' };
    }

    // Validate item IDs and build result
    const validItemIds = new Set(otherItems.map((i) => i.id));
    const suggestions: Suggestion[] = parsed.suggestions
      .filter((s) => validItemIds.has(s.itemId))
      .map((s) => {
        const relatedItem = otherItems.find((i) => i.id === s.itemId)!;
        return {
          itemId: s.itemId,
          title: relatedItem.title,
          relationshipType: s.relationshipType || 'related',
          strength: clampConfidence(s.strength),
          recommendedAction: s.recommendedAction || 'Review this related item',
        };
      });

    log.info({ userId, itemId, suggestionCount: suggestions.length }, 'Suggestions generated');

    return { suggestions };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown AI error';
    log.error({ userId, itemId, error: message }, 'AI suggestion generation failed');
    return { suggestions: [], error: `Suggestion generation failed: ${message}. Please retry.` };
  }
}
