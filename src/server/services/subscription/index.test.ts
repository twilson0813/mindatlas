import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  subscribeToPlan,
  upgradePlan,
  downgradePlan,
  cancelSubscription,
  handleStripeWebhook,
  retryFailedPayment,
  checkEntitlement,
  checkStorageLimit,
  checkAiQueryLimit,
  getBillingHistory,
  updatePaymentMethod,
  getUserSubscription,
  setStripeClient,
} from './index.js';

// Mock dependencies
vi.mock('../../db/db.js', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  query: vi.fn(),
}));

vi.mock('../../middleware/entitlement.js', () => ({
  loadEntitlements: vi.fn(),
}));

vi.mock('../../queues.js', () => ({
  stripePaymentRetryQueue: {
    add: vi.fn(),
  },
}));

vi.mock('../../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../config.js', () => ({
  config: {
    stripeSecretKey: 'sk_test_fake',
    stripeWebhookSecret: 'whsec_test_fake',
  },
}));

import { queryOne, queryMany } from '../../db/db.js';
import { loadEntitlements } from '../../middleware/entitlement.js';
import { stripePaymentRetryQueue } from '../../queues.js';

const mockQueryOne = vi.mocked(queryOne);
const mockQueryMany = vi.mocked(queryMany);
const mockLoadEntitlements = vi.mocked(loadEntitlements);
const mockRetryQueueAdd = vi.mocked(stripePaymentRetryQueue.add);

// Mock Stripe client
function createMockStripe() {
  return {
    customers: {
      create: vi.fn().mockResolvedValue({ id: 'cus_test123' }),
      update: vi.fn().mockResolvedValue({}),
    },
    subscriptions: {
      create: vi.fn().mockResolvedValue({
        id: 'sub_test123',
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        items: { data: [{ id: 'si_item1' }] },
      }),
      retrieve: vi.fn().mockResolvedValue({
        id: 'sub_test123',
        items: { data: [{ id: 'si_item1' }] },
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    invoices: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      pay: vi.fn().mockResolvedValue({}),
    },
    paymentMethods: {
      attach: vi.fn().mockResolvedValue({}),
    },
    webhooks: {
      constructEvent: vi.fn(),
    },
  } as unknown as ReturnType<typeof import('stripe').default['prototype']['constructor']>;
}

describe('Subscription Service', () => {
  let mockStripe: ReturnType<typeof createMockStripe>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStripe = createMockStripe();
    setStripeClient(mockStripe as unknown as import('stripe').default);
  });

  describe('getUserSubscription', () => {
    it('should return null when user has no subscription', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      const result = await getUserSubscription('user-1');
      expect(result).toBeNull();
    });

    it('should return mapped subscription when found', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1',
        user_id: 'user-1',
        plan_id: 'plan-1',
        plan_name: 'pro',
        status: 'active',
        stripe_subscription_id: 'sub_stripe',
        stripe_customer_id: 'cus_stripe',
        current_period_start: new Date('2024-01-01'),
        current_period_end: new Date('2024-02-01'),
        pending_plan_id: null,
        canceled_at: null,
      });

      const result = await getUserSubscription('user-1');
      expect(result).not.toBeNull();
      expect(result!.planName).toBe('pro');
      expect(result!.status).toBe('active');
      expect(result!.userId).toBe('user-1');
    });
  });

  describe('subscribeToPlan', () => {
    it('should create a Stripe subscription and DB record', async () => {
      // Plan lookup
      mockQueryOne.mockResolvedValueOnce({
        id: 'plan-pro',
        name: 'pro',
        display_name: 'Pro',
        stripe_price_id: 'price_pro123',
        price_monthly_cents: 1999,
        storage_limit_mb: 5120,
        ai_queries_per_day: 100,
        is_active: true,
      });
      // No existing subscription
      mockQueryOne.mockResolvedValueOnce(null);
      // User lookup
      mockQueryOne.mockResolvedValueOnce({ email: 'user@test.com' });
      // Insert subscription
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1',
        user_id: 'user-1',
        plan_id: 'plan-pro',
        status: 'active',
        stripe_subscription_id: 'sub_test123',
        stripe_customer_id: 'cus_test123',
        current_period_start: new Date(),
        current_period_end: new Date(),
        pending_plan_id: null,
        canceled_at: null,
      });

      const result = await subscribeToPlan('user-1', 'plan-pro', 'pm_card123');

      expect(result.planName).toBe('pro');
      expect(result.status).toBe('active');
      expect((mockStripe.customers.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'user@test.com', payment_method: 'pm_card123' })
      );
      expect((mockStripe.subscriptions.create as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });

    it('should throw if plan not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      await expect(subscribeToPlan('user-1', 'bad-plan', 'pm_card123'))
        .rejects.toThrow('Plan not found or is inactive');
    });

    it('should throw if user already has active subscription', async () => {
      // Plan found
      mockQueryOne.mockResolvedValueOnce({
        id: 'plan-pro', name: 'pro', display_name: 'Pro',
        stripe_price_id: 'price_pro', price_monthly_cents: 1999,
        storage_limit_mb: 5120, ai_queries_per_day: 100, is_active: true,
      });
      // Existing subscription found
      mockQueryOne.mockResolvedValueOnce({ id: 'existing-sub', status: 'active' });

      await expect(subscribeToPlan('user-1', 'plan-pro', 'pm_card123'))
        .rejects.toThrow('User already has an active subscription');
    });
  });

  describe('upgradePlan', () => {
    it('should prorate and activate new plan immediately', async () => {
      // Current subscription
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1', user_id: 'user-1', plan_id: 'plan-free',
        status: 'active', stripe_subscription_id: 'sub_stripe',
        stripe_customer_id: 'cus_stripe',
        current_period_start: new Date(), current_period_end: new Date(),
        pending_plan_id: null, canceled_at: null,
      });
      // New plan
      mockQueryOne.mockResolvedValueOnce({
        id: 'plan-pro', name: 'pro', display_name: 'Pro',
        stripe_price_id: 'price_pro', price_monthly_cents: 1999,
        storage_limit_mb: 5120, ai_queries_per_day: 100, is_active: true,
      });
      // Update DB
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1', user_id: 'user-1', plan_id: 'plan-pro',
        status: 'active', stripe_subscription_id: 'sub_stripe',
        stripe_customer_id: 'cus_stripe',
        current_period_start: new Date(), current_period_end: new Date(),
        pending_plan_id: null, canceled_at: null,
      });

      const result = await upgradePlan('user-1', 'plan-pro');

      expect(result.planName).toBe('pro');
      expect((mockStripe.subscriptions.update as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        'sub_stripe',
        expect.objectContaining({ proration_behavior: 'create_prorations' })
      );
    });

    it('should throw if no active subscription exists', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      await expect(upgradePlan('user-1', 'plan-pro'))
        .rejects.toThrow('No active subscription found');
    });
  });

  describe('downgradePlan', () => {
    it('should schedule downgrade at period end without changing current plan', async () => {
      // Current subscription
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1', user_id: 'user-1', plan_id: 'plan-pro',
        status: 'active', stripe_subscription_id: 'sub_stripe',
        stripe_customer_id: 'cus_stripe',
        current_period_start: new Date(), current_period_end: new Date(),
        pending_plan_id: null, canceled_at: null,
      });
      // New plan
      mockQueryOne.mockResolvedValueOnce({
        id: 'plan-free', name: 'free', display_name: 'Free',
        stripe_price_id: null, price_monthly_cents: 0,
        storage_limit_mb: 500, ai_queries_per_day: 10, is_active: true,
      });
      // Update sets pending_plan_id
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1', user_id: 'user-1', plan_id: 'plan-pro',
        status: 'active', stripe_subscription_id: 'sub_stripe',
        stripe_customer_id: 'cus_stripe',
        current_period_start: new Date(), current_period_end: new Date(),
        pending_plan_id: 'plan-free', canceled_at: null,
      });
      // Current plan name lookup
      mockQueryOne.mockResolvedValueOnce({ name: 'pro' });

      const result = await downgradePlan('user-1', 'plan-free');

      // Still on current plan
      expect(result.planName).toBe('pro');
      expect(result.pendingPlanId).toBe('plan-free');
    });

    it('should throw if no active subscription', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      await expect(downgradePlan('user-1', 'plan-free'))
        .rejects.toThrow('No active subscription found');
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel at period end in Stripe and mark canceled_at in DB', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1', user_id: 'user-1', plan_id: 'plan-pro',
        status: 'active', stripe_subscription_id: 'sub_stripe',
        stripe_customer_id: 'cus_stripe',
        current_period_start: new Date(), current_period_end: new Date(),
        pending_plan_id: null, canceled_at: null,
      });
      mockQueryOne.mockResolvedValueOnce(null); // Update

      await cancelSubscription('user-1');

      expect((mockStripe.subscriptions.update as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        'sub_stripe',
        { cancel_at_period_end: true }
      );
    });

    it('should throw if no active subscription', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      await expect(cancelSubscription('user-1'))
        .rejects.toThrow('No active subscription found');
    });
  });

  describe('handleStripeWebhook', () => {
    it('should reject invalid webhook signatures', async () => {
      (mockStripe.webhooks.constructEvent as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      await expect(handleStripeWebhook(Buffer.from('body'), 'bad-sig'))
        .rejects.toThrow('Invalid webhook signature');
    });

    it('should process invoice.payment_succeeded events', async () => {
      const event = {
        type: 'invoice.payment_succeeded',
        id: 'evt_123',
        data: {
          object: {
            subscription: 'sub_stripe',
            amount_paid: 1999,
            currency: 'usd',
            payment_intent: 'pi_123',
          },
        },
      };
      (mockStripe.webhooks.constructEvent as ReturnType<typeof vi.fn>).mockReturnValue(event);

      // Subscription lookup
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1', user_id: 'user-1', plan_id: 'plan-pro',
        pending_plan_id: null,
      });
      // Insert payment history
      mockQueryOne.mockResolvedValueOnce(null);

      await handleStripeWebhook(Buffer.from('body'), 'sig_valid');
      expect(mockQueryOne).toHaveBeenCalledTimes(2);
    });

    it('should process invoice.payment_failed and enqueue retry', async () => {
      const event = {
        type: 'invoice.payment_failed',
        id: 'evt_456',
        data: {
          object: {
            subscription: 'sub_stripe',
            amount_due: 1999,
            currency: 'usd',
            payment_intent: 'pi_456',
          },
        },
      };
      (mockStripe.webhooks.constructEvent as ReturnType<typeof vi.fn>).mockReturnValue(event);

      // Subscription lookup
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1', user_id: 'user-1', plan_id: 'plan-pro',
        stripe_subscription_id: 'sub_stripe',
      });
      // Insert payment history
      mockQueryOne.mockResolvedValueOnce(null);
      // Update status to past_due
      mockQueryOne.mockResolvedValueOnce(null);

      await handleStripeWebhook(Buffer.from('body'), 'sig_valid');

      expect(mockRetryQueueAdd).toHaveBeenCalledWith(
        'retry-payment',
        expect.objectContaining({
          subscriptionId: 'sub-1',
          userId: 'user-1',
          attempt: 1,
        }),
        expect.objectContaining({ delay: expect.any(Number) })
      );
    });
  });

  describe('retryFailedPayment', () => {
    it('should do nothing if subscription not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      await retryFailedPayment('nonexistent');
      expect((mockStripe.invoices.list as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    });

    it('should do nothing if no open invoices', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1', stripe_subscription_id: 'sub_stripe',
      });
      (mockStripe.invoices.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: [] });

      await retryFailedPayment('sub-1');
      expect((mockStripe.invoices.pay as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    });

    it('should mark subscription active when retry succeeds', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1', stripe_subscription_id: 'sub_stripe',
      });
      (mockStripe.invoices.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: [{ id: 'inv_123' }],
      });
      (mockStripe.invoices.pay as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
      mockQueryOne.mockResolvedValueOnce(null); // Update to active

      await retryFailedPayment('sub-1');

      // Should have tried to update status to active
      const updateCall = mockQueryOne.mock.calls[1];
      expect(updateCall[0]).toContain("status = 'active'");
    });
  });

  describe('checkEntitlement', () => {
    it('should return allowed true when feature is in plan', async () => {
      mockQueryOne.mockResolvedValueOnce({ plan_id: 'plan-pro', status: 'active' });
      mockLoadEntitlements.mockResolvedValueOnce(['ai.categorization', 'input.sms', 'input.api']);

      const result = await checkEntitlement('user-1', 'input.sms');
      expect(result.allowed).toBe(true);
      expect(result.featureKey).toBe('input.sms');
    });

    it('should return allowed false when feature is not in plan', async () => {
      mockQueryOne.mockResolvedValueOnce({ plan_id: 'plan-free', status: 'active' });
      mockLoadEntitlements.mockResolvedValueOnce(['ai.categorization']);

      const result = await checkEntitlement('user-1', 'input.sms');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('plan_not_included');
    });

    it('should default to free plan when no subscription', async () => {
      mockQueryOne.mockResolvedValueOnce(null); // No subscription
      mockQueryOne.mockResolvedValueOnce({ id: 'plan-free-id' }); // Free plan lookup
      mockLoadEntitlements.mockResolvedValueOnce(['ai.categorization']);

      const result = await checkEntitlement('user-1', 'ai.categorization');
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkStorageLimit', () => {
    it('should return allowed true when under limit', async () => {
      mockQueryOne.mockResolvedValueOnce({ storage_limit_mb: 5120 });
      mockQueryOne.mockResolvedValueOnce({ total_bytes: '104857600' }); // 100 MB

      const result = await checkStorageLimit('user-1');
      expect(result.allowed).toBe(true);
      expect(result.usedMb).toBe(100);
      expect(result.limitMb).toBe(5120);
      expect(result.remainingMb).toBe(5020);
    });

    it('should return allowed false when over limit', async () => {
      mockQueryOne.mockResolvedValueOnce({ storage_limit_mb: 500 });
      mockQueryOne.mockResolvedValueOnce({ total_bytes: '629145600' }); // 600 MB

      const result = await checkStorageLimit('user-1');
      expect(result.allowed).toBe(false);
      expect(result.remainingMb).toBe(0);
    });

    it('should default to free plan limit when no subscription', async () => {
      mockQueryOne.mockResolvedValueOnce(null); // No plan
      mockQueryOne.mockResolvedValueOnce({ total_bytes: '0' });

      const result = await checkStorageLimit('user-1');
      expect(result.limitMb).toBe(500);
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkAiQueryLimit', () => {
    it('should return allowed true when under daily limit', async () => {
      mockQueryOne.mockResolvedValueOnce({ ai_queries_per_day: 100 });
      mockQueryOne.mockResolvedValueOnce({ count: '50' });

      const result = await checkAiQueryLimit('user-1');
      expect(result.allowed).toBe(true);
      expect(result.usedToday).toBe(50);
      expect(result.remaining).toBe(50);
    });

    it('should return allowed false when at limit', async () => {
      mockQueryOne.mockResolvedValueOnce({ ai_queries_per_day: 10 });
      mockQueryOne.mockResolvedValueOnce({ count: '10' });

      const result = await checkAiQueryLimit('user-1');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should return unlimited for enterprise plans', async () => {
      mockQueryOne.mockResolvedValueOnce({ ai_queries_per_day: -1 });

      const result = await checkAiQueryLimit('user-1');
      expect(result.allowed).toBe(true);
      expect(result.dailyLimit).toBe(-1);
      expect(result.remaining).toBe(-1);
    });
  });

  describe('getBillingHistory', () => {
    it('should return mapped payment history entries', async () => {
      mockQueryMany.mockResolvedValueOnce([
        {
          id: 'ph-1',
          amount_cents: 1999,
          currency: 'usd',
          status: 'succeeded',
          stripe_payment_intent_id: 'pi_123',
          created_at: new Date('2024-01-15'),
        },
        {
          id: 'ph-2',
          amount_cents: 1999,
          currency: 'usd',
          status: 'failed',
          stripe_payment_intent_id: 'pi_456',
          created_at: new Date('2024-02-15'),
        },
      ]);

      const result = await getBillingHistory('user-1');
      expect(result).toHaveLength(2);
      expect(result[0].amountCents).toBe(1999);
      expect(result[0].status).toBe('succeeded');
      expect(result[1].status).toBe('failed');
    });

    it('should return empty array when no history', async () => {
      mockQueryMany.mockResolvedValueOnce([]);
      const result = await getBillingHistory('user-1');
      expect(result).toHaveLength(0);
    });
  });

  describe('updatePaymentMethod', () => {
    it('should attach payment method and set as default', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1', stripe_customer_id: 'cus_123',
        stripe_subscription_id: 'sub_stripe', status: 'active',
      });

      await updatePaymentMethod('user-1', 'pm_new_card');

      expect((mockStripe.paymentMethods.attach as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        'pm_new_card',
        { customer: 'cus_123' }
      );
      expect((mockStripe.customers.update as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        'cus_123',
        { invoice_settings: { default_payment_method: 'pm_new_card' } }
      );
    });

    it('should throw if no active subscription', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      await expect(updatePaymentMethod('user-1', 'pm_card'))
        .rejects.toThrow('No active subscription found');
    });
  });
});
