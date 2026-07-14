import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Job } from 'bullmq';
import { processAiJob, type AiJobData, type AiJobResult } from './ai-worker.js';

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

const mockGetItem = vi.fn();
const mockListItems = vi.fn();
vi.mock('../services/items/index.js', () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
  listItems: (...args: unknown[]) => mockListItems(...args),
}));

const mockCategorizeItem = vi.fn();
const mockMapRelationships = vi.fn();
vi.mock('../services/ai-mapper/index.js', () => ({
  categorizeItem: (...args: unknown[]) => mockCategorizeItem(...args),
  mapRelationships: (...args: unknown[]) => mockMapRelationships(...args),
}));

vi.mock('../queues.js', () => ({
  QUEUE_NAMES: {
    AI_PROCESSING: 'ai-processing',
    SMS_RETRY: 'sms-retry',
    STRIPE_PAYMENT_RETRY: 'stripe-payment-retry',
  },
}));

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockJob(data: AiJobData, attemptsMade = 0): Job<AiJobData> {
  return {
    id: 'job-123',
    data,
    attemptsMade,
    opts: { attempts: 3 },
  } as unknown as Job<AiJobData>;
}

function createMockItem() {
  return {
    id: 'item-1',
    user_id: 'user-1',
    title: 'Test Item',
    content: 'This is content about machine learning.',
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
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AI Worker - processAiJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should successfully categorize and map relationships for an item', async () => {
    const item = createMockItem();
    mockGetItem.mockResolvedValue(item);
    mockCategorizeItem.mockResolvedValue({
      itemId: 'item-1',
      categories: [{ name: 'technology', confidence: 0.9 }],
      tags: [{ name: 'machine-learning', categoryName: 'technology', confidence: 0.85 }],
    });
    mockListItems.mockResolvedValue({
      items: [
        { ...item, id: 'item-2', title: 'Another Item' },
      ],
      total: 1,
      page: 1,
      page_size: 50,
      total_pages: 1,
    });
    mockMapRelationships.mockResolvedValue([
      { sourceItemId: 'item-1', targetItemId: 'item-2', relationshipType: 'related_to', strength: 0.7 },
    ]);

    const job = createMockJob({ itemId: 'item-1', userId: 'user-1', content: 'content', contentType: 'note' });
    const result = await processAiJob(job);

    expect(result.itemId).toBe('item-1');
    expect(result.categorized).toBe(true);
    expect(result.relationshipsMapped).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mockGetItem).toHaveBeenCalledWith('user-1', 'item-1');
    expect(mockCategorizeItem).toHaveBeenCalledWith(item);
    expect(mockMapRelationships).toHaveBeenCalled();
  });

  it('should return gracefully when item is not found (no retry)', async () => {
    const error = new Error('Item not found');
    (error as any).statusCode = 404;
    mockGetItem.mockRejectedValue(error);

    const job = createMockJob({ itemId: 'nonexistent', userId: 'user-1', content: '', contentType: 'note' });
    const result = await processAiJob(job);

    expect(result.categorized).toBe(false);
    expect(result.relationshipsMapped).toBe(false);
    expect(result.error).toContain('Item fetch failed');
    // Should NOT throw — no point retrying a missing item
    expect(mockCategorizeItem).not.toHaveBeenCalled();
  });

  it('should throw when AI categorization fails (triggers BullMQ retry)', async () => {
    const item = createMockItem();
    mockGetItem.mockResolvedValue(item);
    mockCategorizeItem.mockResolvedValue({
      itemId: 'item-1',
      categories: [],
      tags: [],
      error: 'Rate limit exceeded. Please retry.',
    });

    const job = createMockJob({ itemId: 'item-1', userId: 'user-1', content: 'content', contentType: 'note' });

    await expect(processAiJob(job)).rejects.toThrow('AI categorization failed');
    expect(mockMapRelationships).not.toHaveBeenCalled();
  });

  it('should throw when categorizeItem throws an exception (triggers retry)', async () => {
    const item = createMockItem();
    mockGetItem.mockResolvedValue(item);
    mockCategorizeItem.mockRejectedValue(new Error('Network timeout'));

    const job = createMockJob({ itemId: 'item-1', userId: 'user-1', content: 'content', contentType: 'note' });

    await expect(processAiJob(job)).rejects.toThrow('AI categorization failed');
  });

  it('should handle relationship mapping failure gracefully (no throw)', async () => {
    const item = createMockItem();
    mockGetItem.mockResolvedValue(item);
    mockCategorizeItem.mockResolvedValue({
      itemId: 'item-1',
      categories: [{ name: 'tech', confidence: 0.9 }],
      tags: [],
    });
    mockListItems.mockRejectedValue(new Error('Database connection lost'));

    const job = createMockJob({ itemId: 'item-1', userId: 'user-1', content: 'content', contentType: 'note' });
    const result = await processAiJob(job);

    // Categorization succeeded, relationship mapping failed gracefully
    expect(result.categorized).toBe(true);
    expect(result.relationshipsMapped).toBe(false);
    expect(result.error).toContain('Database connection lost');
  });

  it('should exclude current item from relationship comparison set', async () => {
    const item = createMockItem();
    mockGetItem.mockResolvedValue(item);
    mockCategorizeItem.mockResolvedValue({
      itemId: 'item-1',
      categories: [{ name: 'tech', confidence: 0.9 }],
      tags: [],
    });
    mockListItems.mockResolvedValue({
      items: [
        item, // same item should be filtered out
        { ...item, id: 'item-2', title: 'Other Item' },
      ],
      total: 2,
      page: 1,
      page_size: 50,
      total_pages: 1,
    });
    mockMapRelationships.mockResolvedValue([]);

    const job = createMockJob({ itemId: 'item-1', userId: 'user-1', content: 'content', contentType: 'note' });
    await processAiJob(job);

    // The items passed to mapRelationships should NOT include item-1
    const passedItems = mockMapRelationships.mock.calls[0][1];
    expect(passedItems).toHaveLength(1);
    expect(passedItems[0].id).toBe('item-2');
  });

  it('should work when user has no other items for relationship mapping', async () => {
    const item = createMockItem();
    mockGetItem.mockResolvedValue(item);
    mockCategorizeItem.mockResolvedValue({
      itemId: 'item-1',
      categories: [{ name: 'general', confidence: 0.7 }],
      tags: [],
    });
    mockListItems.mockResolvedValue({
      items: [item], // Only the current item exists
      total: 1,
      page: 1,
      page_size: 50,
      total_pages: 1,
    });
    mockMapRelationships.mockResolvedValue([]);

    const job = createMockJob({ itemId: 'item-1', userId: 'user-1', content: 'content', contentType: 'note' });
    const result = await processAiJob(job);

    expect(result.categorized).toBe(true);
    expect(result.relationshipsMapped).toBe(true);
    // mapRelationships should be called with empty array (no other items)
    const passedItems = mockMapRelationships.mock.calls[0][1];
    expect(passedItems).toHaveLength(0);
  });

  it('should pass correct attempt number in logs', async () => {
    const item = createMockItem();
    mockGetItem.mockResolvedValue(item);
    mockCategorizeItem.mockResolvedValue({
      itemId: 'item-1',
      categories: [{ name: 'tech', confidence: 0.8 }],
      tags: [],
    });
    mockListItems.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 50, total_pages: 0 });
    mockMapRelationships.mockResolvedValue([]);

    // Simulate second attempt (attemptsMade = 1)
    const job = createMockJob(
      { itemId: 'item-1', userId: 'user-1', content: 'content', contentType: 'note' },
      1 // second attempt
    );
    const result = await processAiJob(job);

    expect(result.categorized).toBe(true);
  });
});
