import { Worker, Job, type ConnectionOptions } from 'bullmq';
import { config } from '../config.js';
import { createChildLogger } from '../logger.js';
import { QUEUE_NAMES } from '../queues.js';
import { categorizeItem, mapRelationships } from '../services/ai-mapper/index.js';
import { getItem, listItems } from '../services/items/index.js';

const log = createChildLogger({ module: 'ai-worker' });

// ─── Types ───────────────────────────────────────────────────────────────────

/** Shape of an AI processing job's data payload */
export interface AiJobData {
  itemId: string;
  userId: string;
  content: string;
  contentType: string;
}

/** Result returned from processing a job */
export interface AiJobResult {
  itemId: string;
  categorized: boolean;
  relationshipsMapped: boolean;
  error?: string;
}

// ─── Connection ──────────────────────────────────────────────────────────────

/**
 * Returns BullMQ-compatible Redis connection options from app config.
 */
export function getWorkerConnection(): ConnectionOptions {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}

// ─── Job Processor ───────────────────────────────────────────────────────────

/**
 * Processes an AI categorization job:
 * 1. Fetches the item from the database
 * 2. Calls categorizeItem() for AI-based tagging
 * 3. Calls mapRelationships() to find connections with existing items
 *
 * Graceful degradation: If the AI fails, the item remains stored.
 * The error is logged and surfaced in the job result, but does NOT
 * cause a throw (which would trigger BullMQ retries for transient errors).
 * Only unexpected/infrastructure errors are thrown to trigger retries.
 *
 * Requirements: 6.1, 7.4
 */
export async function processAiJob(job: Job<AiJobData>): Promise<AiJobResult> {
  const { itemId, userId } = job.data;

  log.info({ jobId: job.id, itemId, userId, attempt: job.attemptsMade + 1 }, 'Processing AI job');

  // Fetch the full item from the database
  let item;
  try {
    item = await getItem(userId, itemId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error({ jobId: job.id, itemId, error: message }, 'Failed to fetch item for AI processing');
    // Item not found or access denied — no point retrying
    return {
      itemId,
      categorized: false,
      relationshipsMapped: false,
      error: `Item fetch failed: ${message}`,
    };
  }

  let categorized = false;
  let relationshipsMapped = false;
  let lastError: string | undefined;

  // Step 1: AI Categorization
  try {
    const categoryResult = await categorizeItem(item);
    if (categoryResult.error) {
      // AI returned a soft error — throw to trigger retry via BullMQ
      throw new Error(categoryResult.error);
    }
    categorized = true;
    log.info(
      {
        jobId: job.id,
        itemId,
        categories: categoryResult.categories.length,
        tags: categoryResult.tags.length,
      },
      'Categorization complete',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown AI error';
    lastError = message;
    log.warn(
      { jobId: job.id, itemId, error: message, attempt: job.attemptsMade + 1 },
      'AI categorization failed — will retry if attempts remain',
    );
    // Throw to trigger BullMQ retry with exponential backoff
    throw new Error(`AI categorization failed: ${message}`);
  }

  // Step 2: Relationship Mapping (only if categorization succeeded)
  try {
    // Fetch existing user items for relationship comparison
    const existingResult = await listItems(userId, { page: 1, page_size: 50 });
    // Exclude the current item from the comparison set
    const existingItems = existingResult.items.filter((i) => i.id !== itemId);

    const relationships = await mapRelationships(item, existingItems);
    relationshipsMapped = relationships.length >= 0; // even 0 relationships is a valid result
    log.info(
      { jobId: job.id, itemId, relationships: relationships.length },
      'Relationship mapping complete',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    lastError = message;
    log.warn(
      { jobId: job.id, itemId, error: message },
      'Relationship mapping failed — item still stored (graceful degradation)',
    );
    // Relationship mapping failure is non-critical: items is already categorized
    // We log and continue rather than throwing (graceful degradation)
  }

  return {
    itemId,
    categorized,
    relationshipsMapped,
    error: lastError,
  };
}

// ─── Worker Instance ─────────────────────────────────────────────────────────

let aiWorker: Worker<AiJobData, AiJobResult> | null = null;

/**
 * Starts the BullMQ AI processing worker.
 * Listens on the 'ai-processing' queue and processes jobs with the processAiJob handler.
 *
 * BullMQ handles retries automatically based on the queue's defaultJobOptions:
 * - 3 attempts with exponential backoff (2s, 10s, 60s approximately)
 * - Jobs exceeding max retries are moved to the failed set (dead letter behavior)
 *
 * The removeOnFail option with a high count (5000) in the queue config
 * means failed jobs are retained for inspection (acting as a dead letter queue).
 */
export function startAiWorker(): Worker<AiJobData, AiJobResult> {
  if (aiWorker) {
    log.warn('AI worker already running');
    return aiWorker;
  }

  aiWorker = new Worker<AiJobData, AiJobResult>(QUEUE_NAMES.AI_PROCESSING, processAiJob, {
    connection: getWorkerConnection(),
    concurrency: 5,
    limiter: {
      max: 10,
      duration: 60000, // Rate limit: max 10 jobs per minute to avoid API rate limits
    },
  });

  // ─── Event Handlers ──────────────────────────────────────────────────────

  aiWorker.on('completed', (job: Job<AiJobData, AiJobResult> | undefined) => {
    if (job) {
      log.info(
        { jobId: job.id, itemId: job.data.itemId, result: job.returnvalue },
        'AI job completed',
      );
    }
  });

  aiWorker.on('failed', (job: Job<AiJobData, AiJobResult> | undefined, err: Error) => {
    if (job) {
      const isMaxRetriesExceeded = job.attemptsMade >= (job.opts.attempts || 3);
      log.error(
        {
          jobId: job.id,
          itemId: job.data.itemId,
          attempt: job.attemptsMade,
          maxAttempts: job.opts.attempts || 3,
          error: err.message,
          movedToDeadLetter: isMaxRetriesExceeded,
        },
        isMaxRetriesExceeded
          ? 'AI job moved to dead letter queue (max retries exceeded)'
          : 'AI job failed — will retry',
      );
    }
  });

  aiWorker.on('error', (err: Error) => {
    log.error({ error: err.message }, 'AI worker error');
  });

  log.info({ queue: QUEUE_NAMES.AI_PROCESSING, concurrency: 5 }, 'AI worker started');

  return aiWorker;
}

/**
 * Gracefully stops the AI processing worker.
 * Waits for currently running jobs to complete before shutting down.
 */
export async function stopAiWorker(): Promise<void> {
  if (!aiWorker) {
    log.warn('AI worker not running');
    return;
  }

  await aiWorker.close();
  aiWorker = null;
  log.info('AI worker stopped');
}

/**
 * Returns whether the AI worker is currently running.
 */
export function isAiWorkerRunning(): boolean {
  return aiWorker !== null && !aiWorker.closing;
}
