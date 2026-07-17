import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config
vi.mock('./config.js', () => ({
  config: {
    redisUrl: 'redis://localhost:6379',
    nodeEnv: 'test',
  },
}));

// Mock logger
vi.mock('./logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Track Queue constructor calls
const mockClose = vi.fn().mockResolvedValue(undefined);

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation((name: string, opts: Record<string, unknown>) => {
    return {
      name,
      opts,
      close: mockClose,
      add: vi.fn().mockResolvedValue({ id: '1' }),
    };
  }),
}));

describe('Queues Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export QUEUE_NAMES with correct values', async () => {
    const { QUEUE_NAMES } = await import('./queues.js');
    expect(QUEUE_NAMES.AI_PROCESSING).toBe('ai-processing');
    expect(QUEUE_NAMES.SMS_RETRY).toBe('sms-retry');
    expect(QUEUE_NAMES.STRIPE_PAYMENT_RETRY).toBe('stripe-payment-retry');
  });

  it('should export aiProcessingQueue', async () => {
    const { aiProcessingQueue } = await import('./queues.js');
    expect(aiProcessingQueue).toBeDefined();
    expect(aiProcessingQueue.name).toBe('ai-processing');
  });

  it('should export smsRetryQueue', async () => {
    const { smsRetryQueue } = await import('./queues.js');
    expect(smsRetryQueue).toBeDefined();
    expect(smsRetryQueue.name).toBe('sms-retry');
  });

  it('should export stripePaymentRetryQueue', async () => {
    const { stripePaymentRetryQueue } = await import('./queues.js');
    expect(stripePaymentRetryQueue).toBeDefined();
    expect(stripePaymentRetryQueue.name).toBe('stripe-payment-retry');
  });

  it('should configure AI processing queue with 3 retry attempts and exponential backoff', async () => {
    const { aiProcessingQueue } = await import('./queues.js');
    const opts = (
      aiProcessingQueue as unknown as {
        opts: { defaultJobOptions: { attempts: number; backoff: { type: string; delay: number } } };
      }
    ).opts;
    expect(opts.defaultJobOptions.attempts).toBe(3);
    expect(opts.defaultJobOptions.backoff.type).toBe('exponential');
    expect(opts.defaultJobOptions.backoff.delay).toBe(2000);
  });

  it('should configure SMS retry queue with 3 attempts and exponential backoff', async () => {
    const { smsRetryQueue } = await import('./queues.js');
    const opts = (
      smsRetryQueue as unknown as {
        opts: { defaultJobOptions: { attempts: number; backoff: { type: string; delay: number } } };
      }
    ).opts;
    expect(opts.defaultJobOptions.attempts).toBe(3);
    expect(opts.defaultJobOptions.backoff.type).toBe('exponential');
    expect(opts.defaultJobOptions.backoff.delay).toBe(1000);
  });

  it('should configure Stripe payment retry queue with 3 attempts over ~7 days', async () => {
    const { stripePaymentRetryQueue } = await import('./queues.js');
    const opts = (
      stripePaymentRetryQueue as unknown as {
        opts: { defaultJobOptions: { attempts: number; backoff: { type: string; delay: number } } };
      }
    ).opts;
    expect(opts.defaultJobOptions.attempts).toBe(3);
    expect(opts.defaultJobOptions.backoff.type).toBe('fixed');
    // ~2.3 days between retries to cover 7 days with 3 attempts
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    expect(opts.defaultJobOptions.backoff.delay).toBe(twoDaysMs);
  });

  it('should export closeQueues function that closes all queues', async () => {
    const { closeQueues } = await import('./queues.js');
    expect(typeof closeQueues).toBe('function');
    await closeQueues();
    expect(mockClose).toHaveBeenCalledTimes(4);
  });
});
