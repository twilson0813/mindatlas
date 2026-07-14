import Stripe from 'stripe';
import { queryOne, queryMany } from '../../db/db.js';
import { createChildLogger } from '../../logger.js';
import { config } from '../../config.js';
import { loadEntitlements } from '../../middleware/entitlement.js';
import { stripePaymentRetryQueue } from '../../queues.js';

const log = createChildLogger({ module: 'subscription' });

// ─── Stripe Client ───────────────────────────────────────────────────────────

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(config.stripeSecretKey, {
      apiVersion: '2025-02-24.acacia',
    });
  }
  return stripeClient;
}

/**
 * Override the Stripe client for testing purposes.
 */
export function setStripeClient(client: Stripe): void {
  stripeClient = client;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UserSubscription {
  id: string;
  userId: string;
  planId: string;
  planName: string;
  status: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  pendingPlanId: string | null;
  canceledAt: Date | null;
}

export interface EntitlementResult {
  allowed: boolean;
  featureKey: string;
  reason?: 'plan_not_included' | 'limit_exceeded' | 'subscription_expired';
  currentUsage?: number;
  limit?: number;
}

export interface StorageLimitResult {
  allowed: boolean;
  usedMb: number;
  limitMb: number;
  remainingMb: number;
}

export interface AiLimitResult {
  allowed: boolean;
  usedToday: number;
  dailyLimit: number;
  remaining: number;
}

export interface PaymentHistoryEntry {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  stripePaymentIntentId: string | null;
  createdAt: Date;
}

// ─── DB Row Types ────────────────────────────────────────────────────────────

interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
  pending_plan_id: string | null;
  canceled_at: Date | null;
}

interface PlanRow {
  id: string;
  name: string;
  display_name: string;
  stripe_price_id: string | null;
  price_monthly_cents: number;
  storage_limit_mb: number;
  ai_queries_per_day: number;
  is_active: boolean;
}

interface PaymentHistoryRow {
  id: string;
  amount_cents: number;
  currency: string;
  status: string;
  stripe_payment_intent_id: string | null;
  created_at: Date;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapSubscriptionRow(row: SubscriptionRow, planName: string): UserSubscription {
  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    planName,
    status: row.status,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCustomerId: row.stripe_customer_id,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    pendingPlanId: row.pending_plan_id,
    canceledAt: row.canceled_at,
  };
}

// ─── Service Methods ─────────────────────────────────────────────────────────

/**
 * Returns the user's current subscription with plan details.
 */
export async function getUserSubscription(userId: string): Promise<UserSubscription | null> {
  const row = await queryOne<SubscriptionRow & { plan_name: string }>(
    `SELECT s.*, sp.name as plan_name
     FROM subscriptions s
     JOIN subscription_plans sp ON sp.id = s.plan_id
     WHERE s.user_id = $1
     ORDER BY s.created_at DESC LIMIT 1`,
    [userId]
  );

  if (!row) return null;
  return mapSubscriptionRow(row, row.plan_name);
}

/**
 * Creates a Stripe subscription and activates the plan immediately.
 * Requirements: 18.6, 18.7
 */
export async function subscribeToPlan(
  userId: string,
  planId: string,
  paymentMethodId: string
): Promise<UserSubscription> {
  const stripe = getStripeClient();

  // Look up the plan
  const plan = await queryOne<PlanRow>(
    `SELECT * FROM subscription_plans WHERE id = $1 AND is_active = true`,
    [planId]
  );
  if (!plan) {
    throw new Error('Plan not found or is inactive');
  }

  // Check for existing subscription
  const existing = await queryOne<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE user_id = $1 AND status IN ('active', 'trialing')`,
    [userId]
  );
  if (existing) {
    throw new Error('User already has an active subscription. Use upgradePlan or downgradePlan.');
  }

  // Create or retrieve Stripe customer
  let stripeCustomerId: string;
  const userRow = await queryOne<{ email: string }>(
    `SELECT email FROM "user" WHERE id = $1`,
    [userId]
  );
  if (!userRow) throw new Error('User not found');

  const customer = await stripe.customers.create({
    email: userRow.email,
    payment_method: paymentMethodId,
    invoice_settings: { default_payment_method: paymentMethodId },
    metadata: { userId },
  });
  stripeCustomerId = customer.id;

  // Create Stripe subscription
  const stripeSubscription = await stripe.subscriptions.create({
    customer: stripeCustomerId,
    items: [{ price: plan.stripe_price_id! }],
    default_payment_method: paymentMethodId,
    metadata: { userId, planId },
  });

  // Activate immediately in our database
  const row = await queryOne<SubscriptionRow>(
    `INSERT INTO subscriptions (user_id, plan_id, status, stripe_subscription_id, stripe_customer_id, current_period_start, current_period_end)
     VALUES ($1, $2, 'active', $3, $4, $5, $6)
     RETURNING *`,
    [
      userId,
      planId,
      stripeSubscription.id,
      stripeCustomerId,
      new Date((stripeSubscription as unknown as { current_period_start: number }).current_period_start * 1000),
      new Date((stripeSubscription as unknown as { current_period_end: number }).current_period_end * 1000),
    ]
  );

  log.info({ userId, planId, stripeSubscriptionId: stripeSubscription.id }, 'Subscription created');
  return mapSubscriptionRow(row!, plan.name);
}

/**
 * Upgrades plan, prorates billing, and activates new features immediately.
 * Requirements: 18.7
 */
export async function upgradePlan(
  userId: string,
  newPlanId: string
): Promise<UserSubscription> {
  const stripe = getStripeClient();

  const subscription = await queryOne<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'active'`,
    [userId]
  );
  if (!subscription) {
    throw new Error('No active subscription found');
  }

  const newPlan = await queryOne<PlanRow>(
    `SELECT * FROM subscription_plans WHERE id = $1 AND is_active = true`,
    [newPlanId]
  );
  if (!newPlan) {
    throw new Error('Target plan not found or is inactive');
  }

  // Update Stripe subscription with proration
  if (subscription.stripe_subscription_id) {
    const stripeSubscription = await stripe.subscriptions.retrieve(
      subscription.stripe_subscription_id
    );
    const subscriptionItems = (stripeSubscription as unknown as { items: { data: Array<{ id: string }> } }).items;

    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      items: [
        {
          id: subscriptionItems.data[0].id,
          price: newPlan.stripe_price_id!,
        },
      ],
      proration_behavior: 'create_prorations',
      metadata: { userId, planId: newPlanId },
    });
  }

  // Activate new plan immediately in our database
  const row = await queryOne<SubscriptionRow>(
    `UPDATE subscriptions
     SET plan_id = $1, pending_plan_id = NULL, updated_at = NOW()
     WHERE user_id = $2 AND status = 'active'
     RETURNING *`,
    [newPlanId, userId]
  );

  log.info({ userId, oldPlanId: subscription.plan_id, newPlanId }, 'Plan upgraded');
  return mapSubscriptionRow(row!, newPlan.name);
}

/**
 * Schedules a downgrade at the end of the current billing period.
 * Requirements: 18.8
 */
export async function downgradePlan(
  userId: string,
  newPlanId: string
): Promise<UserSubscription> {
  const subscription = await queryOne<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'active'`,
    [userId]
  );
  if (!subscription) {
    throw new Error('No active subscription found');
  }

  const newPlan = await queryOne<PlanRow>(
    `SELECT * FROM subscription_plans WHERE id = $1 AND is_active = true`,
    [newPlanId]
  );
  if (!newPlan) {
    throw new Error('Target plan not found or is inactive');
  }

  // Schedule downgrade at period end — don't change plan now
  const row = await queryOne<SubscriptionRow>(
    `UPDATE subscriptions
     SET pending_plan_id = $1, updated_at = NOW()
     WHERE user_id = $2 AND status = 'active'
     RETURNING *`,
    [newPlanId, userId]
  );

  // Get current plan name for the response
  const currentPlan = await queryOne<PlanRow>(
    `SELECT * FROM subscription_plans WHERE id = $1`,
    [subscription.plan_id]
  );

  log.info({ userId, currentPlanId: subscription.plan_id, pendingPlanId: newPlanId }, 'Downgrade scheduled');
  return mapSubscriptionRow(row!, currentPlan?.name ?? 'unknown');
}

/**
 * Cancels subscription but maintains access until billing period end.
 * Requirements: 18.8
 */
export async function cancelSubscription(userId: string): Promise<void> {
  const stripe = getStripeClient();

  const subscription = await queryOne<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'active'`,
    [userId]
  );
  if (!subscription) {
    throw new Error('No active subscription found');
  }

  // Cancel at period end in Stripe
  if (subscription.stripe_subscription_id) {
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
  }

  // Mark as cancelled in our DB — status stays 'active' until period end
  await queryOne(
    `UPDATE subscriptions
     SET canceled_at = NOW(), updated_at = NOW()
     WHERE user_id = $1 AND status = 'active'`,
    [userId]
  );

  log.info({ userId, subscriptionId: subscription.id }, 'Subscription cancelled (period end)');
}

/**
 * Processes Stripe webhook events with signature verification.
 * Requirements: 18.6, 18.7, 18.8, 18.11
 */
export async function handleStripeWebhook(
  rawBody: Buffer,
  signature: string
): Promise<void> {
  const stripe = getStripeClient();

  // Verify webhook signature
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      config.stripeWebhookSecret
    );
  } catch (err) {
    log.error({ err }, 'Stripe webhook signature verification failed');
    throw new Error('Invalid webhook signature');
  }

  log.info({ eventType: event.type, eventId: event.id }, 'Processing Stripe webhook');

  switch (event.type) {
    case 'invoice.payment_succeeded':
      await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
      break;

    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object as Stripe.Invoice);
      break;

    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;

    default:
      log.debug({ eventType: event.type }, 'Unhandled Stripe webhook event');
  }
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  const stripeSubscriptionId = invoice.subscription as string | null;
  if (!stripeSubscriptionId) return;

  const subscription = await queryOne<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE stripe_subscription_id = $1`,
    [stripeSubscriptionId]
  );
  if (!subscription) return;

  // Record payment
  await queryOne(
    `INSERT INTO payment_history (user_id, subscription_id, amount_cents, currency, stripe_payment_intent_id, status)
     VALUES ($1, $2, $3, $4, $5, 'succeeded')`,
    [
      subscription.user_id,
      subscription.id,
      invoice.amount_paid,
      invoice.currency,
      invoice.payment_intent as string | null,
    ]
  );

  // If there's a pending downgrade and we've reached period end, apply it
  if (subscription.pending_plan_id) {
    await queryOne(
      `UPDATE subscriptions
       SET plan_id = pending_plan_id, pending_plan_id = NULL, updated_at = NOW()
       WHERE id = $1`,
      [subscription.id]
    );
    log.info({ subscriptionId: subscription.id }, 'Pending downgrade applied at period renewal');
  }

  log.info({ subscriptionId: subscription.id, amount: invoice.amount_paid }, 'Payment succeeded');
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const stripeSubscriptionId = invoice.subscription as string | null;
  if (!stripeSubscriptionId) return;

  const subscription = await queryOne<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE stripe_subscription_id = $1`,
    [stripeSubscriptionId]
  );
  if (!subscription) return;

  // Record failed payment
  await queryOne(
    `INSERT INTO payment_history (user_id, subscription_id, amount_cents, currency, stripe_payment_intent_id, status)
     VALUES ($1, $2, $3, $4, $5, 'failed')`,
    [
      subscription.user_id,
      subscription.id,
      invoice.amount_due,
      invoice.currency,
      invoice.payment_intent as string | null,
    ]
  );

  // Update subscription status to past_due
  await queryOne(
    `UPDATE subscriptions SET status = 'past_due', updated_at = NOW() WHERE id = $1`,
    [subscription.id]
  );

  // Enqueue retry job (3 retries over 7 days)
  await stripePaymentRetryQueue.add(
    'retry-payment',
    {
      subscriptionId: subscription.id,
      stripeSubscriptionId,
      userId: subscription.user_id,
      attempt: 1,
    },
    {
      delay: 2 * 24 * 60 * 60 * 1000, // First retry in ~2 days
    }
  );

  log.warn({ subscriptionId: subscription.id, userId: subscription.user_id }, 'Payment failed, retry scheduled');
}

async function handleSubscriptionUpdated(stripeSubscription: Stripe.Subscription): Promise<void> {
  const subscription = await queryOne<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE stripe_subscription_id = $1`,
    [stripeSubscription.id]
  );
  if (!subscription) return;

  // Update period dates
  await queryOne(
    `UPDATE subscriptions
     SET current_period_start = $1, current_period_end = $2, updated_at = NOW()
     WHERE id = $3`,
    [
      new Date((stripeSubscription as unknown as { current_period_start: number }).current_period_start * 1000),
      new Date((stripeSubscription as unknown as { current_period_end: number }).current_period_end * 1000),
      subscription.id,
    ]
  );

  log.info({ subscriptionId: subscription.id }, 'Subscription updated from Stripe webhook');
}

async function handleSubscriptionDeleted(stripeSubscription: Stripe.Subscription): Promise<void> {
  const subscription = await queryOne<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE stripe_subscription_id = $1`,
    [stripeSubscription.id]
  );
  if (!subscription) return;

  await queryOne(
    `UPDATE subscriptions SET status = 'cancelled', canceled_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [subscription.id]
  );

  log.info({ subscriptionId: subscription.id }, 'Subscription deleted via Stripe webhook');
}

/**
 * Retries a failed payment charge. Called by BullMQ worker.
 * Up to 3 retries over 7 days.
 * Requirements: 18.11
 */
export async function retryFailedPayment(subscriptionId: string): Promise<void> {
  const stripe = getStripeClient();

  const subscription = await queryOne<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE id = $1`,
    [subscriptionId]
  );
  if (!subscription || !subscription.stripe_subscription_id) {
    log.warn({ subscriptionId }, 'Subscription not found for payment retry');
    return;
  }

  // Get latest unpaid invoice
  const invoices = await stripe.invoices.list({
    subscription: subscription.stripe_subscription_id,
    status: 'open',
    limit: 1,
  });

  if (invoices.data.length === 0) {
    log.info({ subscriptionId }, 'No open invoices to retry');
    return;
  }

  const invoice = invoices.data[0];

  try {
    await stripe.invoices.pay(invoice.id);

    // Payment succeeded — update subscription status
    await queryOne(
      `UPDATE subscriptions SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [subscriptionId]
    );

    log.info({ subscriptionId }, 'Payment retry succeeded');
  } catch (err) {
    // Get current retry count
    const latestPayment = await queryOne<{ retry_count: number }>(
      `SELECT retry_count FROM payment_history
       WHERE subscription_id = $1 AND status = 'failed'
       ORDER BY created_at DESC LIMIT 1`,
      [subscriptionId]
    );

    const retryCount = (latestPayment?.retry_count ?? 0) + 1;

    // Update retry count in payment history
    await queryOne(
      `UPDATE payment_history
       SET retry_count = $1, next_retry_at = $2
       WHERE subscription_id = $3 AND status = 'failed'
       ORDER BY created_at DESC LIMIT 1`,
      [
        retryCount,
        retryCount < 3 ? new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) : null,
        subscriptionId,
      ]
    );

    if (retryCount >= 3) {
      // Max retries exhausted — cancel subscription
      await queryOne(
        `UPDATE subscriptions SET status = 'cancelled', canceled_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [subscriptionId]
      );
      log.error({ subscriptionId, retryCount }, 'Payment retries exhausted, subscription cancelled');
    } else {
      log.warn({ subscriptionId, retryCount }, 'Payment retry failed, will retry again');
    }
  }
}

/**
 * Checks if user's plan includes the given feature.
 * Requirements: 18.12, 18.14
 */
export async function checkEntitlement(
  userId: string,
  featureKey: string
): Promise<EntitlementResult> {
  const subscription = await queryOne<{ plan_id: string; status: string }>(
    `SELECT plan_id, status FROM subscriptions WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  if (!subscription) {
    // Default to free plan entitlements
    const freePlan = await queryOne<{ id: string }>(
      `SELECT id FROM subscription_plans WHERE name = 'free'`
    );
    const planId = freePlan?.id ?? 'free';
    const features = await loadEntitlements(planId);
    return {
      allowed: features.includes(featureKey),
      featureKey,
      reason: features.includes(featureKey) ? undefined : 'plan_not_included',
    };
  }

  if (subscription.status !== 'active') {
    return {
      allowed: false,
      featureKey,
      reason: 'subscription_expired',
    };
  }

  const features = await loadEntitlements(subscription.plan_id);
  return {
    allowed: features.includes(featureKey),
    featureKey,
    reason: features.includes(featureKey) ? undefined : 'plan_not_included',
  };
}

/**
 * Checks if user has remaining storage capacity.
 * Requirements: 18.5
 */
export async function checkStorageLimit(userId: string): Promise<StorageLimitResult> {
  // Get user's plan storage limit
  const planRow = await queryOne<{ storage_limit_mb: number }>(
    `SELECT sp.storage_limit_mb
     FROM subscriptions s
     JOIN subscription_plans sp ON sp.id = s.plan_id
     WHERE s.user_id = $1 AND s.status = 'active'
     ORDER BY s.created_at DESC LIMIT 1`,
    [userId]
  );

  // Default to free plan limit if no subscription
  const limitMb = planRow?.storage_limit_mb ?? 500;

  // Calculate used storage (sum of file_size for user's items)
  const usageRow = await queryOne<{ total_bytes: string | null }>(
    `SELECT COALESCE(SUM(file_size), 0) as total_bytes
     FROM "item"
     WHERE user_id = $1 AND is_deleted = false`,
    [userId]
  );

  const usedBytes = parseInt(usageRow?.total_bytes ?? '0', 10);
  const usedMb = Math.round((usedBytes / (1024 * 1024)) * 100) / 100;
  const remainingMb = Math.max(0, limitMb - usedMb);

  return {
    allowed: usedMb < limitMb,
    usedMb,
    limitMb,
    remainingMb,
  };
}

/**
 * Checks if user has remaining AI queries for today.
 * Requirements: 18.5
 */
export async function checkAiQueryLimit(userId: string): Promise<AiLimitResult> {
  // Get user's plan AI query limit
  const planRow = await queryOne<{ ai_queries_per_day: number }>(
    `SELECT sp.ai_queries_per_day
     FROM subscriptions s
     JOIN subscription_plans sp ON sp.id = s.plan_id
     WHERE s.user_id = $1 AND s.status = 'active'
     ORDER BY s.created_at DESC LIMIT 1`,
    [userId]
  );

  // Default to free plan limit if no subscription
  const dailyLimit = planRow?.ai_queries_per_day ?? 10;

  // -1 means unlimited
  if (dailyLimit === -1) {
    return { allowed: true, usedToday: 0, dailyLimit: -1, remaining: -1 };
  }

  // Count today's AI queries (using a simple items table approach; 
  // in production this would be a dedicated ai_query_log table)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const usageRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM ai_query_log
     WHERE user_id = $1 AND created_at >= $2`,
    [userId, today]
  );

  const usedToday = parseInt(usageRow?.count ?? '0', 10);
  const remaining = Math.max(0, dailyLimit - usedToday);

  return {
    allowed: usedToday < dailyLimit,
    usedToday,
    dailyLimit,
    remaining,
  };
}

/**
 * Returns user's payment history.
 * Requirements: 18.9
 */
export async function getBillingHistory(userId: string): Promise<PaymentHistoryEntry[]> {
  const rows = await queryMany<PaymentHistoryRow>(
    `SELECT id, amount_cents, currency, status, stripe_payment_intent_id, created_at
     FROM payment_history
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  return rows.map((row) => ({
    id: row.id,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    createdAt: row.created_at,
  }));
}

/**
 * Updates user's default payment method in Stripe.
 * Requirements: 18.9
 */
export async function updatePaymentMethod(
  userId: string,
  paymentMethodId: string
): Promise<void> {
  const stripe = getStripeClient();

  const subscription = await queryOne<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE user_id = $1 AND status IN ('active', 'past_due')`,
    [userId]
  );
  if (!subscription || !subscription.stripe_customer_id) {
    throw new Error('No active subscription found');
  }

  // Attach payment method to customer
  await stripe.paymentMethods.attach(paymentMethodId, {
    customer: subscription.stripe_customer_id,
  });

  // Set as default payment method
  await stripe.customers.update(subscription.stripe_customer_id, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  log.info({ userId }, 'Payment method updated');
}
