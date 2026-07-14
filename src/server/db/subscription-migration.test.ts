import { describe, it, expect, vi, beforeEach } from 'vitest';
import { up, down, shorthands } from '../../../migrations/006_create-subscription-tables.js';

// Mock MigrationBuilder
function createMockPgm() {
  const tables: string[] = [];
  const droppedTables: string[] = [];
  const indexes: Array<{ table: string; columns: string | string[] }> = [];
  const constraints: Array<{ table: string; name: string; expression: unknown }> = [];
  const sqlStatements: string[] = [];
  const tableDefinitions: Record<string, Record<string, unknown>> = {};

  const pgm = {
    createTable: vi.fn((tableName: string, columns: Record<string, unknown>) => {
      tables.push(tableName);
      tableDefinitions[tableName] = columns;
    }),
    dropTable: vi.fn((tableName: string) => {
      droppedTables.push(tableName);
    }),
    createIndex: vi.fn((table: string, columns: string | string[]) => {
      indexes.push({ table, columns });
    }),
    addConstraint: vi.fn((table: string, name: string, expression: unknown) => {
      constraints.push({ table, name, expression });
    }),
    sql: vi.fn((statement: string) => {
      sqlStatements.push(statement);
    }),
    func: vi.fn((expression: string) => `PG_FUNC(${expression})`),
    createExtension: vi.fn(),
    // Expose tracked data for assertions
    _tables: tables,
    _droppedTables: droppedTables,
    _indexes: indexes,
    _constraints: constraints,
    _sqlStatements: sqlStatements,
    _tableDefinitions: tableDefinitions,
  };

  return pgm;
}

describe('006_create-subscription-tables migration', () => {
  let pgm: ReturnType<typeof createMockPgm>;

  beforeEach(() => {
    pgm = createMockPgm();
  });

  it('should export shorthands as undefined', () => {
    expect(shorthands).toBeUndefined();
  });

  describe('up migration', () => {
    beforeEach(async () => {
      await up(pgm as never);
    });

    it('should create subscription_plans table', () => {
      expect(pgm._tables).toContain('subscription_plans');
    });

    it('should create plan_entitlements table', () => {
      expect(pgm._tables).toContain('plan_entitlements');
    });

    it('should create subscriptions table', () => {
      expect(pgm._tables).toContain('subscriptions');
    });

    it('should create payment_history table', () => {
      expect(pgm._tables).toContain('payment_history');
    });

    it('should create tables in correct order (plans before dependent tables)', () => {
      const planIndex = pgm._tables.indexOf('subscription_plans');
      const entitlementIndex = pgm._tables.indexOf('plan_entitlements');
      const subscriptionIndex = pgm._tables.indexOf('subscriptions');
      const paymentIndex = pgm._tables.indexOf('payment_history');

      expect(planIndex).toBeLessThan(entitlementIndex);
      expect(planIndex).toBeLessThan(subscriptionIndex);
      expect(subscriptionIndex).toBeLessThan(paymentIndex);
    });

    describe('subscription_plans table structure', () => {
      it('should have id as uuid primary key', () => {
        const cols = pgm._tableDefinitions['subscription_plans'];
        expect(cols.id).toMatchObject({ type: 'uuid', primaryKey: true });
      });

      it('should have name as unique not null varchar', () => {
        const cols = pgm._tableDefinitions['subscription_plans'];
        expect(cols.name).toMatchObject({ type: 'varchar(50)', notNull: true, unique: true });
      });

      it('should have display_name as not null varchar', () => {
        const cols = pgm._tableDefinitions['subscription_plans'];
        expect(cols.display_name).toMatchObject({ type: 'varchar(100)', notNull: true });
      });

      it('should have storage_limit_mb as not null integer', () => {
        const cols = pgm._tableDefinitions['subscription_plans'];
        expect(cols.storage_limit_mb).toMatchObject({ type: 'integer', notNull: true });
      });

      it('should have ai_queries_per_day as not null integer', () => {
        const cols = pgm._tableDefinitions['subscription_plans'];
        expect(cols.ai_queries_per_day).toMatchObject({ type: 'integer', notNull: true });
      });

      it('should have price_monthly_cents as not null integer with default 0', () => {
        const cols = pgm._tableDefinitions['subscription_plans'];
        expect(cols.price_monthly_cents).toMatchObject({
          type: 'integer',
          notNull: true,
          default: 0,
        });
      });

      it('should have stripe_price_id as nullable varchar', () => {
        const cols = pgm._tableDefinitions['subscription_plans'];
        expect(cols.stripe_price_id).toMatchObject({ type: 'varchar(255)' });
        expect((cols.stripe_price_id as Record<string, unknown>).notNull).toBeUndefined();
      });

      it('should have is_active as not null boolean defaulting to true', () => {
        const cols = pgm._tableDefinitions['subscription_plans'];
        expect(cols.is_active).toMatchObject({ type: 'boolean', notNull: true, default: true });
      });

      it('should have created_at and updated_at timestamps', () => {
        const cols = pgm._tableDefinitions['subscription_plans'];
        expect(cols.created_at).toMatchObject({ type: 'timestamp with time zone', notNull: true });
        expect(cols.updated_at).toMatchObject({ type: 'timestamp with time zone', notNull: true });
      });
    });

    describe('plan_entitlements table structure', () => {
      it('should have id as uuid primary key', () => {
        const cols = pgm._tableDefinitions['plan_entitlements'];
        expect(cols.id).toMatchObject({ type: 'uuid', primaryKey: true });
      });

      it('should have plan_id as not null FK to subscription_plans', () => {
        const cols = pgm._tableDefinitions['plan_entitlements'];
        expect(cols.plan_id).toMatchObject({
          type: 'uuid',
          notNull: true,
          references: 'subscription_plans(id)',
          onDelete: 'CASCADE',
        });
      });

      it('should have feature_key as not null varchar', () => {
        const cols = pgm._tableDefinitions['plan_entitlements'];
        expect(cols.feature_key).toMatchObject({ type: 'varchar(255)', notNull: true });
      });

      it('should have enabled as not null boolean defaulting to true', () => {
        const cols = pgm._tableDefinitions['plan_entitlements'];
        expect(cols.enabled).toMatchObject({ type: 'boolean', notNull: true, default: true });
      });

      it('should have unique constraint on plan_id + feature_key', () => {
        const constraint = pgm._constraints.find(
          (c) => c.name === 'plan_entitlements_plan_feature_unique'
        );
        expect(constraint).toBeDefined();
        expect(constraint!.expression).toMatchObject({ unique: ['plan_id', 'feature_key'] });
      });
    });

    describe('subscriptions table structure', () => {
      it('should have id as uuid primary key', () => {
        const cols = pgm._tableDefinitions['subscriptions'];
        expect(cols.id).toMatchObject({ type: 'uuid', primaryKey: true });
      });

      it('should have user_id as unique not null FK to users', () => {
        const cols = pgm._tableDefinitions['subscriptions'];
        expect(cols.user_id).toMatchObject({
          type: 'uuid',
          notNull: true,
          unique: true,
          references: 'users(id)',
          onDelete: 'CASCADE',
        });
      });

      it('should have plan_id as not null FK to subscription_plans', () => {
        const cols = pgm._tableDefinitions['subscriptions'];
        expect(cols.plan_id).toMatchObject({
          type: 'uuid',
          notNull: true,
          references: 'subscription_plans(id)',
          onDelete: 'RESTRICT',
        });
      });

      it('should have status with valid check constraint', () => {
        const cols = pgm._tableDefinitions['subscriptions'];
        const status = cols.status as Record<string, unknown>;
        expect(status.type).toBe('varchar(20)');
        expect(status.notNull).toBe(true);
        expect(status.check).toContain('active');
        expect(status.check).toContain('cancelled');
        expect(status.check).toContain('past_due');
        expect(status.check).toContain('trialing');
      });

      it('should have stripe_subscription_id as nullable varchar', () => {
        const cols = pgm._tableDefinitions['subscriptions'];
        expect(cols.stripe_subscription_id).toMatchObject({ type: 'varchar(255)' });
      });

      it('should have stripe_customer_id as nullable varchar', () => {
        const cols = pgm._tableDefinitions['subscriptions'];
        expect(cols.stripe_customer_id).toMatchObject({ type: 'varchar(255)' });
      });

      it('should have current_period_start and current_period_end timestamps', () => {
        const cols = pgm._tableDefinitions['subscriptions'];
        expect(cols.current_period_start).toMatchObject({ type: 'timestamp with time zone' });
        expect(cols.current_period_end).toMatchObject({ type: 'timestamp with time zone' });
      });

      it('should have pending_plan_id as nullable FK to subscription_plans', () => {
        const cols = pgm._tableDefinitions['subscriptions'];
        expect(cols.pending_plan_id).toMatchObject({
          type: 'uuid',
          references: 'subscription_plans(id)',
          onDelete: 'SET NULL',
        });
      });

      it('should have canceled_at as nullable timestamp', () => {
        const cols = pgm._tableDefinitions['subscriptions'];
        expect(cols.canceled_at).toMatchObject({ type: 'timestamp with time zone' });
      });
    });

    describe('payment_history table structure', () => {
      it('should have id as uuid primary key', () => {
        const cols = pgm._tableDefinitions['payment_history'];
        expect(cols.id).toMatchObject({ type: 'uuid', primaryKey: true });
      });

      it('should have user_id as not null FK to users', () => {
        const cols = pgm._tableDefinitions['payment_history'];
        expect(cols.user_id).toMatchObject({
          type: 'uuid',
          notNull: true,
          references: 'users(id)',
          onDelete: 'CASCADE',
        });
      });

      it('should have subscription_id as not null FK to subscriptions', () => {
        const cols = pgm._tableDefinitions['payment_history'];
        expect(cols.subscription_id).toMatchObject({
          type: 'uuid',
          notNull: true,
          references: 'subscriptions(id)',
          onDelete: 'CASCADE',
        });
      });

      it('should have amount_cents as not null integer', () => {
        const cols = pgm._tableDefinitions['payment_history'];
        expect(cols.amount_cents).toMatchObject({ type: 'integer', notNull: true });
      });

      it('should have currency as not null varchar defaulting to usd', () => {
        const cols = pgm._tableDefinitions['payment_history'];
        expect(cols.currency).toMatchObject({
          type: 'varchar(3)',
          notNull: true,
          default: "'usd'",
        });
      });

      it('should have stripe_payment_intent_id as nullable varchar', () => {
        const cols = pgm._tableDefinitions['payment_history'];
        expect(cols.stripe_payment_intent_id).toMatchObject({ type: 'varchar(255)' });
      });

      it('should have status with valid check constraint', () => {
        const cols = pgm._tableDefinitions['payment_history'];
        const status = cols.status as Record<string, unknown>;
        expect(status.type).toBe('varchar(20)');
        expect(status.notNull).toBe(true);
        expect(status.check).toContain('succeeded');
        expect(status.check).toContain('failed');
        expect(status.check).toContain('pending');
        expect(status.check).toContain('refunded');
      });

      it('should have retry_count defaulting to 0', () => {
        const cols = pgm._tableDefinitions['payment_history'];
        expect(cols.retry_count).toMatchObject({ type: 'integer', notNull: true, default: 0 });
      });

      it('should have next_retry_at as nullable timestamp', () => {
        const cols = pgm._tableDefinitions['payment_history'];
        expect(cols.next_retry_at).toMatchObject({ type: 'timestamp with time zone' });
      });
    });

    describe('indexes', () => {
      it('should create index on subscription_plans.name', () => {
        expect(pgm._indexes).toContainEqual({ table: 'subscription_plans', columns: 'name' });
      });

      it('should create index on subscription_plans.is_active', () => {
        expect(pgm._indexes).toContainEqual({
          table: 'subscription_plans',
          columns: 'is_active',
        });
      });

      it('should create index on plan_entitlements.plan_id', () => {
        expect(pgm._indexes).toContainEqual({ table: 'plan_entitlements', columns: 'plan_id' });
      });

      it('should create index on plan_entitlements.feature_key', () => {
        expect(pgm._indexes).toContainEqual({
          table: 'plan_entitlements',
          columns: 'feature_key',
        });
      });

      it('should create index on subscriptions.user_id', () => {
        expect(pgm._indexes).toContainEqual({ table: 'subscriptions', columns: 'user_id' });
      });

      it('should create index on subscriptions.plan_id', () => {
        expect(pgm._indexes).toContainEqual({ table: 'subscriptions', columns: 'plan_id' });
      });

      it('should create index on subscriptions.status', () => {
        expect(pgm._indexes).toContainEqual({ table: 'subscriptions', columns: 'status' });
      });

      it('should create index on subscriptions.stripe_subscription_id', () => {
        expect(pgm._indexes).toContainEqual({
          table: 'subscriptions',
          columns: 'stripe_subscription_id',
        });
      });

      it('should create index on payment_history.user_id', () => {
        expect(pgm._indexes).toContainEqual({ table: 'payment_history', columns: 'user_id' });
      });

      it('should create index on payment_history.subscription_id', () => {
        expect(pgm._indexes).toContainEqual({
          table: 'payment_history',
          columns: 'subscription_id',
        });
      });

      it('should create index on payment_history.stripe_payment_intent_id', () => {
        expect(pgm._indexes).toContainEqual({
          table: 'payment_history',
          columns: 'stripe_payment_intent_id',
        });
      });

      it('should create index on payment_history.status', () => {
        expect(pgm._indexes).toContainEqual({ table: 'payment_history', columns: 'status' });
      });
    });

    describe('seed data', () => {
      it('should seed three default plans: free, pro, enterprise', () => {
        const planInsert = pgm._sqlStatements.find((s) =>
          s.includes('INSERT INTO subscription_plans')
        );
        expect(planInsert).toBeDefined();
        expect(planInsert).toContain("'free'");
        expect(planInsert).toContain("'pro'");
        expect(planInsert).toContain("'enterprise'");
      });

      it('should seed Free plan with 500 MB storage and 10 AI queries/day', () => {
        const planInsert = pgm._sqlStatements.find((s) =>
          s.includes('INSERT INTO subscription_plans')
        );
        expect(planInsert).toContain("'free', 'Free', 0, 500, 10");
      });

      it('should seed Pro plan with 5120 MB storage and 100 AI queries/day', () => {
        const planInsert = pgm._sqlStatements.find((s) =>
          s.includes('INSERT INTO subscription_plans')
        );
        expect(planInsert).toContain("'pro', 'Pro', 1999, 5120, 100");
      });

      it('should seed Enterprise plan with 51200 MB storage and unlimited (-1) AI queries', () => {
        const planInsert = pgm._sqlStatements.find((s) =>
          s.includes('INSERT INTO subscription_plans')
        );
        expect(planInsert).toContain("'enterprise', 'Enterprise', 4999, 51200, -1");
      });

      it('should seed Free plan feature entitlements', () => {
        const freeEntitlements = pgm._sqlStatements.find(
          (s) => s.includes('plan_entitlements') && s.includes("sp.name = 'free'")
        );
        expect(freeEntitlements).toBeDefined();
        expect(freeEntitlements).toContain('ai.categorization');
      });

      it('should seed Pro plan feature entitlements with all input channels and AI features', () => {
        const proEntitlements = pgm._sqlStatements.find(
          (s) => s.includes('plan_entitlements') && s.includes("sp.name = 'pro'")
        );
        expect(proEntitlements).toBeDefined();
        expect(proEntitlements).toContain('ai.categorization');
        expect(proEntitlements).toContain('ai.relationship_mapping');
        expect(proEntitlements).toContain('ai.natural_language');
        expect(proEntitlements).toContain('input.sms');
        expect(proEntitlements).toContain('input.api');
        expect(proEntitlements).toContain('input.csv');
        expect(proEntitlements).toContain('integration.notion');
      });

      it('should seed Enterprise plan feature entitlements with all features', () => {
        const enterpriseEntitlements = pgm._sqlStatements.find(
          (s) => s.includes('plan_entitlements') && s.includes("sp.name = 'enterprise'")
        );
        expect(enterpriseEntitlements).toBeDefined();
        expect(enterpriseEntitlements).toContain('ai.categorization');
        expect(enterpriseEntitlements).toContain('ai.relationship_mapping');
        expect(enterpriseEntitlements).toContain('ai.natural_language');
        expect(enterpriseEntitlements).toContain('ai.cluster_summaries');
        expect(enterpriseEntitlements).toContain('ai.suggestions');
        expect(enterpriseEntitlements).toContain('ai.priority_processing');
        expect(enterpriseEntitlements).toContain('input.sms');
        expect(enterpriseEntitlements).toContain('input.api');
        expect(enterpriseEntitlements).toContain('input.csv');
        expect(enterpriseEntitlements).toContain('integration.notion');
        expect(enterpriseEntitlements).toContain('integration.n8n');
        expect(enterpriseEntitlements).toContain('export.csv');
        expect(enterpriseEntitlements).toContain('advanced.custom_categories');
      });
    });
  });

  describe('down migration', () => {
    it('should drop tables in reverse dependency order', async () => {
      await down(pgm as never);

      expect(pgm._droppedTables[0]).toBe('payment_history');
      expect(pgm._droppedTables[1]).toBe('subscriptions');
      expect(pgm._droppedTables[2]).toBe('plan_entitlements');
      expect(pgm._droppedTables[3]).toBe('subscription_plans');
    });

    it('should drop all four tables', async () => {
      await down(pgm as never);

      expect(pgm._droppedTables).toHaveLength(4);
      expect(pgm._droppedTables).toContain('payment_history');
      expect(pgm._droppedTables).toContain('subscriptions');
      expect(pgm._droppedTables).toContain('plan_entitlements');
      expect(pgm._droppedTables).toContain('subscription_plans');
    });
  });
});
