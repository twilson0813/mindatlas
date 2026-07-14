import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  downgradePlan,
  cancelSubscription,
  checkEntitlement,
  setStripeClient,
} from './index.js';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

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

import { queryOne } from '../../db/db.js';
import { loadEntitlements } from '../../middleware/entitlement.js';

const mockQueryOne = vi.mocked(queryOne);
const mockLoadEntitlements = vi.mocked(loadEntitlements);

// ─── Generators ──────────────────────────────────────────────────────────────

const planNames = ['free', 'pro', 'enterprise'] as const;
type PlanName = (typeof planNames)[number];

/** Generates a pair of distinct plan names where current > target (valid downgrade) */
const downgradePairArb = fc
  .tuple(
    fc.constantFrom<PlanName>('pro', 'enterprise'),
    fc.constantFrom<PlanName>('free', 'pro'),
  )
  .filter(([current, target]) => current !== target);

const userIdArb = fc.uuid();

/** Days into current billing period (1-30) */
const daysIntoPeriodArb = fc.integer({ min: 1, max: 30 });

const featureKeysArb = fc.constantFrom(
  'input.sms',
  'input.api',
  'input.csv',
  'ai.categorization',
  'ai.relationship_mapping',
  'ai.natural_language',
  'ai.cluster_summaries',
  'integration.notion',
  'integration.n8n',
  'export.csv',
);

// ─── Mock Stripe Client ──────────────────────────────────────────────────────

function createMockStripe() {
  return {
    customers: { create: vi.fn(), update: vi.fn() },
    subscriptions: {
      create: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    invoices: { list: vi.fn(), pay: vi.fn() },
    paymentMethods: { attach: vi.fn() },
    webhooks: { constructEvent: vi.fn() },
  } as unknown as import('stripe').default;
}

// ─── Property Tests ──────────────────────────────────────────────────────────

/**
 * Property 32: Plan Downgrade Grace Period
 * Verify current plan features retained until billing period end after downgrade/cancel.
 *
 * **Validates: Requirements 18.8**
 */
describe('Property 32: Plan Downgrade Grace Period', () => {
  let mockStripe: ReturnType<typeof createMockStripe>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStripe = createMockStripe();
    setStripeClient(mockStripe);
  });

  it('downgradePlan keeps current plan_id unchanged and sets pending_plan_id to new plan', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        downgradePairArb,
        daysIntoPeriodArb,
        async (userId, [currentPlanName, targetPlanName], daysInto) => {
          // Reset mocks for each run
          mockQueryOne.mockReset();

          const currentPlanId = `plan-${currentPlanName}`;
          const targetPlanId = `plan-${targetPlanName}`;
          const periodStart = new Date();
          periodStart.setDate(periodStart.getDate() - daysInto);
          const periodEnd = new Date(periodStart);
          periodEnd.setDate(periodEnd.getDate() + 30);

          // Mock: current active subscription lookup
          mockQueryOne.mockResolvedValueOnce({
            id: `sub-${userId.slice(0, 8)}`,
            user_id: userId,
            plan_id: currentPlanId,
            status: 'active',
            stripe_subscription_id: 'sub_stripe_abc',
            stripe_customer_id: 'cus_stripe_abc',
            current_period_start: periodStart,
            current_period_end: periodEnd,
            pending_plan_id: null,
            canceled_at: null,
          });

          // Mock: target plan lookup
          mockQueryOne.mockResolvedValueOnce({
            id: targetPlanId,
            name: targetPlanName,
            display_name: targetPlanName.charAt(0).toUpperCase() + targetPlanName.slice(1),
            stripe_price_id: `price_${targetPlanName}`,
            price_monthly_cents: targetPlanName === 'free' ? 0 : 999,
            storage_limit_mb: targetPlanName === 'free' ? 500 : 5120,
            ai_queries_per_day: targetPlanName === 'free' ? 10 : 100,
            is_active: true,
          });

          // Mock: UPDATE returns row with pending_plan_id set, plan_id unchanged
          mockQueryOne.mockResolvedValueOnce({
            id: `sub-${userId.slice(0, 8)}`,
            user_id: userId,
            plan_id: currentPlanId,
            status: 'active',
            stripe_subscription_id: 'sub_stripe_abc',
            stripe_customer_id: 'cus_stripe_abc',
            current_period_start: periodStart,
            current_period_end: periodEnd,
            pending_plan_id: targetPlanId,
            canceled_at: null,
          });

          // Mock: current plan name lookup
          mockQueryOne.mockResolvedValueOnce({ name: currentPlanName });

          const result = await downgradePlan(userId, targetPlanId);

          // plan_id unchanged — user stays on current plan
          expect(result.planId).toBe(currentPlanId);
          expect(result.planName).toBe(currentPlanName);

          // pending_plan_id set to the downgrade target
          expect(result.pendingPlanId).toBe(targetPlanId);

          // Status remains active during grace period
          expect(result.status).toBe('active');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('cancelSubscription keeps status active and sets canceled_at without removing plan', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        fc.constantFrom<PlanName>('pro', 'enterprise'),
        daysIntoPeriodArb,
        async (userId, planName, daysInto) => {
          // Reset mocks for each run
          mockQueryOne.mockReset();
          mockStripe = createMockStripe();
          setStripeClient(mockStripe);

          const planId = `plan-${planName}`;
          const periodStart = new Date();
          periodStart.setDate(periodStart.getDate() - daysInto);
          const periodEnd = new Date(periodStart);
          periodEnd.setDate(periodEnd.getDate() + 30);

          // Mock: current active subscription lookup
          mockQueryOne.mockResolvedValueOnce({
            id: `sub-${userId.slice(0, 8)}`,
            user_id: userId,
            plan_id: planId,
            status: 'active',
            stripe_subscription_id: 'sub_stripe_xyz',
            stripe_customer_id: 'cus_stripe_xyz',
            current_period_start: periodStart,
            current_period_end: periodEnd,
            pending_plan_id: null,
            canceled_at: null,
          });

          // Mock: DB update (sets canceled_at but status stays 'active')
          mockQueryOne.mockResolvedValueOnce(null);

          await cancelSubscription(userId);

          // Stripe should be told to cancel at period end (not immediately)
          const stripeUpdate = (mockStripe.subscriptions as { update: ReturnType<typeof vi.fn> }).update;
          expect(stripeUpdate).toHaveBeenCalledWith(
            'sub_stripe_xyz',
            { cancel_at_period_end: true },
          );

          // DB update should set canceled_at but NOT change status to 'canceled'
          const updateCall = mockQueryOne.mock.calls[1];
          const updateQuery = updateCall[0] as string;
          expect(updateQuery).toContain('canceled_at');
          expect(updateQuery).not.toContain("status = 'canceled'");
        },
      ),
      { numRuns: 100 },
    );
  });

  it('checkEntitlement uses current plan_id (not pending) after downgrade, so features remain accessible', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        featureKeysArb,
        downgradePairArb,
        async (userId, featureKey, [currentPlanName, _targetPlanName]) => {
          // Reset mocks for each run
          mockQueryOne.mockReset();
          mockLoadEntitlements.mockReset();

          const currentPlanId = `plan-${currentPlanName}`;

          // Mock: subscription query returns the CURRENT plan_id
          // Even after downgrade scheduling, status is still 'active' and plan_id is unchanged
          mockQueryOne.mockResolvedValueOnce({
            plan_id: currentPlanId,
            status: 'active',
          });

          // Mock: loadEntitlements returns features for the current plan (includes the feature)
          mockLoadEntitlements.mockResolvedValueOnce([featureKey, 'ai.categorization', 'export.csv']);

          const result = await checkEntitlement(userId, featureKey);

          // Feature is still allowed because entitlements are checked against current plan_id
          expect(result.allowed).toBe(true);
          expect(result.featureKey).toBe(featureKey);

          // Verify entitlements were loaded for the CURRENT plan, not the pending one
          expect(mockLoadEntitlements).toHaveBeenCalledWith(currentPlanId);
        },
      ),
      { numRuns: 100 },
    );
  });
});
