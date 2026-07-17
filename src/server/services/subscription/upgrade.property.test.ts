import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 31: Plan Upgrade Immediate Activation
 * Verify all new plan features accessible immediately after payment confirmation.
 * Generator: random plan transitions with payment confirmation.
 *
 * **Validates: Requirements 18.7**
 */

// Mock dependencies
vi.mock('../../db/db.js', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
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

vi.mock('../credentials/index.js', () => ({
  getStripeCredentials: vi.fn().mockResolvedValue({
    secretKey: 'sk_test_fake',
    webhookSecret: 'whsec_test_fake',
  }),
}));

import { queryOne } from '../../db/db.js';
import { loadEntitlements } from '../../middleware/entitlement.js';
import { upgradePlan, checkEntitlement, setStripeClient } from './index.js';

const mockQueryOne = vi.mocked(queryOne);
const mockLoadEntitlements = vi.mocked(loadEntitlements);

// ─── Plan Definitions ────────────────────────────────────────────────────────

interface PlanDefinition {
  id: string;
  name: string;
  features: string[];
}

const PLANS: Record<string, PlanDefinition> = {
  free: {
    id: 'plan-free',
    name: 'free',
    features: ['ai.categorization', 'input.web_upload'],
  },
  pro: {
    id: 'plan-pro',
    name: 'pro',
    features: [
      'ai.categorization',
      'ai.relationship_mapping',
      'ai.natural_language',
      'input.web_upload',
      'input.api',
      'input.sms',
      'input.csv',
      'integration.notion',
      'export.csv',
    ],
  },
  enterprise: {
    id: 'plan-enterprise',
    name: 'enterprise',
    features: [
      'ai.categorization',
      'ai.relationship_mapping',
      'ai.natural_language',
      'ai.cluster_summaries',
      'ai.suggestions',
      'ai.priority_processing',
      'input.web_upload',
      'input.api',
      'input.sms',
      'input.csv',
      'integration.notion',
      'integration.n8n',
      'export.csv',
      'advanced.custom_categories',
    ],
  },
};

// ─── Generators ──────────────────────────────────────────────────────────────

// Valid upgrade transitions: free→pro, free→enterprise, pro→enterprise
const planUpgradeTransitionArb = fc.constantFrom(
  { from: PLANS.free, to: PLANS.pro },
  { from: PLANS.free, to: PLANS.enterprise },
  { from: PLANS.pro, to: PLANS.enterprise },
);

const userIdArb = fc.uuid();

// ─── Mock Stripe ─────────────────────────────────────────────────────────────

function createMockStripe() {
  return {
    customers: {
      create: vi.fn().mockResolvedValue({ id: 'cus_test' }),
      update: vi.fn().mockResolvedValue({}),
    },
    subscriptions: {
      create: vi.fn().mockResolvedValue({
        id: 'sub_test',
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        items: { data: [{ id: 'si_item1' }] },
      }),
      retrieve: vi.fn().mockResolvedValue({
        id: 'sub_test',
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

// ─── Property Test ───────────────────────────────────────────────────────────

describe('Property 31: Plan Upgrade Immediate Activation', () => {
  let mockStripe: ReturnType<typeof createMockStripe>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStripe = createMockStripe();
    setStripeClient(mockStripe);
  });

  it('should make all new plan features accessible immediately after upgrade', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, planUpgradeTransitionArb, async (userId, { from, to }) => {
        // Reset mocks for each iteration
        mockQueryOne.mockReset();
        mockLoadEntitlements.mockReset();

        // ── Step 1: Setup - user has an active subscription on the "from" plan ──

        // upgradePlan: First query — find active subscription
        mockQueryOne.mockResolvedValueOnce({
          id: 'sub-1',
          user_id: userId,
          plan_id: from.id,
          status: 'active',
          stripe_subscription_id: 'sub_stripe_123',
          stripe_customer_id: 'cus_stripe_123',
          current_period_start: new Date(),
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          pending_plan_id: null,
          canceled_at: null,
        });

        // upgradePlan: Second query — find the new plan
        mockQueryOne.mockResolvedValueOnce({
          id: to.id,
          name: to.name,
          display_name: to.name.charAt(0).toUpperCase() + to.name.slice(1),
          stripe_price_id: `price_${to.name}`,
          price_monthly_cents: to.name === 'pro' ? 1999 : 4999,
          storage_limit_mb: to.name === 'pro' ? 5120 : 51200,
          ai_queries_per_day: to.name === 'pro' ? 100 : -1,
          is_active: true,
        });

        // upgradePlan: Third query — DB update returns updated subscription
        mockQueryOne.mockResolvedValueOnce({
          id: 'sub-1',
          user_id: userId,
          plan_id: to.id,
          status: 'active',
          stripe_subscription_id: 'sub_stripe_123',
          stripe_customer_id: 'cus_stripe_123',
          current_period_start: new Date(),
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          pending_plan_id: null,
          canceled_at: null,
        });

        // ── Step 2: Perform the upgrade ──

        const result = await upgradePlan(userId, to.id);

        // Verify upgrade completed — plan changed immediately
        expect(result.planId).toBe(to.id);
        expect(result.planName).toBe(to.name);
        expect(result.status).toBe('active');

        // ── Step 3: Verify all new plan features are accessible immediately ──

        // For each feature in the new plan, checkEntitlement should return allowed
        for (const feature of to.features) {
          mockQueryOne.mockReset();
          mockLoadEntitlements.mockReset();

          // checkEntitlement: query for active subscription (now on new plan)
          mockQueryOne.mockResolvedValueOnce({
            plan_id: to.id,
            status: 'active',
          });

          // loadEntitlements: returns the new plan's features
          mockLoadEntitlements.mockResolvedValueOnce(to.features);

          const entitlement = await checkEntitlement(userId, feature);

          // PROPERTY: Every feature in the new plan must be allowed immediately
          expect(entitlement.allowed).toBe(true);
          expect(entitlement.featureKey).toBe(feature);
        }

        // ── Step 4: Verify features exclusive to new plan (not in old plan) are now accessible ──

        const newFeatures = to.features.filter((f) => !from.features.includes(f));

        // At least some new features should exist for a valid upgrade
        expect(newFeatures.length).toBeGreaterThan(0);

        for (const newFeature of newFeatures) {
          mockQueryOne.mockReset();
          mockLoadEntitlements.mockReset();

          // After upgrade, subscription is on new plan
          mockQueryOne.mockResolvedValueOnce({
            plan_id: to.id,
            status: 'active',
          });

          // New plan's features include this feature
          mockLoadEntitlements.mockResolvedValueOnce(to.features);

          const entitlement = await checkEntitlement(userId, newFeature);

          // PROPERTY: Features that were NOT in the old plan are now accessible
          expect(entitlement.allowed).toBe(true);
          expect(entitlement.reason).toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });
});
