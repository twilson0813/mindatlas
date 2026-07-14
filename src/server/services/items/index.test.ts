import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createItem,
  getItem,
  listItems,
  deleteItem,
  getItemRelationships,
  validateItemInput,
} from './index.js';

// Mock the database module
vi.mock('../../db/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

// Mock the encryption module
vi.mock('../../utils/encryption.js', () => ({
  encrypt: vi.fn((text: string) => `encrypted:${text}`),
  decrypt: vi.fn((text: string) => text.replace('encrypted:', '')),
}));

// Mock the queues module
vi.mock('../../queues.js', () => ({
  aiProcessingQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
  },
}));

// Mock the logger
vi.mock('../../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

import { query, queryOne, queryMany } from '../../db/db.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { aiProcessingQueue } from '../../queues.js';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockQueryMany = vi.mocked(queryMany);
const mockEncrypt = vi.mocked(encrypt);
const mockDecrypt = vi.mocked(decrypt);
const mockAiQueue = vi.mocked(aiProcessingQueue);

describe('Item Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateItemInput', () => {
    it('should accept valid input with content and content_type', () => {
      const result = validateItemInput({
        content: 'Hello world',
        content_type: 'plain_text',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept valid input with only content', () => {
      const result = validateItemInput({ content: 'Some content' });
      expect(result.valid).toBe(true);
    });

    it('should reject empty content', () => {
      const result = validateItemInput({ content: '' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Content is required and must not be empty');
    });

    it('should reject whitespace-only content', () => {
      const result = validateItemInput({ content: '   ' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Content is required and must not be empty');
    });

    it('should reject missing content', () => {
      const result = validateItemInput({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Content is required and must not be empty');
    });

    it('should reject invalid content_type', () => {
      const result = validateItemInput({
        content: 'test',
        content_type: 'invalid_type' as any,
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid content_type');
    });

    it('should accept all valid content_type values', () => {
      const types = ['plain_text', 'link', 'code_snippet', 'note', 'task', 'idea', 'file', 'custom'] as const;
      for (const type of types) {
        const result = validateItemInput({ content: 'test', content_type: type });
        expect(result.valid).toBe(true);
      }
    });

    it('should reject non-object metadata', () => {
      const result = validateItemInput({
        content: 'test',
        metadata: 'not-an-object' as any,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Metadata must be a JSON object');
    });

    it('should reject array metadata', () => {
      const result = validateItemInput({
        content: 'test',
        metadata: [] as any,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Metadata must be a JSON object');
    });

    it('should accept valid object metadata', () => {
      const result = validateItemInput({
        content: 'test',
        metadata: { key: 'value' },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('createItem', () => {
    const mockRow = {
      id: 'item-uuid-1',
      user_id: 'user-1',
      title: 'Test Item',
      content_encrypted: 'encrypted:Hello world',
      content_type: 'plain_text',
      metadata: null,
      source_channel: null,
      source_domain: null,
      file_path: null,
      file_size: null,
      is_deleted: false,
      deleted_at: null,
      created_at: new Date('2024-01-01'),
      updated_at: new Date('2024-01-01'),
    };

    it('should create an item with encrypted content', async () => {
      mockQueryOne.mockResolvedValueOnce(mockRow);

      const item = await createItem('user-1', {
        content: 'Hello world',
        content_type: 'plain_text',
        title: 'Test Item',
      });

      expect(mockEncrypt).toHaveBeenCalledWith('Hello world');
      expect(item.id).toBe('item-uuid-1');
      expect(item.content).toBe('Hello world');
      expect(item.content_type).toBe('plain_text');
    });

    it('should insert into item table with correct parameters', async () => {
      mockQueryOne.mockResolvedValueOnce(mockRow);

      await createItem('user-1', {
        content: 'Hello world',
        content_type: 'note',
        title: 'My Note',
        metadata: { priority: 'high' },
        source_channel: 'api',
      });

      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO item'),
        [
          'user-1',
          'My Note',
          'encrypted:Hello world',
          'note',
          JSON.stringify({ priority: 'high' }),
          'api',
          null,
          null,
          null,
        ]
      );
    });

    it('should enqueue an AI processing job', async () => {
      mockQueryOne.mockResolvedValueOnce(mockRow);

      await createItem('user-1', { content: 'Hello world' });

      expect(mockAiQueue.add).toHaveBeenCalledWith('categorize', {
        itemId: 'item-uuid-1',
        userId: 'user-1',
        content: 'Hello world',
        contentType: 'plain_text',
      });
    });

    it('should default content_type to plain_text', async () => {
      mockQueryOne.mockResolvedValueOnce(mockRow);

      await createItem('user-1', { content: 'Hello world' });

      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['plain_text'])
      );
    });

    it('should throw 400 for invalid input', async () => {
      await expect(createItem('user-1', { content: '' }))
        .rejects.toThrow('Validation failed');
    });

    it('should throw if database insert fails', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(createItem('user-1', { content: 'test' }))
        .rejects.toThrow('Failed to create item');
    });
  });

  describe('getItem', () => {
    const mockRow = {
      id: 'item-1',
      user_id: 'user-1',
      title: 'My Item',
      content_encrypted: 'encrypted:Secret content',
      content_type: 'note',
      metadata: { key: 'value' },
      source_channel: 'api',
      source_domain: null,
      file_path: null,
      file_size: null,
      is_deleted: false,
      deleted_at: null,
      created_at: new Date('2024-01-01'),
      updated_at: new Date('2024-01-01'),
    };

    it('should return decrypted item for the owner', async () => {
      mockQueryOne.mockResolvedValueOnce(mockRow);

      const item = await getItem('user-1', 'item-1');

      expect(item.content).toBe('Secret content');
      expect(item.id).toBe('item-1');
      expect(mockDecrypt).toHaveBeenCalledWith('encrypted:Secret content');
    });

    it('should throw 403 when user does not own the item', async () => {
      mockQueryOne.mockResolvedValueOnce(mockRow);

      try {
        await getItem('other-user', 'item-1');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBe('Access denied: you do not own this item');
        expect(error.statusCode).toBe(403);
      }
    });

    it('should throw 404 when item does not exist', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      try {
        await getItem('user-1', 'nonexistent');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBe('Item not found');
        expect(error.statusCode).toBe(404);
      }
    });

    it('should query with is_deleted = false', async () => {
      mockQueryOne.mockResolvedValueOnce(mockRow);

      await getItem('user-1', 'item-1');

      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('is_deleted = false'),
        ['item-1']
      );
    });
  });

  describe('listItems', () => {
    const mockRows = [
      {
        id: 'item-1',
        user_id: 'user-1',
        title: 'Item 1',
        content_encrypted: 'encrypted:Content 1',
        content_type: 'note',
        metadata: null,
        source_channel: null,
        source_domain: null,
        file_path: null,
        file_size: null,
        is_deleted: false,
        deleted_at: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      },
      {
        id: 'item-2',
        user_id: 'user-1',
        title: 'Item 2',
        content_encrypted: 'encrypted:Content 2',
        content_type: 'link',
        metadata: null,
        source_channel: null,
        source_domain: null,
        file_path: null,
        file_size: null,
        is_deleted: false,
        deleted_at: null,
        created_at: new Date('2024-01-02'),
        updated_at: new Date('2024-01-02'),
      },
    ];

    it('should return paginated results with defaults', async () => {
      mockQueryOne.mockResolvedValueOnce({ count: '2' });
      mockQueryMany.mockResolvedValueOnce(mockRows);

      const result = await listItems('user-1');

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.page_size).toBe(20);
      expect(result.total_pages).toBe(1);
    });

    it('should decrypt content of all items', async () => {
      mockQueryOne.mockResolvedValueOnce({ count: '2' });
      mockQueryMany.mockResolvedValueOnce(mockRows);

      const result = await listItems('user-1');

      expect(result.items[0].content).toBe('Content 1');
      expect(result.items[1].content).toBe('Content 2');
    });

    it('should apply category filter', async () => {
      mockQueryOne.mockResolvedValueOnce({ count: '0' });
      mockQueryMany.mockResolvedValueOnce([]);

      await listItems('user-1', { category: 'work' });

      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('category'),
        expect.arrayContaining(['user-1', 'work'])
      );
    });

    it('should apply tag filter', async () => {
      mockQueryOne.mockResolvedValueOnce({ count: '0' });
      mockQueryMany.mockResolvedValueOnce([]);

      await listItems('user-1', { tag: 'important' });

      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('tag'),
        expect.arrayContaining(['user-1', 'important'])
      );
    });

    it('should apply date range filters', async () => {
      mockQueryOne.mockResolvedValueOnce({ count: '0' });
      mockQueryMany.mockResolvedValueOnce([]);

      await listItems('user-1', { date_from: '2024-01-01', date_to: '2024-01-31' });

      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('created_at >='),
        expect.arrayContaining(['2024-01-01', '2024-01-31'])
      );
    });

    it('should apply keyword filter', async () => {
      mockQueryOne.mockResolvedValueOnce({ count: '0' });
      mockQueryMany.mockResolvedValueOnce([]);

      await listItems('user-1', { keyword: 'hello' });

      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.arrayContaining(['%hello%'])
      );
    });

    it('should respect custom pagination', async () => {
      mockQueryOne.mockResolvedValueOnce({ count: '50' });
      mockQueryMany.mockResolvedValueOnce([]);

      const result = await listItems('user-1', { page: 3, page_size: 10 });

      expect(result.page).toBe(3);
      expect(result.page_size).toBe(10);
      expect(result.total_pages).toBe(5);
      // Check offset: page 3, size 10 → offset 20
      expect(mockQueryMany).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([10, 20])
      );
    });

    it('should cap page_size at 100', async () => {
      mockQueryOne.mockResolvedValueOnce({ count: '0' });
      mockQueryMany.mockResolvedValueOnce([]);

      const result = await listItems('user-1', { page_size: 500 });

      expect(result.page_size).toBe(100);
    });

    it('should scope all queries to the user_id', async () => {
      mockQueryOne.mockResolvedValueOnce({ count: '0' });
      mockQueryMany.mockResolvedValueOnce([]);

      await listItems('user-1');

      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('i.user_id = $1'),
        expect.arrayContaining(['user-1'])
      );
    });
  });

  describe('deleteItem', () => {
    it('should soft-delete an item owned by the user', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [], command: '', oid: 0, fields: [] });

      await expect(deleteItem('user-1', 'item-1')).resolves.toBeUndefined();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_deleted = true'),
        ['item-1', 'user-1']
      );
    });

    it('should throw 404 when item does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [], command: '', oid: 0, fields: [] });
      mockQueryOne.mockResolvedValueOnce(null);

      try {
        await deleteItem('user-1', 'nonexistent');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBe('Item not found');
        expect(error.statusCode).toBe(404);
      }
    });

    it('should throw 403 when item belongs to another user', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [], command: '', oid: 0, fields: [] });
      mockQueryOne.mockResolvedValueOnce({ user_id: 'other-user' });

      try {
        await deleteItem('user-1', 'item-1');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBe('Access denied: you do not own this item');
        expect(error.statusCode).toBe(403);
      }
    });

    it('should set deleted_at timestamp', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [], command: '', oid: 0, fields: [] });

      await deleteItem('user-1', 'item-1');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('deleted_at = NOW()'),
        expect.any(Array)
      );
    });
  });

  describe('getItemRelationships', () => {
    it('should return relationships for an owned item', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'item-1' });
      const mockRelationships = [
        {
          id: 'rel-1',
          source_item_id: 'item-1',
          target_item_id: 'item-2',
          relationship_type: 'related',
          strength: 0.8,
          created_at: new Date('2024-01-01'),
        },
      ];
      mockQueryMany.mockResolvedValueOnce(mockRelationships);

      const result = await getItemRelationships('user-1', 'item-1');

      expect(result).toHaveLength(1);
      expect(result[0].relationship_type).toBe('related');
      expect(result[0].strength).toBe(0.8);
    });

    it('should throw 404 when item does not exist or not owned', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      try {
        await getItemRelationships('user-1', 'nonexistent');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBe('Item not found or access denied');
        expect(error.statusCode).toBe(404);
      }
    });

    it('should scope relationships to user-owned items only', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'item-1' });
      mockQueryMany.mockResolvedValueOnce([]);

      await getItemRelationships('user-1', 'item-1');

      // Verify both joins check user_id
      expect(mockQueryMany).toHaveBeenCalledWith(
        expect.stringContaining('src.user_id = $1'),
        ['user-1', 'item-1']
      );
      expect(mockQueryMany).toHaveBeenCalledWith(
        expect.stringContaining('tgt.user_id = $1'),
        expect.any(Array)
      );
    });

    it('should only check ownership via user_id parameter', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'item-1' });
      mockQueryMany.mockResolvedValueOnce([]);

      await getItemRelationships('user-1', 'item-1');

      // Verify item existence check scopes to user
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('user_id = $2'),
        ['item-1', 'user-1']
      );
    });
  });
});
