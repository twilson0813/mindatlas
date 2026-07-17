import { Worker, Job, type ConnectionOptions } from 'bullmq';
import { config } from '../config.js';
import { createChildLogger } from '../logger.js';
import { QUEUE_NAMES, purgeDeletedItemsQueue } from '../queues.js';
import { queryMany, query } from '../db/index.js';
import { deleteFile } from '../services/storage/index.js';

const log = createChildLogger({ module: 'purge-worker' });

// ─── Types ───────────────────────────────────────────────────────────────────

/** Shape of a soft-deleted item row eligible for permanent removal */
export interface PurgableItem {
  id: string;
  user_id: string;
  file_path: string | null;
}

/** Result returned from a purge job run */
export interface PurgeJobResult {
  purgedCount: number;
  failedCount: number;
  errors: string[];
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
 * Processes a purge job:
 * 1. Queries all items where is_deleted = true AND deleted_at < NOW() - 24 hours
 * 2. For each item: deletes the file from storage (if file_path exists)
 * 3. Hard-deletes the row from the database
 * 4. Logs how many items were purged
 *
 * Requirement 12.4: Permanently remove item data within 24 hours of deletion.
 */
export async function processPurgeJob(job: Job): Promise<PurgeJobResult> {
  log.info({ jobId: job.id }, 'Starting purge of soft-deleted items');

  // Find all items eligible for permanent deletion (deleted > 24 hours ago)
  const purgableItems = await queryMany<PurgableItem>(
    `SELECT id, user_id, file_path
     FROM items
     WHERE is_deleted = true
       AND deleted_at < NOW() - INTERVAL '24 hours'`,
  );

  if (purgableItems.length === 0) {
    log.info({ jobId: job.id }, 'No items eligible for purge');
    return { purgedCount: 0, failedCount: 0, errors: [] };
  }

  log.info(
    { jobId: job.id, eligibleCount: purgableItems.length },
    'Found items eligible for purge',
  );

  let purgedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  for (const item of purgableItems) {
    try {
      // Delete file from storage if file_path exists
      if (item.file_path) {
        await deleteFile(item.file_path);
      }

      // Hard-delete the row from the database
      await query('DELETE FROM items WHERE id = $1', [item.id]);

      purgedCount++;
    } catch (err) {
      failedCount++;
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`Failed to purge item ${item.id}: ${message}`);
      log.error({ itemId: item.id, userId: item.user_id, error: message }, 'Failed to purge item');
    }
  }

  log.info(
    { jobId: job.id, purgedCount, failedCount, totalEligible: purgableItems.length },
    'Purge job completed',
  );

  return { purgedCount, failedCount, errors };
}

// ─── Worker Instance ─────────────────────────────────────────────────────────

let purgeWorker: Worker | null = null;

/**
 * Starts the BullMQ purge worker and registers a repeatable job
 * that runs every hour to permanently delete expired soft-deleted items.
 *
 * Requirement 12.4: Permanently remove item data within 24 hours of deletion.
 */
export async function startPurgeWorker(): Promise<Worker> {
  if (purgeWorker) {
    log.warn('Purge worker already running');
    return purgeWorker;
  }

  // Register a repeatable job that runs every hour
  await purgeDeletedItemsQueue.upsertJobScheduler(
    'purge-deleted-items-scheduler',
    { pattern: '0 * * * *' }, // Every hour at minute 0
    { name: 'purge-deleted-items' },
  );

  purgeWorker = new Worker(QUEUE_NAMES.PURGE_DELETED_ITEMS, processPurgeJob, {
    connection: getWorkerConnection(),
    concurrency: 1, // Only one purge job at a time
  });

  // ─── Event Handlers ──────────────────────────────────────────────────────

  purgeWorker.on('completed', (job: Job | undefined) => {
    if (job) {
      log.info({ jobId: job.id, result: job.returnvalue }, 'Purge job completed');
    }
  });

  purgeWorker.on('failed', (job: Job | undefined, err: Error) => {
    if (job) {
      log.error({ jobId: job.id, error: err.message }, 'Purge job failed');
    }
  });

  purgeWorker.on('error', (err: Error) => {
    log.error({ error: err.message }, 'Purge worker error');
  });

  log.info(
    { queue: QUEUE_NAMES.PURGE_DELETED_ITEMS, schedule: 'every hour' },
    'Purge worker started',
  );

  return purgeWorker;
}

/**
 * Gracefully stops the purge worker.
 */
export async function stopPurgeWorker(): Promise<void> {
  if (!purgeWorker) {
    log.warn('Purge worker not running');
    return;
  }

  await purgeWorker.close();
  purgeWorker = null;
  log.info('Purge worker stopped');
}

/**
 * Returns whether the purge worker is currently running.
 */
export function isPurgeWorkerRunning(): boolean {
  return purgeWorker !== null && !purgeWorker.closing;
}
