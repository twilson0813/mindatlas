import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  subscribeToPlan,
  upgradePlan,
  downgradePlan,
  checkEntitlement,
  retryFailedPayment,
  handleStripeWebhook,
  setStripeClient,
} from '../services/subscription/index.js';
import {
  requireEntitlement,
  loadEntitlements,
  invalidateCache,
} from '../middleware/entitlement.js';
import type { Request, Response, NextFunction } from 'express';

/**
 * Integration tests for the full subscription and entitlement flow.
 * Tests the service layer end-to-end with mocked Stripe and DB.
 *
 * Validates: Requirements 18.7 (immediate activation on upgrade),
 *            18.8 (grace period on downgrade),
 *            18.12 (402 for unauthorized feature access),
 *            18.14 (runtime entitlement propagation)
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../db/db.js', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  query: vi.fn(),
}));

vi.mock('../redis.js', () => ({
  redisClient: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock('../middleware/entitlement.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../middleware/entitlement.js')>();
  return {
    ...original,
    loadEntitlements: vi.fn(),
  };
});

vi.mock('../queues.js', () => ({
  stripePaymentRetryQueue: {
    add: vi.fn(),
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

vi.mock('../config.js', () => ({
  config: {
    stripeSecretKey: 'sk_test_fake',
    stripeWebhookSecret: 'whsec_test_fake',
  },
}));

vi.mock('../services/credentials/index.js', () => ({
  getStripeCredentials: vi.fn().mockResolvedValue({
    secretKey: 'sk_test_fake',
    webhookSecret: 'whsec_test_fake',
  }),
}));

import { queryOne, queryMany } from '../db/db.js';
import { redisClient } from '../redis.js';
import { stripePaymentRetryQueue } from '../queues.js';

const mockQueryOne = vi.mocked(queryOne);
const mockQueryMany = vi.mocked(queryMany);
const mockLoadEntitlements = vi.mocked(loadEntitlements);
const mockRedisGet = vi.mocked(redisClient.get);
const mockRedisSet = vi.mocked(redisClient.set);
const mockRedisDel = vi.mocked(redisClient.del);
const mockRetryQueueAdd = vi.mocked(stripePaymentRetryQueue.add);

// ─── Stripe Mock ─────────────────────────────────────────────────────────────

function createMockStripe() {
  return {
    customers: {
      create: vi.fn().mockResolvedValue({ id: 'cus_integration_test' }),
      update: vi.fn().mockResolvedValue({}),
    },
    subscriptions: {
      create: vi.fn().mockResolvedValue({
        id: 'sub_integration_test',
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        items: { data: [{ id: 'si_item1' }] },
      }),
      retrieve: vi.fn().mockResolvedValue({
        id: 'sub_integration_test',
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
  } as unknown as import('stripe').default;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockRequest(user?: { sub: string }): Partial<Request> {
  return {
    user: user
      ? { sub: user.sub, email: 'test@example.com', role: 'user', iat: 0, exp: 0 }
      : undefined,
  };
}

function createMockResponse(): Partial<Response> & { statusCode?: number; body?: unknown } {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = vi.fn().mockImplementation((data: unknown) => {
    res.body = data;
    return res as Response;
  });
  return res;
}

// Plan definitions used across tests
const PLANS = {
  free: {
    id: 'plan-free',
    name: 'free',
    display_name: 'Free',
    stripe_price_id: null,
    price_monthly_cents: 0,
    storage_limit_mb: 500,
    ai_queries_per_day: 10,
    is_active: true,
  },
  pro: {
    id: 'plan-pro',
    name: 'pro',
    display_name: 'Pro',
    stripe_price_id: 'price_pro_monthly',
    price_monthly_cents: 1999,
    storage_limit_mb: 5120,
    ai_queries_per_day: 100,
    is_active: true,
  },
  enterprise: {
    id: 'plan-enterprise',
    name: 'enterprise',
    display_name: 'Enterprise',
    stripe_price_id: 'price_enterprise_monthly',
    price_monthly_cents: 9999,
    storage_limit_mb: 51200,
    ai_queries_per_day: -1,
    is_active: true,
  },
};

// Feature entitlements per plan
const ENTITLEMENTS = {
  free: ['input.api', 'ai.categorization'],
  pro: [
    'input.api',
    'input.sms',
    'input.csv',
    'ai.categorization',
    'ai.relationship_mapping',
    'ai.natural_language',
    'integration.notion',
    'export.csv',
  ],
  enterprise: [
    'input.api',
    'input.sms',
    'input.csv',
    'ai.categorization',
    'ai.relationship_mapping',
    'ai.natural_language',
    'ai.cluster_summaries',
    'ai.suggestions',
    'ai.priority_processing',
    'integration.notion',
    'integration.n8n',
    'export.csv',
    'advanced.custom_categories',
  ],
};

// ─── Integration Tests ───────────────────────────────────────────────────────

describe('Subscription & Entitlement Flow - Integration', () => {
  let mockStripe: ReturnType<typeof createMockStripe>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStripe = createMockStripe();
    setStripeClient(mockStripe as unknown as import('stripe').default);
  });

  describe('Flow 1: Free user → checkEntitlement for input.sms → denied (402)', () => {
    it('should deny SMS access for a user on the free plan', async () => {
      // User has no subscription → defaults to free plan
      mockQueryOne.mockResolvedValueOnce(null);
      // Free plan ID lookup
      mockQueryOne.mockResolvedValueOnce({ id: 'plan-free' });
      // Free plan entitlements don't include input.sms
      mockLoadEntitlements.mockResolvedValueOnce(ENTITLEMENTS.free);

      const result = await checkEntitlement('user-free-1', 'input.sms');

      expect(result.allowed).toBe(false);
      expect(result.featureKey).toBe('input.sms');
      expect(result.reason).toBe('plan_not_included');
    });
  });

  describe('Flow 2: User subscribes to Pro → checkEntitlement for input.sms → allowed', () => {
    it('should allow SMS access after subscribing to Pro plan', async () => {
      const userId = 'user-upgrade-1';

      // Step 1: Subscribe to Pro
      // Plan lookup
      mockQueryOne.mockResolvedValueOnce(PLANS.pro);
      // No existing subscription
      mockQueryOne.mockResolvedValueOnce(null);
      // User email lookup
      mockQueryOne.mockResolvedValueOnce({ email: 'user@test.com' });
      // Insert subscription returns active pro subscription
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-new-1',
        user_id: userId,
        plan_id: 'plan-pro',
        status: 'active',
        stripe_subscription_id: 'sub_integration_test',
        stripe_customer_id: 'cus_integration_test',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        pending_plan_id: null,
        canceled_at: null,
      });

      const subscription = await subscribeToPlan(userId, 'plan-pro', 'pm_card_123');
      expect(subscription.planName).toBe('pro');
      expect(subscription.status).toBe('active');

      // Step 2: Check entitlement — now on Pro, SMS should be allowed
      mockQueryOne.mockResolvedValueOnce({ plan_id: 'plan-pro', status: 'active' });
      mockLoadEntitlements.mockResolvedValueOnce(ENTITLEMENTS.pro);

      const result = await checkEntitlement(userId, 'input.sms');

      expect(result.allowed).toBe(true);
      expect(result.featureKey).toBe('input.sms');
    });
  });

  describe('Flow 3: User upgrades to Enterprise → ai.priority_processing → allowed immediately', () => {
    it('should grant Enterprise features immediately after upgrade', async () => {
      const userId = 'user-enterprise-1';

      // Step 1: Upgrade from Pro to Enterprise
      // Current subscription (Pro)
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1',
        user_id: userId,
        plan_id: 'plan-pro',
        status: 'active',
        stripe_subscription_id: 'sub_integration_test',
        stripe_customer_id: 'cus_integration_test',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        pending_plan_id: null,
        canceled_at: null,
      });
      // Enterprise plan lookup
      mockQueryOne.mockResolvedValueOnce(PLANS.enterprise);
      // DB update returns upgraded subscription
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1',
        user_id: userId,
        plan_id: 'plan-enterprise',
        status: 'active',
        stripe_subscription_id: 'sub_integration_test',
        stripe_customer_id: 'cus_integration_test',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        pending_plan_id: null,
        canceled_at: null,
      });

      const upgraded = await upgradePlan(userId, 'plan-enterprise');
      expect(upgraded.planName).toBe('enterprise');
      expect(upgraded.planId).toBe('plan-enterprise');

      // Stripe was updated with proration
      expect(mockStripe.subscriptions.update as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        'sub_integration_test',
        expect.objectContaining({ proration_behavior: 'create_prorations' }),
      );

      // Step 2: Check ai.priority_processing — should be allowed immediately
      mockQueryOne.mockResolvedValueOnce({ plan_id: 'plan-enterprise', status: 'active' });
      mockLoadEntitlements.mockResolvedValueOnce(ENTITLEMENTS.enterprise);

      const result = await checkEntitlement(userId, 'ai.priority_processing');

      expect(result.allowed).toBe(true);
      expect(result.featureKey).toBe('ai.priority_processing');
    });
  });

  describe('Flow 4: User downgrades to Free → current plan features still accessible (grace period)', () => {
    it('should retain current plan features after downgrade until period end', async () => {
      const userId = 'user-downgrade-1';
      const periodEnd = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);

      // Step 1: Downgrade from Pro to Free
      // Current subscription
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1',
        user_id: userId,
        plan_id: 'plan-pro',
        status: 'active',
        stripe_subscription_id: 'sub_integration_test',
        stripe_customer_id: 'cus_integration_test',
        current_period_start: new Date(),
        current_period_end: periodEnd,
        pending_plan_id: null,
        canceled_at: null,
      });
      // Free plan lookup
      mockQueryOne.mockResolvedValueOnce(PLANS.free);
      // DB update: pending_plan_id set, but plan_id stays Pro
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1',
        user_id: userId,
        plan_id: 'plan-pro',
        status: 'active',
        stripe_subscription_id: 'sub_integration_test',
        stripe_customer_id: 'cus_integration_test',
        current_period_start: new Date(),
        current_period_end: periodEnd,
        pending_plan_id: 'plan-free',
        canceled_at: null,
      });
      // Current plan name lookup
      mockQueryOne.mockResolvedValueOnce({ name: 'pro' });

      const downgraded = await downgradePlan(userId, 'plan-free');

      // Plan is still Pro (grace period), downgrade is pending
      expect(downgraded.planName).toBe('pro');
      expect(downgraded.planId).toBe('plan-pro');
      expect(downgraded.pendingPlanId).toBe('plan-free');

      // Step 2: Check entitlement — Pro features still accessible during grace period
      mockQueryOne.mockResolvedValueOnce({ plan_id: 'plan-pro', status: 'active' });
      mockLoadEntitlements.mockResolvedValueOnce(ENTITLEMENTS.pro);

      const result = await checkEntitlement(userId, 'input.sms');

      expect(result.allowed).toBe(true);
      expect(result.featureKey).toBe('input.sms');
    });
  });

  describe('Flow 5: Simulate period end → old features no longer accessible', () => {
    it('should apply pending downgrade at period end and revoke Pro features', async () => {
      const userId = 'user-period-end-1';

      // Simulate Stripe invoice.payment_succeeded at period end
      // This triggers the pending downgrade to be applied
      const webhookEvent = {
        type: 'invoice.payment_succeeded',
        id: 'evt_period_renewal',
        data: {
          object: {
            subscription: 'sub_integration_test',
            amount_paid: 0,
            currency: 'usd',
            payment_intent: 'pi_renewal',
          },
        },
      };

      (mockStripe.webhooks.constructEvent as ReturnType<typeof vi.fn>).mockReturnValue(
        webhookEvent,
      );

      // Subscription lookup for webhook — has pending downgrade
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1',
        user_id: userId,
        plan_id: 'plan-pro',
        status: 'active',
        stripe_subscription_id: 'sub_integration_test',
        stripe_customer_id: 'cus_integration_test',
        current_period_start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        current_period_end: new Date(),
        pending_plan_id: 'plan-free',
        canceled_at: null,
      });
      // Insert payment history
      mockQueryOne.mockResolvedValueOnce(null);
      // Apply pending downgrade (UPDATE plan_id = pending_plan_id)
      mockQueryOne.mockResolvedValueOnce(null);

      await handleStripeWebhook(Buffer.from('body'), 'sig_valid');

      // Verify the downgrade was applied
      const updateCall = mockQueryOne.mock.calls[2];
      expect(updateCall[0]).toContain('plan_id = pending_plan_id');
      expect(updateCall[0]).toContain('pending_plan_id = NULL');

      // Step 2: After period end, check entitlement — now on Free plan
      mockQueryOne.mockResolvedValueOnce({ plan_id: 'plan-free', status: 'active' });
      mockLoadEntitlements.mockResolvedValueOnce(ENTITLEMENTS.free);

      const result = await checkEntitlement(userId, 'input.sms');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('plan_not_included');
    });
  });

  describe('Flow 6: Admin toggles feature off → user immediately gets 402', () => {
    it('should deny access immediately after admin removes feature from plan', async () => {
      const userId = 'user-admin-toggle-1';

      // Step 1: User on Pro has SMS access
      mockQueryOne.mockResolvedValueOnce({ plan_id: 'plan-pro', status: 'active' });
      mockLoadEntitlements.mockResolvedValueOnce(ENTITLEMENTS.pro);

      const beforeResult = await checkEntitlement(userId, 'input.sms');
      expect(beforeResult.allowed).toBe(true);

      // Step 2: Admin removes input.sms from Pro plan (via invalidateCache + updated DB)
      // The entitlement middleware re-reads from cache/DB on each request
      const proWithoutSms = ENTITLEMENTS.pro.filter((f) => f !== 'input.sms');

      mockQueryOne.mockResolvedValueOnce({ plan_id: 'plan-pro', status: 'active' });
      mockLoadEntitlements.mockResolvedValueOnce(proWithoutSms);

      const afterResult = await checkEntitlement(userId, 'input.sms');

      expect(afterResult.allowed).toBe(false);
      expect(afterResult.reason).toBe('plan_not_included');
    });
  });

  describe('Flow 7: Payment fails → 3 retries → revert to Free', () => {
    it('should cancel subscription after max payment retries exhausted', async () => {
      const subscriptionId = 'sub-retry-1';

      // Simulate 3 failed payment retries
      // Retry 1: fails
      mockQueryOne.mockResolvedValueOnce({
        id: subscriptionId,
        user_id: 'user-retry-1',
        stripe_subscription_id: 'sub_stripe_retry',
      });
      (mockStripe.invoices.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: [{ id: 'inv_open_1' }],
      });
      (mockStripe.invoices.pay as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Card declined'),
      );
      // Retry count lookup
      mockQueryOne.mockResolvedValueOnce({ retry_count: 0 });
      // Update retry count
      mockQueryOne.mockResolvedValueOnce(null);

      await retryFailedPayment(subscriptionId);

      // Retry 2: fails
      mockQueryOne.mockResolvedValueOnce({
        id: subscriptionId,
        user_id: 'user-retry-1',
        stripe_subscription_id: 'sub_stripe_retry',
      });
      (mockStripe.invoices.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: [{ id: 'inv_open_2' }],
      });
      (mockStripe.invoices.pay as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Card declined'),
      );
      mockQueryOne.mockResolvedValueOnce({ retry_count: 1 });
      mockQueryOne.mockResolvedValueOnce(null);

      await retryFailedPayment(subscriptionId);

      // Retry 3: fails — this should cancel the subscription
      mockQueryOne.mockResolvedValueOnce({
        id: subscriptionId,
        user_id: 'user-retry-1',
        stripe_subscription_id: 'sub_stripe_retry',
      });
      (mockStripe.invoices.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: [{ id: 'inv_open_3' }],
      });
      (mockStripe.invoices.pay as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Card declined'),
      );
      // Retry count is now 2, so next increment makes 3 → exhausted
      mockQueryOne.mockResolvedValueOnce({ retry_count: 2 });
      // Update retry count
      mockQueryOne.mockResolvedValueOnce(null);
      // Cancel subscription
      mockQueryOne.mockResolvedValueOnce(null);

      await retryFailedPayment(subscriptionId);

      // Verify the subscription was cancelled after 3 failed retries
      const lastCalls = mockQueryOne.mock.calls;
      const cancelCall = lastCalls[lastCalls.length - 1];
      expect(cancelCall[0]).toContain("status = 'cancelled'");

      // Step 4: User now has no active subscription → defaults to Free entitlements
      mockQueryOne.mockResolvedValueOnce(null); // No active subscription
      mockQueryOne.mockResolvedValueOnce({ id: 'plan-free' }); // Free plan lookup
      mockLoadEntitlements.mockResolvedValueOnce(ENTITLEMENTS.free);

      const result = await checkEntitlement('user-retry-1', 'input.sms');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('plan_not_included');
    });
  });

  describe('Flow 8: Entitlement middleware integration with subscription service', () => {
    it('should use requireEntitlement middleware to produce 402 for free user trying SMS', async () => {
      // This test uses the actual requireEntitlement middleware to verify
      // the integration between middleware and subscription lookup
      const { requireEntitlement: actualRequireEntitlement } = await vi.importActual<
        typeof import('../middleware/entitlement.js')
      >('../middleware/entitlement.js');

      const middleware = actualRequireEntitlement('input.sms');
      const req = createMockRequest({ sub: 'user-middleware-1' }) as Request;
      const res = createMockResponse() as Response;
      const next: NextFunction = vi.fn();

      // No subscription found → defaults to 'free' plan
      mockQueryOne.mockResolvedValueOnce(null);
      // Redis cache for 'free' plan entitlements
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(ENTITLEMENTS.free));

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Feature not available in your plan',
        feature: 'input.sms',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow access through middleware for Pro user accessing SMS', async () => {
      const { requireEntitlement: actualRequireEntitlement } = await vi.importActual<
        typeof import('../middleware/entitlement.js')
      >('../middleware/entitlement.js');

      const middleware = actualRequireEntitlement('input.sms');
      const req = createMockRequest({ sub: 'user-middleware-2' }) as Request;
      const res = createMockResponse() as Response;
      const next: NextFunction = vi.fn();

      // Active pro subscription
      mockQueryOne.mockResolvedValueOnce({ plan_id: 'plan-pro' });
      // Redis cache for 'pro' plan entitlements
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(ENTITLEMENTS.pro));

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
