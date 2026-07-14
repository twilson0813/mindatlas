import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createPlan,
  updatePlan,
  deactivatePlan,
  setFeatureEntitlements,
  getFeatureRegistry,
  getSubscriptionMetrics,
} from './index.js';

// Mock dependencies
vi.mock('../../db/db.js', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../../middleware/entitlement.js', () => ({
  invalidateCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../feature-registry/index.js', () => ({
  getAll: vi.fn().mockReturnValue([
    { key: 'input.sms', name: 'SMS Input', description: 'SMS channel', category: 'input_channels', registeredAt: '2024-01-01T00:00:00.000Z' },
    { key: 'input.api', name: 'API Input', description: 'API channel', category: 'input_channels', registeredAt: '2024-01-01T00:00:00.000Z' },
    { key: 'ai.categorization', name: 'AI Categorization', description: 'AI tagging', category: 'ai_capabilities', registeredAt: '2024-01-01T00:00:00.000Z' },
    { key: 'integration.notion', name: 'Notion', description: 'Notion sync', category: 'integrations', registeredAt: '2024-01-01T00:00:00.000Z' },
  ]),
  isRegistered: vi.fn((key: string) => ['input.sms', 'input.api', 'ai.categorization', 'integration.notion'].includes(key)),
}));

vi.mock('../../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { queryOne, queryMany } from '../../db/db.js';
import { invalidateCache } from '../../middleware/entitlement.js';
import * as featureRegistry from '../feature-registry/index.js';

const mockQueryOne = vi.mocked(queryOne);
const mockQueryMany = vi.mocked(queryMany);
const mockInvalidateCache = vi.mocked(invalidateCache);
const mockIsRegistered = vi.mocked(featureRegistry.isRegistered);

describe('Admin Service - Plan and Entitlement Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createPlan', () => {
    const validPlanInput = {
      name: 'premium',
      displayName: 'Premium Plan',
      stripePriceId: 'price_premium123',
      priceMonthyCents: 2999,
      storageLimitMb: 10240,
      aiQueriesPerDay: 200,
    };

    it('should create a new plan and log audit entry', async () => {
      // No existing plan with that name
      mockQueryOne.mockResolvedValueOnce(null);
      // Insert plan
      mockQueryOne.mockResolvedValueOnce({
        id: 'plan-new',
        name: 'premium',
        display_name: 'Premium Plan',
        stripe_price_id: 'price_premium123',
        price_monthly_cents: 2999,
        storage_limit_mb: 10240,
        ai_queries_per_day: 200,
        is_active: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      });
      // Audit log insert
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await createPlan('admin-1', validPlanInput);

      expect(result.id).toBe('plan-new');
      expect(result.name).toBe('premium');
      expect(result.displayName).toBe('Premium Plan');
      expect(result.priceMonthyCents).toBe(2999);
      expect(result.storageLimitMb).toBe(10240);
      expect(result.aiQueriesPerDay).toBe(200);
      expect(result.isActive).toBe(true);
    });

    it('should throw if plan name is empty', async () => {
      await expect(createPlan('admin-1', { ...validPlanInput, name: '' }))
        .rejects.toThrow('Plan name is required');
    });

    it('should throw if display name is empty', async () => {
      await expect(createPlan('admin-1', { ...validPlanInput, displayName: '' }))
        .rejects.toThrow('Plan display name is required');
    });

    it('should throw if price is negative', async () => {
      await expect(createPlan('admin-1', { ...validPlanInput, priceMonthyCents: -100 }))
        .rejects.toThrow('Price must be a non-negative number');
    });

    it('should throw if storage limit is zero or negative', async () => {
      await expect(createPlan('admin-1', { ...validPlanInput, storageLimitMb: 0 }))
        .rejects.toThrow('Storage limit must be a positive number');
    });

    it('should throw if AI queries is zero', async () => {
      await expect(createPlan('admin-1', { ...validPlanInput, aiQueriesPerDay: 0 }))
        .rejects.toThrow('AI queries per day must be a positive number or -1 for unlimited');
    });

    it('should allow -1 for unlimited AI queries', async () => {
      mockQueryOne.mockResolvedValueOnce(null); // No existing
      mockQueryOne.mockResolvedValueOnce({
        id: 'plan-new',
        name: 'unlimited',
        display_name: 'Unlimited Plan',
        stripe_price_id: null,
        price_monthly_cents: 9999,
        storage_limit_mb: 51200,
        ai_queries_per_day: -1,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
      mockQueryOne.mockResolvedValueOnce(null); // Audit log

      const result = await createPlan('admin-1', {
        ...validPlanInput,
        name: 'unlimited',
        displayName: 'Unlimited Plan',
        aiQueriesPerDay: -1,
      });

      expect(result.aiQueriesPerDay).toBe(-1);
    });

    it('should throw if plan name already exists', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'existing-plan' });

      await expect(createPlan('admin-1', validPlanInput))
        .rejects.toThrow("A plan with name 'premium' already exists");
    });
  });

  describe('updatePlan', () => {
    it('should update plan attributes and return updated plan', async () => {
      // Plan lookup
      mockQueryOne.mockResolvedValueOnce({
        id: 'plan-1',
        name: 'pro',
        display_name: 'Pro',
        stripe_price_id: 'price_pro',
        price_monthly_cents: 1999,
        storage_limit_mb: 5120,
        ai_queries_per_day: 100,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
      // Update query
      mockQueryOne.mockResolvedValueOnce({
        id: 'plan-1',
        name: 'pro',
        display_name: 'Pro Plus',
        stripe_price_id: 'price_pro',
        price_monthly_cents: 2499,
        storage_limit_mb: 10240,
        ai_queries_per_day: 100,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
      // Audit log
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await updatePlan('admin-1', 'plan-1', {
        displayName: 'Pro Plus',
        priceMonthyCents: 2499,
        storageLimitMb: 10240,
      });

      expect(result.displayName).toBe('Pro Plus');
      expect(result.priceMonthyCents).toBe(2499);
      expect(result.storageLimitMb).toBe(10240);
    });

    it('should throw if plan not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(updatePlan('admin-1', 'nonexistent', { displayName: 'New Name' }))
        .rejects.toThrow('Plan not found');
    });

    it('should throw if no changes provided', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'plan-1', name: 'pro', display_name: 'Pro',
        stripe_price_id: null, price_monthly_cents: 1999,
        storage_limit_mb: 5120, ai_queries_per_day: 100,
        is_active: true, created_at: new Date(), updated_at: new Date(),
      });

      await expect(updatePlan('admin-1', 'plan-1', {}))
        .rejects.toThrow('No changes provided');
    });

    it('should throw if display name is empty string', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'plan-1', name: 'pro', display_name: 'Pro',
        stripe_price_id: null, price_monthly_cents: 1999,
        storage_limit_mb: 5120, ai_queries_per_day: 100,
        is_active: true, created_at: new Date(), updated_at: new Date(),
      });

      await expect(updatePlan('admin-1', 'plan-1', { displayName: '  ' }))
        .rejects.toThrow('Display name cannot be empty');
    });

    it('should throw if price is negative', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'plan-1', name: 'pro', display_name: 'Pro',
        stripe_price_id: null, price_monthly_cents: 1999,
        storage_limit_mb: 5120, ai_queries_per_day: 100,
        is_active: true, created_at: new Date(), updated_at: new Date(),
      });

      await expect(updatePlan('admin-1', 'plan-1', { priceMonthyCents: -50 }))
        .rejects.toThrow('Price must be a non-negative number');
    });
  });

  describe('deactivatePlan', () => {
    it('should deactivate an active plan', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'plan-1', name: 'old-plan', display_name: 'Old Plan',
        stripe_price_id: null, price_monthly_cents: 999,
        storage_limit_mb: 1024, ai_queries_per_day: 50,
        is_active: true, created_at: new Date(), updated_at: new Date(),
      });
      // Update query
      mockQueryOne.mockResolvedValueOnce(null);
      // Audit log
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(deactivatePlan('admin-1', 'plan-1')).resolves.toBeUndefined();
    });

    it('should throw if plan not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(deactivatePlan('admin-1', 'nonexistent'))
        .rejects.toThrow('Plan not found');
    });

    it('should throw if plan already inactive', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'plan-1', name: 'old-plan', display_name: 'Old Plan',
        stripe_price_id: null, price_monthly_cents: 999,
        storage_limit_mb: 1024, ai_queries_per_day: 50,
        is_active: false, created_at: new Date(), updated_at: new Date(),
      });

      await expect(deactivatePlan('admin-1', 'plan-1'))
        .rejects.toThrow('Plan is already inactive');
    });
  });

  describe('setFeatureEntitlements', () => {
    it('should upsert feature entitlements and invalidate cache', async () => {
      // Plan exists
      mockQueryOne.mockResolvedValueOnce({ id: 'plan-1', name: 'pro' });
      // Upserts (2 features)
      mockQueryOne.mockResolvedValueOnce(null);
      mockQueryOne.mockResolvedValueOnce(null);
      // Audit log
      mockQueryOne.mockResolvedValueOnce(null);

      await setFeatureEntitlements('admin-1', 'plan-1', [
        { featureKey: 'input.sms', enabled: true },
        { featureKey: 'ai.categorization', enabled: false },
      ]);

      expect(mockInvalidateCache).toHaveBeenCalledWith('plan-1');
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO plan_entitlements'),
        ['plan-1', 'input.sms', true]
      );
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO plan_entitlements'),
        ['plan-1', 'ai.categorization', false]
      );
    });

    it('should throw if plan not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(
        setFeatureEntitlements('admin-1', 'nonexistent', [
          { featureKey: 'input.sms', enabled: true },
        ])
      ).rejects.toThrow('Plan not found');
    });

    it('should throw if features array is empty', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'plan-1', name: 'pro' });

      await expect(setFeatureEntitlements('admin-1', 'plan-1', []))
        .rejects.toThrow('At least one feature toggle is required');
    });

    it('should throw if feature key is not registered', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'plan-1', name: 'pro' });

      await expect(
        setFeatureEntitlements('admin-1', 'plan-1', [
          { featureKey: 'nonexistent.feature', enabled: true },
        ])
      ).rejects.toThrow("Feature 'nonexistent.feature' is not registered in the feature registry");
    });

    it('should throw if enabled is not a boolean', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'plan-1', name: 'pro' });

      await expect(
        setFeatureEntitlements('admin-1', 'plan-1', [
          { featureKey: 'input.sms', enabled: 'yes' as unknown as boolean },
        ])
      ).rejects.toThrow("Feature 'input.sms' must have a boolean 'enabled' field");
    });

    it('should throw if feature key is empty string', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'plan-1', name: 'pro' });

      await expect(
        setFeatureEntitlements('admin-1', 'plan-1', [
          { featureKey: '', enabled: true },
        ])
      ).rejects.toThrow('Each feature toggle must have a valid featureKey');
    });
  });

  describe('getFeatureRegistry', () => {
    it('should return all registered features', () => {
      const result = getFeatureRegistry();

      expect(result).toHaveLength(4);
      expect(result[0].key).toBe('input.sms');
      expect(result[1].key).toBe('input.api');
      expect(result[2].key).toBe('ai.categorization');
      expect(result[3].key).toBe('integration.notion');
    });
  });

  describe('getSubscriptionMetrics', () => {
    it('should return aggregated subscription metrics', async () => {
      // Tier counts
      mockQueryMany.mockResolvedValueOnce([
        { plan_name: 'free', count: '150' },
        { plan_name: 'pro', count: '45' },
        { plan_name: 'enterprise', count: '8' },
      ]);
      // MRR
      mockQueryOne.mockResolvedValueOnce({ mrr: '128942' });
      // Churn
      mockQueryOne.mockResolvedValueOnce({ cancelled_count: '5', total_active: '203' });
      // Upgrades
      mockQueryOne.mockResolvedValueOnce({ count: '12' });
      // Downgrades
      mockQueryOne.mockResolvedValueOnce({ count: '3' });

      const result = await getSubscriptionMetrics();

      expect(result.freeCount).toBe(150);
      expect(result.proCount).toBe(45);
      expect(result.enterpriseCount).toBe(8);
      expect(result.mrr).toBe(128942);
      expect(result.churnRate).toBeCloseTo(0.0246, 3);
      expect(result.upgradeCount30d).toBe(12);
      expect(result.downgradeCount30d).toBe(3);
    });

    it('should handle zero subscribers gracefully', async () => {
      mockQueryMany.mockResolvedValueOnce([]);
      mockQueryOne.mockResolvedValueOnce({ mrr: '0' });
      mockQueryOne.mockResolvedValueOnce({ cancelled_count: '0', total_active: '0' });
      mockQueryOne.mockResolvedValueOnce({ count: '0' });
      mockQueryOne.mockResolvedValueOnce({ count: '0' });

      const result = await getSubscriptionMetrics();

      expect(result.freeCount).toBe(0);
      expect(result.proCount).toBe(0);
      expect(result.enterpriseCount).toBe(0);
      expect(result.mrr).toBe(0);
      expect(result.churnRate).toBe(0);
      expect(result.upgradeCount30d).toBe(0);
      expect(result.downgradeCount30d).toBe(0);
    });

    it('should handle missing plan tiers in counts', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { plan_name: 'free', count: '50' },
      ]);
      mockQueryOne.mockResolvedValueOnce({ mrr: '0' });
      mockQueryOne.mockResolvedValueOnce({ cancelled_count: '0', total_active: '50' });
      mockQueryOne.mockResolvedValueOnce({ count: '0' });
      mockQueryOne.mockResolvedValueOnce({ count: '0' });

      const result = await getSubscriptionMetrics();

      expect(result.freeCount).toBe(50);
      expect(result.proCount).toBe(0);
      expect(result.enterpriseCount).toBe(0);
    });
  });
});
