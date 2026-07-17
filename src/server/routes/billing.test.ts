import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import billingRouter, { stripeWebhookRouter } from './billing.js';

// Mock the subscription service
vi.mock('../services/subscription/index.js', () => ({
  getUserSubscription: vi.fn(),
  subscribeToPlan: vi.fn(),
  upgradePlan: vi.fn(),
  downgradePlan: vi.fn(),
  cancelSubscription: vi.fn(),
  getBillingHistory: vi.fn(),
  updatePaymentMethod: vi.fn(),
  checkStorageLimit: vi.fn(),
  checkAiQueryLimit: vi.fn(),
  handleStripeWebhook: vi.fn(),
}));

// Mock the database
vi.mock('../db/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

// Mock the logger
vi.mock('../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock Redis for rate limiter
vi.mock('../redis.js', () => ({
  redis: {
    multi: () => ({
      zremrangebyscore: () => ({
        zcard: () => ({
          zadd: () => ({
            expire: () => ({
              exec: vi.fn().mockResolvedValue([
                [null, 0],
                [null, 0],
                [null, 1],
                [null, true],
              ]),
            }),
          }),
        }),
      }),
    }),
    zcard: vi.fn().mockResolvedValue(0),
  },
}));

// Mock queues
vi.mock('../queues.js', () => ({
  aiProcessingQueue: { add: vi.fn() },
  stripePaymentRetryQueue: { add: vi.fn() },
}));

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

const mockGetUserSubscription = vi.mocked(getUserSubscription);
const mockSubscribeToPlan = vi.mocked(subscribeToPlan);
const mockUpgradePlan = vi.mocked(upgradePlan);
const mockDowngradePlan = vi.mocked(downgradePlan);
const mockCancelSubscription = vi.mocked(cancelSubscription);
const mockGetBillingHistory = vi.mocked(getBillingHistory);
const mockUpdatePaymentMethod = vi.mocked(updatePaymentMethod);
const mockCheckStorageLimit = vi.mocked(checkStorageLimit);
const mockCheckAiQueryLimit = vi.mocked(checkAiQueryLimit);
const mockHandleStripeWebhook = vi.mocked(handleStripeWebhook);

const TEST_JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';
const TEST_USER_ID = 'user-123';

function generateTestToken(userId = TEST_USER_ID): string {
  return jwt.sign({ sub: userId, email: 'test@example.com', role: 'user' }, TEST_JWT_SECRET, {
    expiresIn: '15m',
  });
}

function createTestApp() {
  const app = express();
  // Stripe webhook before json parsing
  app.use('/api/webhooks', stripeWebhookRouter);
  app.use(express.json());
  app.use('/api/billing', billingRouter);
  return app;
}

describe('Billing API Routes', () => {
  let app: express.Express;
  let authToken: string;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
    authToken = generateTestToken();
  });

  describe('GET /api/billing/subscription', () => {
    it('should return current subscription details', async () => {
      const mockSubscription = {
        id: 'sub-1',
        userId: TEST_USER_ID,
        planId: 'plan-pro',
        planName: 'pro',
        status: 'active',
        stripeSubscriptionId: 'stripe_sub_123',
        stripeCustomerId: 'cus_123',
        currentPeriodStart: new Date('2024-01-01'),
        currentPeriodEnd: new Date('2024-02-01'),
        pendingPlanId: null,
        canceledAt: null,
      };
      mockGetUserSubscription.mockResolvedValue(mockSubscription);

      const response = await request(app)
        .get('/api/billing/subscription')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.planName).toBe('pro');
      expect(response.body.status).toBe('active');
      expect(mockGetUserSubscription).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it('should return free plan info when no subscription exists', async () => {
      mockGetUserSubscription.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/billing/subscription')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.plan).toBe('free');
    });

    it('should return 401 without auth token', async () => {
      const response = await request(app).get('/api/billing/subscription');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/billing/subscribe', () => {
    it('should create a subscription successfully', async () => {
      const mockSubscription = {
        id: 'sub-1',
        userId: TEST_USER_ID,
        planId: 'plan-pro',
        planName: 'pro',
        status: 'active',
        stripeSubscriptionId: 'stripe_sub_123',
        stripeCustomerId: 'cus_123',
        currentPeriodStart: new Date('2024-01-01'),
        currentPeriodEnd: new Date('2024-02-01'),
        pendingPlanId: null,
        canceledAt: null,
      };
      mockSubscribeToPlan.mockResolvedValue(mockSubscription);

      const response = await request(app)
        .post('/api/billing/subscribe')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ planId: 'plan-pro', paymentMethodId: 'pm_123' });

      expect(response.status).toBe(201);
      expect(response.body.planName).toBe('pro');
      expect(mockSubscribeToPlan).toHaveBeenCalledWith(TEST_USER_ID, 'plan-pro', 'pm_123');
    });

    it('should return 400 when planId is missing', async () => {
      const response = await request(app)
        .post('/api/billing/subscribe')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ paymentMethodId: 'pm_123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('planId and paymentMethodId are required');
    });

    it('should return 400 when paymentMethodId is missing', async () => {
      const response = await request(app)
        .post('/api/billing/subscribe')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ planId: 'plan-pro' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('planId and paymentMethodId are required');
    });

    it('should return 500 when user already has active subscription', async () => {
      mockSubscribeToPlan.mockRejectedValue(
        new Error('User already has an active subscription. Use upgradePlan or downgradePlan.'),
      );

      const response = await request(app)
        .post('/api/billing/subscribe')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ planId: 'plan-pro', paymentMethodId: 'pm_123' });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('already has an active subscription');
    });
  });

  describe('POST /api/billing/upgrade', () => {
    it('should upgrade plan successfully', async () => {
      const mockSubscription = {
        id: 'sub-1',
        userId: TEST_USER_ID,
        planId: 'plan-enterprise',
        planName: 'enterprise',
        status: 'active',
        stripeSubscriptionId: 'stripe_sub_123',
        stripeCustomerId: 'cus_123',
        currentPeriodStart: new Date('2024-01-01'),
        currentPeriodEnd: new Date('2024-02-01'),
        pendingPlanId: null,
        canceledAt: null,
      };
      mockUpgradePlan.mockResolvedValue(mockSubscription);

      const response = await request(app)
        .post('/api/billing/upgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ planId: 'plan-enterprise' });

      expect(response.status).toBe(200);
      expect(response.body.planName).toBe('enterprise');
      expect(mockUpgradePlan).toHaveBeenCalledWith(TEST_USER_ID, 'plan-enterprise');
    });

    it('should return 400 when planId is missing', async () => {
      const response = await request(app)
        .post('/api/billing/upgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('planId is required');
    });

    it('should return 500 when no active subscription exists', async () => {
      mockUpgradePlan.mockRejectedValue(new Error('No active subscription found'));

      const response = await request(app)
        .post('/api/billing/upgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ planId: 'plan-enterprise' });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('No active subscription found');
    });
  });

  describe('POST /api/billing/downgrade', () => {
    it('should schedule downgrade successfully', async () => {
      const mockSubscription = {
        id: 'sub-1',
        userId: TEST_USER_ID,
        planId: 'plan-pro',
        planName: 'pro',
        status: 'active',
        stripeSubscriptionId: 'stripe_sub_123',
        stripeCustomerId: 'cus_123',
        currentPeriodStart: new Date('2024-01-01'),
        currentPeriodEnd: new Date('2024-02-01'),
        pendingPlanId: 'plan-free',
        canceledAt: null,
      };
      mockDowngradePlan.mockResolvedValue(mockSubscription);

      const response = await request(app)
        .post('/api/billing/downgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ planId: 'plan-free' });

      expect(response.status).toBe(200);
      expect(response.body.pendingPlanId).toBe('plan-free');
      expect(mockDowngradePlan).toHaveBeenCalledWith(TEST_USER_ID, 'plan-free');
    });

    it('should return 400 when planId is missing', async () => {
      const response = await request(app)
        .post('/api/billing/downgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('planId is required');
    });
  });

  describe('POST /api/billing/cancel', () => {
    it('should cancel subscription successfully', async () => {
      mockCancelSubscription.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/billing/cancel')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('cancelled');
      expect(mockCancelSubscription).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it('should return 500 when no active subscription exists', async () => {
      mockCancelSubscription.mockRejectedValue(new Error('No active subscription found'));

      const response = await request(app)
        .post('/api/billing/cancel')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('No active subscription found');
    });
  });

  describe('GET /api/billing/history', () => {
    it('should return payment history', async () => {
      const mockHistory = [
        {
          id: 'pay-1',
          amountCents: 2900,
          currency: 'usd',
          status: 'succeeded',
          stripePaymentIntentId: 'pi_123',
          createdAt: new Date('2024-01-15'),
        },
        {
          id: 'pay-2',
          amountCents: 2900,
          currency: 'usd',
          status: 'succeeded',
          stripePaymentIntentId: 'pi_124',
          createdAt: new Date('2024-02-15'),
        },
      ];
      mockGetBillingHistory.mockResolvedValue(mockHistory);

      const response = await request(app)
        .get('/api/billing/history')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].amountCents).toBe(2900);
      expect(mockGetBillingHistory).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it('should return empty array when no history', async () => {
      mockGetBillingHistory.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/billing/history')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('PUT /api/billing/payment-method', () => {
    it('should update payment method successfully', async () => {
      mockUpdatePaymentMethod.mockResolvedValue(undefined);

      const response = await request(app)
        .put('/api/billing/payment-method')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ paymentMethodId: 'pm_new_456' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('updated');
      expect(mockUpdatePaymentMethod).toHaveBeenCalledWith(TEST_USER_ID, 'pm_new_456');
    });

    it('should return 400 when paymentMethodId is missing', async () => {
      const response = await request(app)
        .put('/api/billing/payment-method')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('paymentMethodId is required');
    });

    it('should return 500 when no subscription exists', async () => {
      mockUpdatePaymentMethod.mockRejectedValue(new Error('No active subscription found'));

      const response = await request(app)
        .put('/api/billing/payment-method')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ paymentMethodId: 'pm_new_456' });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('No active subscription found');
    });
  });

  describe('GET /api/billing/usage', () => {
    it('should return current usage data', async () => {
      mockCheckStorageLimit.mockResolvedValue({
        allowed: true,
        usedMb: 250,
        limitMb: 5000,
        remainingMb: 4750,
      });
      mockCheckAiQueryLimit.mockResolvedValue({
        allowed: true,
        usedToday: 15,
        dailyLimit: 100,
        remaining: 85,
      });

      const response = await request(app)
        .get('/api/billing/usage')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.storage.usedMb).toBe(250);
      expect(response.body.storage.limitMb).toBe(5000);
      expect(response.body.storage.remainingMb).toBe(4750);
      expect(response.body.aiQueries.usedToday).toBe(15);
      expect(response.body.aiQueries.dailyLimit).toBe(100);
      expect(response.body.aiQueries.remaining).toBe(85);
    });

    it('should show unlimited AI queries correctly', async () => {
      mockCheckStorageLimit.mockResolvedValue({
        allowed: true,
        usedMb: 1000,
        limitMb: 50000,
        remainingMb: 49000,
      });
      mockCheckAiQueryLimit.mockResolvedValue({
        allowed: true,
        usedToday: 0,
        dailyLimit: -1,
        remaining: -1,
      });

      const response = await request(app)
        .get('/api/billing/usage')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.aiQueries.dailyLimit).toBe(-1);
      expect(response.body.aiQueries.remaining).toBe(-1);
    });
  });

  describe('POST /api/webhooks/stripe', () => {
    it('should process valid webhook with signature', async () => {
      mockHandleStripeWebhook.mockResolvedValue(undefined);

      const rawBody = JSON.stringify({ type: 'invoice.payment_succeeded', data: {} });

      const response = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', 'valid_sig_123')
        .set('Content-Type', 'application/json')
        .send(rawBody);

      expect(response.status).toBe(200);
      expect(response.body.received).toBe(true);
      expect(mockHandleStripeWebhook).toHaveBeenCalled();
    });

    it('should return 400 when stripe-signature header is missing', async () => {
      const response = await request(app)
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ type: 'test' }));

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing stripe-signature header');
    });

    it('should return 400 for invalid webhook signature', async () => {
      mockHandleStripeWebhook.mockRejectedValue(new Error('Invalid webhook signature'));

      const response = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', 'invalid_sig')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ type: 'test' }));

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid webhook signature');
    });

    it('should return 500 on unexpected webhook processing error', async () => {
      mockHandleStripeWebhook.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', 'valid_sig_123')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ type: 'test' }));

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('Webhook processing failed');
    });

    it('should not require authentication (Stripe verifies via signature)', async () => {
      mockHandleStripeWebhook.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', 'valid_sig_123')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ type: 'test' }));

      // Should work without Bearer token — verifies no auth middleware
      expect(response.status).toBe(200);
    });
  });
});
