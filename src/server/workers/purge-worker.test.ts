import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Job } from 'bullmq';
import { processPurgeJob, type PurgableItem, type PurgeJobResult } from './purge-worker.js';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

vi.mock('../config.js', () => ({
  config: {
    redisUrl: 'redis://localhost:6379',
    nodeEnv: 'test',
  },
}));

vi.mock('../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockQueryMany = vi.fn();
const mockQuery = vi.fn();
vi.mock('../db/index.js', () => ({
  queryMany: (...args: unknown[]) => mockQueryMany(...args),
  query: (...args: unknown[]) => mockQuery(...args),
}));

const mockDeleteFile = vi.fn();
vi.mock('../services/storage/index.js', () => ({
  deleteFile: (...args: unknown[]) => mockDeleteFile(...args),
}));

vi.mock('../queues.js', () => ({
  QUEUE_NAMES: {
    AI_PROCESSING: 'ai-processing',
    SMS_RETRY: 'sms-retry',
    STRIPE_PAYMENT_RETRY: 'stripe-payment-retry',
    PURGE_DELETED_ITEMS: 'purge-deleted-items',
  },
  purgeDeletedItemsQueue: {
    upsertJobScheduler: vi.fn(),
  },
}));

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockJob(): Job {
  return {
    id: 'purge-job-1',
    data: {},
    attemptsMade: 0,
    opts: {},
    returnvalue: undefined,
  } as unknown as Job;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Purge Worker - processPurgeJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return zero counts when no items are eligible for purge', async () => {
    mockQueryMany.mockResolvedValue([]);

    const job = createMockJob();
    const result = await processPurgeJob(job);

    expect(result.purgedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should query items deleted more than 24 hours ago', async () => {
    mockQueryMany.mockResolvedValue([]);

    const job = createMockJob();
    await processPurgeJob(job);

    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('is_deleted = true'));
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining("INTERVAL '24 hours'"));
  });

  it('should hard-delete items without file_path (no storage call)', async () => {
    const items: PurgableItem[] = [
      { id: 'item-1', user_id: 'user-1', file_path: null },
      { id: 'item-2', user_id: 'user-2', file_path: null },
    ];
    mockQueryMany.mockResolvedValue(items);
    mockQuery.mockResolvedValue({ rowCount: 1 });

    const job = createMockJob();
    const result = await processPurgeJob(job);

    expect(result.purgedCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery).toHaveBeenCalledWith('DELETE FROM item WHERE id = $1', ['item-1']);
    expect(mockQuery).toHaveBeenCalledWith('DELETE FROM item WHERE id = $1', ['item-2']);
  });

  it('should delete file from storage before hard-deleting the row', async () => {
    const items: PurgableItem[] = [
      { id: 'item-1', user_id: 'user-1', file_path: 'user-1/abc123.pdf' },
    ];
    mockQueryMany.mockResolvedValue(items);
    mockDeleteFile.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rowCount: 1 });

    const job = createMockJob();
    const result = await processPurgeJob(job);

    expect(result.purgedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(mockDeleteFile).toHaveBeenCalledWith('user-1/abc123.pdf');
    expect(mockQuery).toHaveBeenCalledWith('DELETE FROM item WHERE id = $1', ['item-1']);
  });

  it('should handle mix of items with and without files', async () => {
    const items: PurgableItem[] = [
      { id: 'item-1', user_id: 'user-1', file_path: 'user-1/file1.png' },
      { id: 'item-2', user_id: 'user-1', file_path: null },
      { id: 'item-3', user_id: 'user-2', file_path: 'user-2/file2.txt' },
    ];
    mockQueryMany.mockResolvedValue(items);
    mockDeleteFile.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rowCount: 1 });

    const job = createMockJob();
    const result = await processPurgeJob(job);

    expect(result.purgedCount).toBe(3);
    expect(result.failedCount).toBe(0);
    expect(mockDeleteFile).toHaveBeenCalledTimes(2);
    expect(mockDeleteFile).toHaveBeenCalledWith('user-1/file1.png');
    expect(mockDeleteFile).toHaveBeenCalledWith('user-2/file2.txt');
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('should continue processing remaining items when one fails', async () => {
    const items: PurgableItem[] = [
      { id: 'item-1', user_id: 'user-1', file_path: null },
      { id: 'item-2', user_id: 'user-1', file_path: null },
      { id: 'item-3', user_id: 'user-1', file_path: null },
    ];
    mockQueryMany.mockResolvedValue(items);
    // Second item fails on delete
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockRejectedValueOnce(new Error('Database connection lost'))
      .mockResolvedValueOnce({ rowCount: 1 });

    const job = createMockJob();
    const result = await processPurgeJob(job);

    expect(result.purgedCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('item-2');
    expect(result.errors[0]).toContain('Database connection lost');
  });

  it('should count storage deletion failure as item failure', async () => {
    const items: PurgableItem[] = [
      { id: 'item-1', user_id: 'user-1', file_path: 'user-1/file.pdf' },
    ];
    mockQueryMany.mockResolvedValue(items);
    mockDeleteFile.mockRejectedValue(new Error('Storage unavailable'));

    const job = createMockJob();
    const result = await processPurgeJob(job);

    expect(result.purgedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.errors[0]).toContain('Storage unavailable');
    // Should not attempt DB delete if storage delete failed
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should purge a large batch of items', async () => {
    const items: PurgableItem[] = Array.from({ length: 50 }, (_, i) => ({
      id: `item-${i}`,
      user_id: `user-${i % 5}`,
      file_path: i % 3 === 0 ? `user-${i % 5}/file-${i}.txt` : null,
    }));
    mockQueryMany.mockResolvedValue(items);
    mockDeleteFile.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rowCount: 1 });

    const job = createMockJob();
    const result = await processPurgeJob(job);

    expect(result.purgedCount).toBe(50);
    expect(result.failedCount).toBe(0);
    // Items with file_path: indices 0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48 = 17 items
    expect(mockDeleteFile).toHaveBeenCalledTimes(17);
    expect(mockQuery).toHaveBeenCalledTimes(50);
  });
});
