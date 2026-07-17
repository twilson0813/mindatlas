import { Router } from 'express';
import type { Request, Response } from 'express';
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import {
  getUserSubscription,
  subscribeToPlan,
  upgradePlan,
  downgradePlan,
  cancelSubscription,
  getBillingHistory,
  updatePaymentMethod,
  checkStorageLimit,
  checkAiQueryLimit,
  handleStripeWebhook,
} from '../services/subscription/index.js';

const router = Router();

/**
 * POST /api/webhooks/stripe
 *
 * Stripe webhook endpoint. Requires raw body for signature verification.
 * This route does NOT use auth middleware — Stripe verifies via signature.
 *
 * Requirements: 18.6
 */
export const stripeWebhookRouter = Router();
stripeWebhookRouter.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const signature = req.headers['stripe-signature'] as string;
      if (!signature) {
        res.status(400).json({ error: 'Missing stripe-signature header' });
        return;
      }

      await handleStripeWebhook(req.body as Buffer, signature);
      res.status(200).json({ received: true });
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message === 'Invalid webhook signature') {
        res.status(400).json({ error: 'Invalid webhook signature' });
        return;
      }
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  },
);

// Apply auth and rate limiter to all billing routes
router.use(authenticateToken);
router.use(rateLimiter);

/**
 * GET /api/billing/subscription
 *
 * Returns the current user's subscription details including plan,
 * status, billing period, and any pending changes.
 *
 * Requirements: 18.9
 */
router.get('/subscription', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const subscription = await getUserSubscription(userId);

    if (!subscription) {
      res
        .status(200)
        .json({ plan: 'free', status: 'active', message: 'No active paid subscription' });
      return;
    }

    res.json(subscription);
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * POST /api/billing/subscribe
 *
 * Subscribe to a plan. Creates a Stripe subscription and activates
 * the plan features immediately upon successful payment.
 *
 * Requirements: 18.6, 18.7
 *
 * Request body:
 * {
 *   "planId": "string (required)",
 *   "paymentMethodId": "string (required)"
 * }
 */
router.post('/subscribe', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const { planId, paymentMethodId } = req.body;

    if (!planId || !paymentMethodId) {
      res.status(400).json({ error: 'planId and paymentMethodId are required' });
      return;
    }

    const subscription = await subscribeToPlan(userId, planId, paymentMethodId);
    res.status(201).json(subscription);
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * POST /api/billing/upgrade
 *
 * Upgrade to a higher plan. Prorates billing and activates new features immediately.
 *
 * Requirements: 18.7
 *
 * Request body:
 * {
 *   "planId": "string (required)"
 * }
 */
router.post('/upgrade', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const { planId } = req.body;

    if (!planId) {
      res.status(400).json({ error: 'planId is required' });
      return;
    }

    const subscription = await upgradePlan(userId, planId);
    res.json(subscription);
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * POST /api/billing/downgrade
 *
 * Downgrade to a lower plan. The current plan remains active until
 * the end of the billing period, then switches to the new plan.
 *
 * Requirements: 18.8
 *
 * Request body:
 * {
 *   "planId": "string (required)"
 * }
 */
router.post('/downgrade', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const { planId } = req.body;

    if (!planId) {
      res.status(400).json({ error: 'planId is required' });
      return;
    }

    const subscription = await downgradePlan(userId, planId);
    res.json(subscription);
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * POST /api/billing/cancel
 *
 * Cancel the current subscription. Access is maintained until
 * the end of the current billing period.
 *
 * Requirements: 18.8
 */
router.post('/cancel', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    await cancelSubscription(userId);
    res.json({ message: 'Subscription cancelled. Access maintained until end of billing period.' });
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * GET /api/billing/history
 *
 * Returns the user's payment history ordered by most recent first.
 *
 * Requirements: 18.9
 */
router.get('/history', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const history = await getBillingHistory(userId);
    res.json(history);
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * PUT /api/billing/payment-method
 *
 * Update the user's default payment method in Stripe.
 *
 * Requirements: 18.9
 *
 * Request body:
 * {
 *   "paymentMethodId": "string (required)"
 * }
 */
router.put('/payment-method', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const { paymentMethodId } = req.body;

    if (!paymentMethodId) {
      res.status(400).json({ error: 'paymentMethodId is required' });
      return;
    }

    await updatePaymentMethod(userId, paymentMethodId);
    res.json({ message: 'Payment method updated successfully' });
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * GET /api/billing/usage
 *
 * Returns the user's current storage and AI query usage relative to plan limits.
 *
 * Requirements: 18.9
 */
router.get('/usage', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;

    const [storage, aiQueries] = await Promise.all([
      checkStorageLimit(userId),
      checkAiQueryLimit(userId),
    ]);

    res.json({
      storage: {
        usedMb: storage.usedMb,
        limitMb: storage.limitMb,
        remainingMb: storage.remainingMb,
      },
      aiQueries: {
        usedToday: aiQueries.usedToday,
        dailyLimit: aiQueries.dailyLimit,
        remaining: aiQueries.remaining,
      },
    });
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

export default router;
