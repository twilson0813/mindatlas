import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateCsvStructure,
  validateCsvSize,
  parseRow,
  importCsv,
  MAX_CSV_FILE_SIZE,
  MAX_CSV_ROWS,
} from './index.js';

// Mock the items service
vi.mock('../items/index.js', () => ({
  createItem: vi.fn().mockResolvedValue({
    id: 'mock-item-id',
    user_id: 'user-1',
    content: 'test content',
    content_type: 'plain_text',
    title: null,
    metadata: null,
    source_channel: 'csv_import',
    source_domain: null,
    file_path: null,
    file_size: null,
    is_deleted: false,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  }),
}));

// Mock the logger
vi.mock('../../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the queues (required by items service dependency chain)
vi.mock('../../queues.js', () => ({
  aiProcessingQueue: { add: vi.fn() },
}));

describe('CSV Service', () => {
  describe('validateCsvStructure', () => {
    it('should accept headers containing "content" column', () => {
      const result = validateCsvStructure(['content', 'content_type', 'tags']);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept headers with "content" column (case-insensitive)', () => {
      const result = validateCsvStructure(['Content', 'Tags']);
      expect(result.valid).toBe(true);
    });

    it('should accept headers with extra whitespace around "content"', () => {
      const result = validateCsvStructure(['  content  ', 'tags']);
      expect(result.valid).toBe(true);
    });

    it('should reject headers missing "content" column', () => {
      const result = validateCsvStructure(['title', 'tags', 'metadata']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('content');
    });

    it('should reject empty headers array', () => {
      const result = validateCsvStructure([]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('no header row');
    });

    it('should accept only "content" as the sole header', () => {
      const result = validateCsvStructure(['content']);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateCsvSize', () => {
    it('should accept file within size and row limits', () => {
      const result = validateCsvSize(1024, 100);
      expect(result.valid).toBe(true);
    });

    it('should reject file exceeding 10 MB', () => {
      const result = validateCsvSize(MAX_CSV_FILE_SIZE + 1, 100);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('10 MB');
    });

    it('should reject file exceeding 5000 rows', () => {
      const result = validateCsvSize(1024, MAX_CSV_ROWS + 1);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('5000 rows');
    });

    it('should accept file exactly at limits', () => {
      const result = validateCsvSize(MAX_CSV_FILE_SIZE, MAX_CSV_ROWS);
      expect(result.valid).toBe(true);
    });

    it('should accept zero rows (empty after header)', () => {
      const result = validateCsvSize(100, 0);
      expect(result.valid).toBe(true);
    });
  });

  describe('parseRow', () => {
    it('should parse a row with valid content', () => {
      const result = parseRow({ content: 'Hello world' }, 2);
      expect(result.type).toBe('parsed');
      if (result.type === 'parsed') {
        expect(result.data.content).toBe('Hello world');
        expect(result.data.source_channel).toBe('csv_import');
      }
    });

    it('should skip a row with empty content', () => {
      const result = parseRow({ content: '' }, 3);
      expect(result.type).toBe('skipped');
      if (result.type === 'skipped') {
        expect(result.rowNumber).toBe(3);
        expect(result.reason).toContain('empty');
      }
    });

    it('should skip a row with whitespace-only content', () => {
      const result = parseRow({ content: '   ' }, 4);
      expect(result.type).toBe('skipped');
    });

    it('should skip a row with missing content key', () => {
      const result = parseRow({ tags: 'tag1,tag2' }, 5);
      expect(result.type).toBe('skipped');
    });

    it('should parse content_type when provided', () => {
      const result = parseRow({ content: 'A note', content_type: 'note' }, 2);
      expect(result.type).toBe('parsed');
      if (result.type === 'parsed') {
        expect(result.data.content_type).toBe('note');
      }
    });

    it('should parse tags into metadata', () => {
      const result = parseRow({ content: 'Tagged item', tags: 'tag1, tag2, tag3' }, 2);
      expect(result.type).toBe('parsed');
      if (result.type === 'parsed') {
        expect(result.data.metadata).toEqual({ tags: ['tag1', 'tag2', 'tag3'] });
      }
    });

    it('should parse valid metadata JSON', () => {
      const result = parseRow({ content: 'With metadata', metadata: '{"key": "value"}' }, 2);
      expect(result.type).toBe('parsed');
      if (result.type === 'parsed') {
        expect(result.data.metadata).toEqual({ key: 'value' });
      }
    });

    it('should ignore invalid metadata JSON and still create item', () => {
      const result = parseRow({ content: 'Bad metadata', metadata: 'not json' }, 2);
      expect(result.type).toBe('parsed');
      if (result.type === 'parsed') {
        expect(result.data.content).toBe('Bad metadata');
      }
    });

    it('should handle case-insensitive header keys', () => {
      const result = parseRow({ Content: 'Case test', Tags: 'a,b' }, 2);
      expect(result.type).toBe('parsed');
      if (result.type === 'parsed') {
        expect(result.data.content).toBe('Case test');
        expect(result.data.metadata).toEqual({ tags: ['a', 'b'] });
      }
    });

    it('should trim content value', () => {
      const result = parseRow({ content: '  trimmed  ' }, 2);
      expect(result.type).toBe('parsed');
      if (result.type === 'parsed') {
        expect(result.data.content).toBe('trimmed');
      }
    });
  });

  describe('importCsv', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should import valid CSV and return correct counts', async () => {
      const csv = 'content,content_type\nHello world,plain_text\nSecond item,note\n';
      const buffer = Buffer.from(csv, 'utf-8');

      const result = await importCsv('user-1', buffer);

      expect(result.itemsCreated).toBe(2);
      expect(result.rowsSkipped).toBe(0);
      expect(result.skippedRowNumbers).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should skip rows with empty content and report row numbers', async () => {
      const csv = 'content,tags\nFirst item,tag1\n,tag2\nThird item,tag3\n';
      const buffer = Buffer.from(csv, 'utf-8');

      const result = await importCsv('user-1', buffer);

      expect(result.itemsCreated).toBe(2);
      expect(result.rowsSkipped).toBe(1);
      expect(result.skippedRowNumbers).toContain(3); // Row 3 (header is row 1)
    });

    it('should reject CSV missing "content" header', async () => {
      const csv = 'title,tags\nSome title,tag1\n';
      const buffer = Buffer.from(csv, 'utf-8');

      await expect(importCsv('user-1', buffer)).rejects.toThrow('content');
    });

    it('should reject CSV exceeding file size limit', async () => {
      const hugeBuffer = Buffer.alloc(MAX_CSV_FILE_SIZE + 1, 'a');

      await expect(importCsv('user-1', hugeBuffer)).rejects.toThrow('10 MB');
    });

    it('should reject CSV exceeding row limit', async () => {
      // Create a CSV with > 5000 rows
      let csv = 'content\n';
      for (let i = 0; i < MAX_CSV_ROWS + 1; i++) {
        csv += `row ${i}\n`;
      }
      const buffer = Buffer.from(csv, 'utf-8');

      await expect(importCsv('user-1', buffer)).rejects.toThrow('5000 rows');
    });

    it('should handle CSV with only header and no data rows', async () => {
      const csv = 'content,tags\n';
      const buffer = Buffer.from(csv, 'utf-8');

      const result = await importCsv('user-1', buffer);

      expect(result.itemsCreated).toBe(0);
      expect(result.rowsSkipped).toBe(0);
    });

    it('should handle CSV with all empty content rows', async () => {
      const csv = 'content,tags\n,tag1\n,tag2\n,tag3\n';
      const buffer = Buffer.from(csv, 'utf-8');

      const result = await importCsv('user-1', buffer);

      expect(result.itemsCreated).toBe(0);
      expect(result.rowsSkipped).toBe(3);
      expect(result.skippedRowNumbers).toEqual([2, 3, 4]);
    });

    it('should handle item creation failures gracefully', async () => {
      const { createItem } = await import('../items/index.js');
      const mockCreateItem = vi.mocked(createItem);
      mockCreateItem.mockRejectedValueOnce(new Error('DB connection failed'));

      const csv = 'content\nFailing item\nSuccessful item\n';
      const buffer = Buffer.from(csv, 'utf-8');

      const result = await importCsv('user-1', buffer);

      expect(result.itemsCreated).toBe(1);
      expect(result.rowsSkipped).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].row).toBe(2);
      expect(result.errors[0].reason).toContain('DB connection failed');
    });
  });
});
