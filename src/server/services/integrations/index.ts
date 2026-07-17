import crypto from 'node:crypto';
import { query, queryOne, queryMany } from '../../db/db.js';
import { createItem } from '../items/index.js';
import { createChildLogger } from '../../logger.js';
import type { Item, ItemInput } from '../items/index.js';

const log = createChildLogger({ module: 'integrations-service' });

/**
 * Webhook payload shape from n8n workflows.
 * n8n sends content and optional metadata for item creation.
 */
export interface WebhookPayload {
  content: string;
  content_type?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  source_domain?: string;
}

/** API key row stored in the database */
export interface ApiKeyRow {
  id: string;
  user_id: string;
  key_hash: string;
  label: string;
  is_active: boolean;
  last_used_at: Date | null;
  created_at: Date;
}

/** API key response returned to the user (without hash) */
export interface ApiKeyResponse {
  id: string;
  label: string;
  is_active: boolean;
  last_used_at: Date | null;
  created_at: Date;
}

/** Result of generating a new API key — includes the raw key shown once */
export interface GeneratedApiKey {
  id: string;
  key: string;
  label: string;
  created_at: Date;
}

/**
 * Hash an API key using SHA-256.
 * The raw key is returned to the user once; only the hash is stored.
 */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Generate a random 32-byte API key, return as hex string prefixed with "ma_".
 * Prefix makes it easy to identify MindAtlas keys in logs/configs.
 */
export function generateRawKey(): string {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  return `ma_${randomBytes}`;
}

/**
 * Process an n8n webhook payload and create an item for the authenticated user.
 *
 * Requirements: 9.1, 9.2
 *
 * @param userId - The user who owns the API key used for auth
 * @param payload - The webhook payload from n8n
 * @returns The created item
 */
export async function handleWebhook(userId: string, payload: WebhookPayload): Promise<Item> {
  log.info(
    { userId, payload: { ...payload, content: '[redacted]' } },
    'Processing n8n webhook payload',
  );

  if (!payload.content || typeof payload.content !== 'string' || payload.content.trim() === '') {
    const error = new Error('Webhook payload must include non-empty "content" field') as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }

  const itemInput: ItemInput = {
    content: payload.content,
    content_type: (payload.content_type as ItemInput['content_type']) || 'plain_text',
    title: payload.title,
    metadata: payload.metadata,
    source_channel: 'webhook',
    source_domain: payload.source_domain || 'n8n',
  };

  const item = await createItem(userId, itemInput);
  log.info({ userId, itemId: item.id }, 'Item created from webhook');
  return item;
}

/**
 * Generate a new API key for a user.
 * Returns the raw key once — only the SHA-256 hash is stored in the database.
 *
 * Requirements: 9.6
 *
 * @param userId - The user generating the key
 * @param label - A human-readable label for the key
 * @returns The generated key data (includes raw key shown only once)
 */
export async function generateApiKey(userId: string, label: string): Promise<GeneratedApiKey> {
  if (!label || typeof label !== 'string' || label.trim() === '') {
    const error = new Error('API key label is required') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }

  const rawKey = generateRawKey();
  const keyHash = hashApiKey(rawKey);

  const result = await queryOne<{ id: string; created_at: Date }>(
    `INSERT INTO api_keys (user_id, key_hash, label)
     VALUES ($1, $2, $3)
     RETURNING id, created_at`,
    [userId, keyHash, label.trim()],
  );

  if (!result) {
    throw new Error('Failed to create API key');
  }

  log.info({ userId, keyId: result.id, label: label.trim() }, 'API key generated');

  return {
    id: result.id,
    key: rawKey,
    label: label.trim(),
    created_at: result.created_at,
  };
}

/**
 * Revoke (deactivate) an API key.
 * Only the owning user can revoke their own keys.
 *
 * Requirements: 9.6
 *
 * @param userId - The authenticated user
 * @param keyId - The API key ID to revoke
 */
export async function revokeApiKey(userId: string, keyId: string): Promise<void> {
  const result = await query(
    `UPDATE api_keys SET is_active = false
     WHERE id = $1 AND user_id = $2 AND is_active = true`,
    [keyId, userId],
  );

  if (result.rowCount === 0) {
    const error = new Error('API key not found or already revoked') as Error & {
      statusCode?: number;
    };
    error.statusCode = 404;
    throw error;
  }

  log.info({ userId, keyId }, 'API key revoked');
}

/**
 * List all API keys for a user (active and inactive).
 * Does NOT return the key hash — only metadata.
 *
 * @param userId - The authenticated user
 * @returns Array of API key metadata
 */
export async function listApiKeys(userId: string): Promise<ApiKeyResponse[]> {
  const rows = await queryMany<ApiKeyRow>(
    `SELECT id, user_id, key_hash, label, is_active, last_used_at, created_at
     FROM api_keys
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    is_active: row.is_active,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
  }));
}

/**
 * Look up a user by API key hash.
 * Used by the API key auth middleware to authenticate requests.
 *
 * @param keyHash - SHA-256 hash of the provided API key
 * @returns The API key row if found and active, null otherwise
 */
export async function findActiveKeyByHash(keyHash: string): Promise<ApiKeyRow | null> {
  const row = await queryOne<ApiKeyRow>(
    `SELECT id, user_id, key_hash, label, is_active, last_used_at, created_at
     FROM api_keys
     WHERE key_hash = $1 AND is_active = true`,
    [keyHash],
  );

  return row;
}

/**
 * Update last_used_at timestamp for an API key.
 * Called by the auth middleware on successful authentication.
 *
 * @param keyId - The API key ID
 */
export async function updateKeyLastUsed(keyId: string): Promise<void> {
  await query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [keyId]);
}
