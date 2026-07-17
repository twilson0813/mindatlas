import { Queue, type ConnectionOptions } from 'bullmq';
import { config } from './config.js';
import { createChildLogger } from './logger.js';

const log = createChildLogger({ module: 'queues' });

/**
 * Queue names used across the application.
 */
export const QUEUE_NAMES = {
  AI_PROCESSING: 'ai-processing',
  SMS_RETRY: 'sms-retry',
  STRIPE_PAYMENT_RETRY: 'stripe-payment-retry',
  PURGE_DELETED_ITEMS: 'purge-deleted-items',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * BullMQ connection configuration using the app's Redis URL.
 * Uses the connection options interface expected by BullMQ.
 */
function getQueueConnection(): ConnectionOptions {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}

/**
 * AI Processing Queue
 * Handles async AI categorization, tagging, and relationship mapping jobs.
 * Jobs are enqueued when new items are created from any input channel.
 */
export const aiProcessingQueue = new Queue(QUEUE_NAMES.AI_PROCESSING, {
  connection: getQueueConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2s, 10s, 60s (approximately with exponential)
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

/**
 * SMS Retry Queue
 * Handles retry logic for failed SMS message processing.
 * Requirement 4.4: Retry processing up to 3 times on failure.
 */
export const smsRetryQueue = new Queue(QUEUE_NAMES.SMS_RETRY, {
  connection: getQueueConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000, // 1s, 5s, 25s (approximately with exponential)
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 2000 },
  },
});

/**
 * Stripe Payment Retry Queue
 * Handles retry logic for failed subscription payments.
 * Requirement 18.11: Retry the charge up to 3 times over 7 days.
 */
export const stripePaymentRetryQueue = new Queue(QUEUE_NAMES.STRIPE_PAYMENT_RETRY, {
  connection: getQueueConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'fixed',
      delay: 2 * 24 * 60 * 60 * 1000, // ~2.3 days between retries (3 attempts over 7 days)
    },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 1000 },
  },
});

/**
 * Purge Deleted Items Queue
 * Scheduled repeatable job that permanently deletes soft-deleted items
 * older than 24 hours (storage file + database row).
 * Requirement 12.4: Permanently remove item data within 24 hours of deletion.
 */
export const purgeDeletedItemsQueue = new Queue(QUEUE_NAMES.PURGE_DELETED_ITEMS, {
  connection: getQueueConnection(),
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

log.info({ queues: Object.values(QUEUE_NAMES) }, 'BullMQ queues initialized');

/**
 * Gracefully close all queue connections.
 * Should be called during application shutdown.
 */
export async function closeQueues(): Promise<void> {
  await Promise.all([
    aiProcessingQueue.close(),
    smsRetryQueue.close(),
    stripePaymentRetryQueue.close(),
    purgeDeletedItemsQueue.close(),
  ]);
  log.info('All BullMQ queues closed');
}
