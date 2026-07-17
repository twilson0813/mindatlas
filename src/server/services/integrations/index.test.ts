import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// Mock database module
vi.mock('../../db/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

// Mock items service
vi.mock('../items/index.js', () => ({
  createItem: vi.fn(),
}));

// Mock logger
vi.mock('../../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock queues (needed by items service transitively)
vi.mock('../../queues.js', () => ({
  aiProcessingQueue: { add: vi.fn() },
}));

import { query, queryOne, queryMany } from '../../db/db.js';
import { createItem } from '../items/index.js';
import {
  hashApiKey,
  generateRawKey,
  handleWebhook,
  generateApiKey,
  revokeApiKey,
  listApiKeys,
  findActiveKeyByHash,
  updateKeyLastUsed,
} from './index.js';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockQueryMany = vi.mocked(queryMany);
const mockCreateItem = vi.mocked(createItem);

describe('integrations service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('hashApiKey', () => {
    it('should produce a consistent SHA-256 hex hash', () => {
      const key = 'ma_abc123';
      const expected = crypto.createHash('sha256').update(key).digest('hex');
      expect(hashApiKey(key)).toBe(expected);
    });

    it('should produce different hashes for different keys', () => {
      const hash1 = hashApiKey('ma_key1');
      const hash2 = hashApiKey('ma_key2');
      expect(hash1).not.toBe(hash2);
    });

    it('should produce a 64-character hex string', () => {
      const hash = hashApiKey('any-key');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('generateRawKey', () => {
    it('should produce a key prefixed with "ma_"', () => {
      const key = generateRawKey();
      expect(key.startsWith('ma_')).toBe(true);
    });

    it('should produce a key of expected length (ma_ + 64 hex chars)', () => {
      const key = generateRawKey();
      // "ma_" (3 chars) + 32 bytes as hex (64 chars) = 67 chars
      expect(key).toHaveLength(67);
    });

    it('should produce unique keys each call', () => {
      const key1 = generateRawKey();
      const key2 = generateRawKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('handleWebhook', () => {
    const userId = 'user-123';

    it('should create an item from valid webhook payload', async () => {
      const mockItem = {
        id: 'item-1',
        user_id: userId,
        content: 'Test content',
        content_type: 'plain_text',
        title: 'Test',
        metadata: null,
        source_channel: 'webhook',
        source_domain: 'n8n',
        file_path: null,
        file_size: null,
        is_deleted: false,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockCreateItem.mockResolvedValue(mockItem);

      const result = await handleWebhook(userId, {
        content: 'Test content',
        title: 'Test',
      });

      expect(mockCreateItem).toHaveBeenCalledWith(userId, {
        content: 'Test content',
        content_type: 'plain_text',
        title: 'Test',
        metadata: undefined,
        source_channel: 'webhook',
        source_domain: 'n8n',
      });
      expect(result).toEqual(mockItem);
    });

    it('should use provided content_type and source_domain', async () => {
      const mockItem = {
        id: 'item-2',
        user_id: userId,
        content: 'https://example.com',
        content_type: 'link',
        title: null,
        metadata: { url: 'https://example.com' },
        source_channel: 'webhook',
        source_domain: 'custom-workflow',
        file_path: null,
        file_size: null,
        is_deleted: false,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockCreateItem.mockResolvedValue(mockItem);

      await handleWebhook(userId, {
        content: 'https://example.com',
        content_type: 'link',
        source_domain: 'custom-workflow',
        metadata: { url: 'https://example.com' },
      });

      expect(mockCreateItem).toHaveBeenCalledWith(userId, {
        content: 'https://example.com',
        content_type: 'link',
        title: undefined,
        metadata: { url: 'https://example.com' },
        source_channel: 'webhook',
        source_domain: 'custom-workflow',
      });
    });

    it('should reject payload with missing content', async () => {
      await expect(handleWebhook(userId, { content: '' })).rejects.toThrow(
        'Webhook payload must include non-empty "content" field',
      );
    });

    it('should reject payload with whitespace-only content', async () => {
      await expect(handleWebhook(userId, { content: '   ' })).rejects.toThrow(
        'Webhook payload must include non-empty "content" field',
      );
    });

    it('should set statusCode 400 on validation errors', async () => {
      try {
        await handleWebhook(userId, { content: '' });
      } catch (error: unknown) {
        expect((error as Error & { statusCode?: number }).statusCode).toBe(400);
      }
    });
  });

  describe('generateApiKey', () => {
    const userId = 'user-456';

    it('should generate and store a new API key', async () => {
      const fakeId = 'key-id-789';
      const fakeCreated = new Date('2024-01-01');
      mockQueryOne.mockResolvedValue({ id: fakeId, created_at: fakeCreated });

      const result = await generateApiKey(userId, 'My Integration');

      expect(result.id).toBe(fakeId);
      expect(result.key).toMatch(/^ma_[0-9a-f]{64}$/);
      expect(result.label).toBe('My Integration');
      expect(result.created_at).toBe(fakeCreated);

      // Verify the hash was stored, not the raw key
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO api_keys'),
        expect.arrayContaining([userId, expect.stringMatching(/^[0-9a-f]{64}$/), 'My Integration']),
      );
    });

    it('should trim the label', async () => {
      mockQueryOne.mockResolvedValue({ id: 'key-1', created_at: new Date() });

      await generateApiKey(userId, '  Trimmed Label  ');

      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([userId, expect.any(String), 'Trimmed Label']),
      );
    });

    it('should reject empty label', async () => {
      await expect(generateApiKey(userId, '')).rejects.toThrow('API key label is required');
    });

    it('should reject whitespace-only label', async () => {
      await expect(generateApiKey(userId, '   ')).rejects.toThrow('API key label is required');
    });

    it('should set statusCode 400 on label validation error', async () => {
      try {
        await generateApiKey(userId, '');
      } catch (error: unknown) {
        expect((error as Error & { statusCode?: number }).statusCode).toBe(400);
      }
    });
  });

  describe('revokeApiKey', () => {
    const userId = 'user-789';

    it('should deactivate an active key owned by the user', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1, rows: [], command: 'UPDATE', oid: 0, fields: [] });

      await expect(revokeApiKey(userId, 'key-1')).resolves.toBeUndefined();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE api_keys SET is_active = false'),
        ['key-1', userId],
      );
    });

    it('should throw 404 if key not found or already revoked', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0, rows: [], command: 'UPDATE', oid: 0, fields: [] });

      await expect(revokeApiKey(userId, 'nonexistent')).rejects.toThrow(
        'API key not found or already revoked',
      );
    });

    it('should set statusCode 404 on not found error', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0, rows: [], command: 'UPDATE', oid: 0, fields: [] });

      try {
        await revokeApiKey(userId, 'nonexistent');
      } catch (error: unknown) {
        expect((error as Error & { statusCode?: number }).statusCode).toBe(404);
      }
    });
  });

  describe('listApiKeys', () => {
    const userId = 'user-list';

    it('should return keys without the hash', async () => {
      const rows = [
        {
          id: 'k1',
          user_id: userId,
          key_hash: 'hash1',
          label: 'Key 1',
          is_active: true,
          last_used_at: null,
          created_at: new Date('2024-01-01'),
        },
        {
          id: 'k2',
          user_id: userId,
          key_hash: 'hash2',
          label: 'Key 2',
          is_active: false,
          last_used_at: new Date('2024-06-01'),
          created_at: new Date('2024-02-01'),
        },
      ];
      mockQueryMany.mockResolvedValue(rows);

      const result = await listApiKeys(userId);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'k1',
        label: 'Key 1',
        is_active: true,
        last_used_at: null,
        created_at: new Date('2024-01-01'),
      });
      // Verify key_hash is NOT in the response
      expect(result[0]).not.toHaveProperty('key_hash');
      expect(result[0]).not.toHaveProperty('user_id');
    });

    it('should return empty array when user has no keys', async () => {
      mockQueryMany.mockResolvedValue([]);
      const result = await listApiKeys(userId);
      expect(result).toEqual([]);
    });
  });

  describe('findActiveKeyByHash', () => {
    it('should return key row when hash matches an active key', async () => {
      const mockRow = {
        id: 'k1',
        user_id: 'user-1',
        key_hash: 'somehash',
        label: 'Test Key',
        is_active: true,
        last_used_at: null,
        created_at: new Date(),
      };
      mockQueryOne.mockResolvedValue(mockRow);

      const result = await findActiveKeyByHash('somehash');
      expect(result).toEqual(mockRow);
    });

    it('should return null when no active key matches', async () => {
      mockQueryOne.mockResolvedValue(null);
      const result = await findActiveKeyByHash('nonexistent-hash');
      expect(result).toBeNull();
    });
  });

  describe('updateKeyLastUsed', () => {
    it('should update the last_used_at timestamp', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1, rows: [], command: 'UPDATE', oid: 0, fields: [] });
      await updateKeyLastUsed('key-1');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE api_keys SET last_used_at'),
        ['key-1'],
      );
    });
  });
});
