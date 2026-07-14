import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parse } from 'csv-parse/sync';

/**
 * Unit tests for CSV Export service functions.
 * Tests exportItems, exportMaps, and getTemplate.
 *
 * Validates: Requirements 13.7, 13.8, 13.9, 13.12, 13.13
 */

// Mock dependencies
vi.mock('../items/index.js', () => ({
  listItems: vi.fn(),
  createItem: vi.fn(),
}));

vi.mock('../../db/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock encryption (needed by items service import chain)
vi.mock('../../utils/encryption.js', () => ({
  encrypt: vi.fn((v: string) => `encrypted:${v}`),
  decrypt: vi.fn((v: string) => v.replace('encrypted:', '')),
}));

// Mock queues
vi.mock('../../queues.js', () => ({
  aiProcessingQueue: { add: vi.fn() },
}));

import { listItems } from '../items/index.js';
import { queryMany } from '../../db/db.js';
import { exportItems, exportMaps, getTemplate } from './index.js';

describe('CSV Export Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('exportItems()', () => {
    it('should generate CSV with correct headers', async () => {
      vi.mocked(listItems).mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        page_size: 100,
        total_pages: 0,
      });

      const buffer = await exportItems('user-123');
      const csv = buffer.toString('utf-8');
      const lines = csv.trim().split('\n');

      expect(lines[0]).toBe('content,content_type,tags,creation_date,metadata');
    });

    it('should export items with all columns populated', async () => {
      const mockItems = [
        {
          id: 'item-1',
          user_id: 'user-123',
          title: 'Test',
          content: 'Hello world',
          content_type: 'plain_text',
          metadata: { tags: ['tag1', 'tag2'], priority: 'high' },
          source_channel: 'api',
          source_domain: null,
          file_path: null,
          file_size: null,
          is_deleted: false,
          deleted_at: null,
          created_at: new Date('2024-01-15T10:00:00Z'),
          updated_at: new Date('2024-01-15T10:00:00Z'),
        },
      ];

      vi.mocked(listItems).mockResolvedValue({
        items: mockItems as any,
        total: 1,
        page: 1,
        page_size: 100,
        total_pages: 1,
      });

      const buffer = await exportItems('user-123');
      const csv = buffer.toString('utf-8');
      const records = parse(csv, { columns: true }) as Record<string, string>[];

      expect(records).toHaveLength(1);
      expect(records[0].content).toBe('Hello world');
      expect(records[0].content_type).toBe('plain_text');
      expect(records[0].tags).toBe('tag1,tag2');
      expect(records[0].creation_date).toBe('2024-01-15T10:00:00.000Z');
      expect(records[0].metadata).toBe('{"priority":"high"}');
    });

    it('should handle items without metadata or tags', async () => {
      const mockItems = [
        {
          id: 'item-2',
          user_id: 'user-123',
          title: null,
          content: 'Simple note',
          content_type: 'note',
          metadata: null,
          source_channel: 'web',
          source_domain: null,
          file_path: null,
          file_size: null,
          is_deleted: false,
          deleted_at: null,
          created_at: new Date('2024-02-01T12:00:00Z'),
          updated_at: new Date('2024-02-01T12:00:00Z'),
        },
      ];

      vi.mocked(listItems).mockResolvedValue({
        items: mockItems as any,
        total: 1,
        page: 1,
        page_size: 100,
        total_pages: 1,
      });

      const buffer = await exportItems('user-123');
      const csv = buffer.toString('utf-8');
      const records = parse(csv, { columns: true }) as Record<string, string>[];

      expect(records).toHaveLength(1);
      expect(records[0].content).toBe('Simple note');
      expect(records[0].content_type).toBe('note');
      expect(records[0].tags).toBe('');
      expect(records[0].metadata).toBe('');
    });

    it('should paginate through all items', async () => {
      // First page returns items, second page is empty
      vi.mocked(listItems)
        .mockResolvedValueOnce({
          items: [
            {
              id: 'item-1',
              user_id: 'user-123',
              content: 'Item 1',
              content_type: 'plain_text',
              metadata: null,
              created_at: new Date('2024-01-01T00:00:00Z'),
            },
          ] as any,
          total: 2,
          page: 1,
          page_size: 100,
          total_pages: 2,
        })
        .mockResolvedValueOnce({
          items: [
            {
              id: 'item-2',
              user_id: 'user-123',
              content: 'Item 2',
              content_type: 'note',
              metadata: null,
              created_at: new Date('2024-01-02T00:00:00Z'),
            },
          ] as any,
          total: 2,
          page: 2,
          page_size: 100,
          total_pages: 2,
        });

      const buffer = await exportItems('user-123');
      const csv = buffer.toString('utf-8');
      const records = parse(csv, { columns: true }) as Record<string, string>[];

      expect(records).toHaveLength(2);
      expect(records[0].content).toBe('Item 1');
      expect(records[1].content).toBe('Item 2');
      expect(listItems).toHaveBeenCalledTimes(2);
    });

    it('should handle content with special CSV characters', async () => {
      const mockItems = [
        {
          id: 'item-3',
          user_id: 'user-123',
          content: 'Content with "quotes" and, commas\nand newlines',
          content_type: 'plain_text',
          metadata: null,
          created_at: new Date('2024-03-01T00:00:00Z'),
        },
      ];

      vi.mocked(listItems).mockResolvedValue({
        items: mockItems as any,
        total: 1,
        page: 1,
        page_size: 100,
        total_pages: 1,
      });

      const buffer = await exportItems('user-123');
      const csv = buffer.toString('utf-8');
      const records = parse(csv, { columns: true }) as Record<string, string>[];

      expect(records).toHaveLength(1);
      expect(records[0].content).toBe('Content with "quotes" and, commas\nand newlines');
    });
  });

  describe('exportMaps()', () => {
    it('should generate CSV with correct headers', async () => {
      vi.mocked(queryMany).mockResolvedValue([]);

      const buffer = await exportMaps('user-123');
      const csv = buffer.toString('utf-8');
      const lines = csv.trim().split('\n');

      expect(lines[0]).toBe('source_item_id,target_item_id,relationship_type,confidence_score');
    });

    it('should export relationships with all columns', async () => {
      const mockRelationships = [
        {
          id: 'rel-1',
          source_item_id: 'item-a',
          target_item_id: 'item-b',
          relationship_type: 'related',
          strength: 0.85,
          created_at: new Date('2024-01-15T00:00:00Z'),
        },
        {
          id: 'rel-2',
          source_item_id: 'item-b',
          target_item_id: 'item-c',
          relationship_type: 'similar',
          strength: 0.72,
          created_at: new Date('2024-01-16T00:00:00Z'),
        },
      ];

      vi.mocked(queryMany).mockResolvedValue(mockRelationships);

      const buffer = await exportMaps('user-123');
      const csv = buffer.toString('utf-8');
      const records = parse(csv, { columns: true }) as Record<string, string>[];

      expect(records).toHaveLength(2);
      expect(records[0].source_item_id).toBe('item-a');
      expect(records[0].target_item_id).toBe('item-b');
      expect(records[0].relationship_type).toBe('related');
      expect(records[0].confidence_score).toBe('0.85');
      expect(records[1].source_item_id).toBe('item-b');
      expect(records[1].target_item_id).toBe('item-c');
      expect(records[1].relationship_type).toBe('similar');
      expect(records[1].confidence_score).toBe('0.72');
    });

    it('should return empty CSV with only headers when no relationships exist', async () => {
      vi.mocked(queryMany).mockResolvedValue([]);

      const buffer = await exportMaps('user-123');
      const csv = buffer.toString('utf-8');
      const records = parse(csv, { columns: true }) as Record<string, string>[];

      expect(records).toHaveLength(0);
      // Just the header line
      const lines = csv.trim().split('\n');
      expect(lines).toHaveLength(1);
    });

    it('should scope query to the authenticated user', async () => {
      vi.mocked(queryMany).mockResolvedValue([]);

      await exportMaps('user-456');

      expect(queryMany).toHaveBeenCalledWith(
        expect.stringContaining('src.user_id = $1'),
        ['user-456']
      );
    });
  });

  describe('getTemplate()', () => {
    it('should return a buffer with CSV content', () => {
      const buffer = getTemplate();
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should include correct header columns', () => {
      const buffer = getTemplate();
      const csv = buffer.toString('utf-8');
      const lines = csv.trim().split('\n');

      expect(lines[0]).toBe('content,content_type,tags,metadata');
    });

    it('should include exactly 2 example rows', () => {
      const buffer = getTemplate();
      const csv = buffer.toString('utf-8');
      const records = parse(csv, { columns: true }) as Record<string, string>[];

      expect(records).toHaveLength(2);
    });

    it('should have valid example data in all columns', () => {
      const buffer = getTemplate();
      const csv = buffer.toString('utf-8');
      const records = parse(csv, { columns: true }) as Record<string, string>[];

      // First row
      expect(records[0].content).toBeTruthy();
      expect(records[0].content_type).toBeTruthy();
      expect(records[0].tags).toBeTruthy();
      expect(records[0].metadata).toBeTruthy();

      // Second row
      expect(records[1].content).toBeTruthy();
      expect(records[1].content_type).toBeTruthy();
      expect(records[1].tags).toBeTruthy();
      expect(records[1].metadata).toBeTruthy();
    });

    it('should have parseable JSON metadata in example rows', () => {
      const buffer = getTemplate();
      const csv = buffer.toString('utf-8');
      const records = parse(csv, { columns: true }) as Record<string, string>[];

      for (const row of records) {
        expect(() => JSON.parse(row.metadata)).not.toThrow();
      }
    });
  });
});
