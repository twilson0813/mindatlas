import { query, queryOne, queryMany } from '../../db/db.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { aiProcessingQueue } from '../../queues.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger({ module: 'item-service' });

/**
 * Valid content types for items.
 * Matches the VALID_CONTENT_TYPES from the validation middleware.
 */
export const VALID_CONTENT_TYPES = [
  'plain_text',
  'link',
  'code_snippet',
  'note',
  'task',
  'idea',
  'file',
  'custom',
] as const;

export type ContentType = (typeof VALID_CONTENT_TYPES)[number];

/** Input shape for creating an item */
export interface ItemInput {
  content: string;
  content_type?: ContentType;
  title?: string;
  metadata?: Record<string, unknown>;
  source_channel?: string;
  source_domain?: string;
  file_path?: string;
  file_size?: number;
}

/** Stored item shape returned from queries */
export interface Item {
  id: string;
  user_id: string;
  title: string | null;
  content: string;
  content_type: string;
  metadata: Record<string, unknown> | null;
  source_channel: string | null;
  source_domain: string | null;
  file_path: string | null;
  file_size: number | null;
  is_deleted: boolean;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Database row shape (with encrypted content) */
interface ItemRow {
  id: string;
  user_id: string;
  title: string | null;
  content_encrypted: string;
  content_type: string;
  metadata: Record<string, unknown> | null;
  source_channel: string | null;
  source_domain: string | null;
  file_path: string | null;
  file_size: number | null;
  is_deleted: boolean;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Filters for listing items */
export interface ItemFilters {
  category?: string;
  tag?: string;
  date_from?: string;
  date_to?: string;
  keyword?: string;
  page?: number;
  page_size?: number;
}

/** Paginated result shape */
export interface PaginatedItems {
  items: Item[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** Relationship between items */
export interface Relationship {
  id: string;
  source_item_id: string;
  target_item_id: string;
  relationship_type: string;
  strength: number;
  created_at: Date;
}

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates the item input payload.
 * Content must be non-empty, content_type must be a valid enum value if provided.
 */
export function validateItemInput(input: Partial<ItemInput>): ValidationResult {
  const errors: string[] = [];

  if (!input.content || input.content.trim().length === 0) {
    errors.push('Content is required and must not be empty');
  }

  if (input.content_type !== undefined) {
    if (!VALID_CONTENT_TYPES.includes(input.content_type as ContentType)) {
      errors.push(
        `Invalid content_type: must be one of ${VALID_CONTENT_TYPES.join(', ')}`
      );
    }
  }

  if (input.metadata !== undefined && (typeof input.metadata !== 'object' || input.metadata === null || Array.isArray(input.metadata))) {
    errors.push('Metadata must be a JSON object');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Converts a database row (with encrypted content) to an Item (with decrypted content).
 */
function rowToItem(row: ItemRow): Item {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    content: decrypt(row.content_encrypted),
    content_type: row.content_type,
    metadata: row.metadata,
    source_channel: row.source_channel,
    source_domain: row.source_domain,
    file_path: row.file_path,
    file_size: row.file_size,
    is_deleted: row.is_deleted,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Creates a new item.
 * - Validates input
 * - Encrypts content with AES-256-GCM
 * - Inserts into the items table scoped to userId
 * - Enqueues an AI processing job
 *
 * Requirements: 3.1, 3.2, 3.3
 */
export async function createItem(userId: string, input: ItemInput): Promise<Item> {
  // Validate input
  const validation = validateItemInput(input);
  if (!validation.valid) {
    const error = new Error(`Validation failed: ${validation.errors.join(', ')}`);
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  // Encrypt content at rest
  const contentEncrypted = encrypt(input.content);

  // Insert into database
  const row = await queryOne<ItemRow>(
    `INSERT INTO item (user_id, title, content_encrypted, content_type, metadata, source_channel, source_domain, file_path, file_size)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, user_id, title, content_encrypted, content_type, metadata, source_channel, source_domain, file_path, file_size, is_deleted, deleted_at, created_at, updated_at`,
    [
      userId,
      input.title || null,
      contentEncrypted,
      input.content_type || 'plain_text',
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.source_channel || null,
      input.source_domain || null,
      input.file_path || null,
      input.file_size || null,
    ]
  );

  if (!row) {
    throw new Error('Failed to create item');
  }

  // Enqueue AI processing job
  await aiProcessingQueue.add('categorize', {
    itemId: row.id,
    userId,
    content: input.content,
    contentType: input.content_type || 'plain_text',
  });

  log.info({ itemId: row.id, userId }, 'Item created and AI job enqueued');

  return rowToItem(row);
}

/**
 * Retrieves an item by ID, scoped to the authenticated user.
 * Returns 403-like error if item exists but belongs to another user.
 *
 * Requirements: 2.1, 2.3
 */
export async function getItem(userId: string, itemId: string): Promise<Item> {
  const row = await queryOne<ItemRow>(
    `SELECT id, user_id, title, content_encrypted, content_type, metadata, source_channel, source_domain, file_path, file_size, is_deleted, deleted_at, created_at, updated_at
     FROM item
     WHERE id = $1 AND is_deleted = false`,
    [itemId]
  );

  if (!row) {
    const error = new Error('Item not found');
    (error as Error & { statusCode: number }).statusCode = 404;
    throw error;
  }

  if (row.user_id !== userId) {
    const error = new Error('Access denied: you do not own this item');
    (error as Error & { statusCode: number }).statusCode = 403;
    throw error;
  }

  return rowToItem(row);
}

/**
 * Lists items belonging to the authenticated user with pagination and filtering.
 * Supports filtering by category, tag, date range, and keyword search.
 *
 * Requirements: 8.5
 */
export async function listItems(userId: string, filters: ItemFilters = {}): Promise<PaginatedItems> {
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const pageSize = filters.page_size && filters.page_size > 0 ? Math.min(filters.page_size, 100) : 20;
  const offset = (page - 1) * pageSize;

  // Build dynamic WHERE clause
  const conditions: string[] = ['i.user_id = $1', 'i.is_deleted = false'];
  const params: unknown[] = [userId];
  let paramIndex = 2;

  // Filter by category (via tag's category)
  if (filters.category) {
    conditions.push(
      `EXISTS (SELECT 1 FROM item_tag it JOIN tag t ON it.tag_id = t.id JOIN category c ON t.category_id = c.id WHERE it.item_id = i.id AND c.name = $${paramIndex})`
    );
    params.push(filters.category);
    paramIndex++;
  }

  // Filter by tag name
  if (filters.tag) {
    conditions.push(
      `EXISTS (SELECT 1 FROM item_tag it JOIN tag t ON it.tag_id = t.id WHERE it.item_id = i.id AND t.name = $${paramIndex})`
    );
    params.push(filters.tag);
    paramIndex++;
  }

  // Filter by date range
  if (filters.date_from) {
    conditions.push(`i.created_at >= $${paramIndex}`);
    params.push(filters.date_from);
    paramIndex++;
  }
  if (filters.date_to) {
    conditions.push(`i.created_at <= $${paramIndex}`);
    params.push(filters.date_to);
    paramIndex++;
  }

  // Filter by keyword in content (decrypted content is not searchable at DB level,
  // so we search in title and metadata for keywords)
  if (filters.keyword) {
    conditions.push(
      `(i.title ILIKE $${paramIndex} OR i.content_encrypted ILIKE $${paramIndex})`
    );
    params.push(`%${filters.keyword}%`);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  // Get total count
  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM item i WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult?.count || '0', 10);

  // Get paginated items
  const rows = await queryMany<ItemRow>(
    `SELECT i.id, i.user_id, i.title, i.content_encrypted, i.content_type, i.metadata, i.source_channel, i.source_domain, i.file_path, i.file_size, i.is_deleted, i.deleted_at, i.created_at, i.updated_at
     FROM item i
     WHERE ${whereClause}
     ORDER BY i.created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, pageSize, offset]
  );

  const items = rows.map(rowToItem);

  return {
    items,
    total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total / pageSize),
  };
}

/**
 * Soft-deletes an item by setting is_deleted=true and deleted_at=NOW().
 * Only the owning user can delete their items.
 *
 * Requirements: 12.4
 */
export async function deleteItem(userId: string, itemId: string): Promise<void> {
  const result = await query(
    `UPDATE item
     SET is_deleted = true, deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND is_deleted = false`,
    [itemId, userId]
  );

  if (result.rowCount === 0) {
    // Check if the item exists but belongs to another user
    const existing = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM item WHERE id = $1',
      [itemId]
    );

    if (!existing) {
      const error = new Error('Item not found');
      (error as Error & { statusCode: number }).statusCode = 404;
      throw error;
    }

    if (existing.user_id !== userId) {
      const error = new Error('Access denied: you do not own this item');
      (error as Error & { statusCode: number }).statusCode = 403;
      throw error;
    }

    // Item was already deleted
    const error = new Error('Item already deleted');
    (error as Error & { statusCode: number }).statusCode = 404;
    throw error;
  }

  log.info({ itemId, userId }, 'Item soft-deleted');
}

/**
 * Retrieves relationships for an item, scoped to the authenticated user.
 * Returns relationships where the item is either the source or target,
 * and both source and target items belong to the same user.
 */
export async function getItemRelationships(userId: string, itemId: string): Promise<Relationship[]> {
  // First verify the item belongs to this user
  const item = await queryOne<{ id: string }>(
    'SELECT id FROM item WHERE id = $1 AND user_id = $2 AND is_deleted = false',
    [itemId, userId]
  );

  if (!item) {
    const error = new Error('Item not found or access denied');
    (error as Error & { statusCode: number }).statusCode = 404;
    throw error;
  }

  // Get relationships where both source and target belong to this user
  const relationships = await queryMany<Relationship>(
    `SELECT r.id, r.source_item_id, r.target_item_id, r.relationship_type, r.strength, r.created_at
     FROM relationship r
     JOIN item src ON r.source_item_id = src.id AND src.user_id = $1 AND src.is_deleted = false
     JOIN item tgt ON r.target_item_id = tgt.id AND tgt.user_id = $1 AND tgt.is_deleted = false
     WHERE (r.source_item_id = $2 OR r.target_item_id = $2)`,
    [userId, itemId]
  );

  return relationships;
}
