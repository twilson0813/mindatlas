import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // SUBSCRIPTION_PLAN table
  pgm.createTable('subscription_plans', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    name: {
      type: 'varchar(50)',
      notNull: true,
      unique: true,
    },
    display_name: {
      type: 'varchar(100)',
      notNull: true,
    },
    stripe_price_id: {
      type: 'varchar(255)',
    },
    price_monthly_cents: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    storage_limit_mb: {
      type: 'integer',
      notNull: true,
    },
    ai_queries_per_day: {
      type: 'integer',
      notNull: true,
      comment: '-1 means unlimited',
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('subscription_plans', 'name');
  pgm.createIndex('subscription_plans', 'is_active');

  // PLAN_FEATURE_ENTITLEMENT table (plan_entitlements)
  pgm.createTable('plan_entitlements', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    plan_id: {
      type: 'uuid',
      notNull: true,
      references: 'subscription_plans(id)',
      onDelete: 'CASCADE',
    },
    feature_key: {
      type: 'varchar(255)',
      notNull: true,
    },
    enabled: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('plan_entitlements', 'plan_id');
  pgm.createIndex('plan_entitlements', 'feature_key');
  pgm.addConstraint('plan_entitlements', 'plan_entitlements_plan_feature_unique', {
    unique: ['plan_id', 'feature_key'],
  });

  // USER_SUBSCRIPTION table (subscriptions)
  pgm.createTable('subscriptions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      unique: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
    plan_id: {
      type: 'uuid',
      notNull: true,
      references: 'subscription_plans(id)',
      onDelete: 'RESTRICT',
    },
    status: {
      type: 'varchar(20)',
      notNull: true,
      default: "'active'",
      check: "status IN ('active', 'cancelled', 'past_due', 'trialing')",
    },
    stripe_subscription_id: {
      type: 'varchar(255)',
    },
    stripe_customer_id: {
      type: 'varchar(255)',
    },
    current_period_start: {
      type: 'timestamp with time zone',
    },
    current_period_end: {
      type: 'timestamp with time zone',
    },
    pending_plan_id: {
      type: 'uuid',
      references: 'subscription_plans(id)',
      onDelete: 'SET NULL',
    },
    canceled_at: {
      type: 'timestamp with time zone',
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('subscriptions', 'user_id');
  pgm.createIndex('subscriptions', 'plan_id');
  pgm.createIndex('subscriptions', 'status');
  pgm.createIndex('subscriptions', 'stripe_subscription_id');

  // PAYMENT_HISTORY table
  pgm.createTable('payment_history', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
    subscription_id: {
      type: 'uuid',
      notNull: true,
      references: 'subscriptions(id)',
      onDelete: 'CASCADE',
    },
    amount_cents: {
      type: 'integer',
      notNull: true,
    },
    currency: {
      type: 'varchar(3)',
      notNull: true,
      default: "'usd'",
    },
    stripe_payment_intent_id: {
      type: 'varchar(255)',
    },
    status: {
      type: 'varchar(20)',
      notNull: true,
      check: "status IN ('succeeded', 'failed', 'pending', 'refunded')",
    },
    retry_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    next_retry_at: {
      type: 'timestamp with time zone',
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('payment_history', 'user_id');
  pgm.createIndex('payment_history', 'subscription_id');
  pgm.createIndex('payment_history', 'stripe_payment_intent_id');
  pgm.createIndex('payment_history', 'status');

  // Seed default subscription plans
  pgm.sql(`
    INSERT INTO subscription_plans (id, name, display_name, price_monthly_cents, storage_limit_mb, ai_queries_per_day, is_active)
    VALUES
      (uuid_generate_v4(), 'free', 'Free', 0, 500, 10, true),
      (uuid_generate_v4(), 'pro', 'Pro', 1999, 5120, 100, true),
      (uuid_generate_v4(), 'enterprise', 'Enterprise', 4999, 51200, -1, true);
  `);

  // Seed feature entitlements for Free plan
  pgm.sql(`
    INSERT INTO plan_entitlements (id, plan_id, feature_key, enabled)
    SELECT uuid_generate_v4(), sp.id, fe.key, true
    FROM subscription_plans sp
    CROSS JOIN (
      VALUES ('ai.categorization'), ('input.web_upload'), ('export.csv')
    ) AS fe(key)
    WHERE sp.name = 'free';
  `);

  // Seed feature entitlements for Pro plan
  pgm.sql(`
    INSERT INTO plan_entitlements (id, plan_id, feature_key, enabled)
    SELECT uuid_generate_v4(), sp.id, fe.key, true
    FROM subscription_plans sp
    CROSS JOIN (
      VALUES
        ('ai.categorization'),
        ('ai.relationship_mapping'),
        ('ai.natural_language'),
        ('input.web_upload'),
        ('input.sms'),
        ('input.api'),
        ('input.csv'),
        ('integration.notion'),
        ('export.csv')
    ) AS fe(key)
    WHERE sp.name = 'pro';
  `);

  // Seed feature entitlements for Enterprise plan
  pgm.sql(`
    INSERT INTO plan_entitlements (id, plan_id, feature_key, enabled)
    SELECT uuid_generate_v4(), sp.id, fe.key, true
    FROM subscription_plans sp
    CROSS JOIN (
      VALUES
        ('ai.categorization'),
        ('ai.relationship_mapping'),
        ('ai.natural_language'),
        ('ai.cluster_summaries'),
        ('ai.suggestions'),
        ('ai.priority_processing'),
        ('input.web_upload'),
        ('input.sms'),
        ('input.api'),
        ('input.csv'),
        ('integration.notion'),
        ('integration.n8n'),
        ('export.csv'),
        ('advanced.custom_categories')
    ) AS fe(key)
    WHERE sp.name = 'enterprise';
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('payment_history');
  pgm.dropTable('subscriptions');
  pgm.dropTable('plan_entitlements');
  pgm.dropTable('subscription_plans');
}
