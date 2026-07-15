import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // ADMIN_ROLE table
  pgm.createTable('admin_roles', {
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
    permissions: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'[]'::jsonb"),
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('admin_roles', 'name');

  // ADMIN_USER table
  pgm.createTable('admin_users', {
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
    role_id: {
      type: 'uuid',
      notNull: true,
      references: 'admin_roles(id)',
      onDelete: 'RESTRICT',
    },
    mfa_enabled: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    mfa_secret: {
      type: 'varchar(255)',
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('admin_users', 'user_id');
  pgm.createIndex('admin_users', 'role_id');

  // AUDIT_LOG table
  pgm.createTable('audit_log', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    admin_user_id: {
      type: 'uuid',
      notNull: true,
      references: 'admin_users(id)',
      onDelete: 'RESTRICT',
    },
    action: {
      type: 'varchar(100)',
      notNull: true,
    },
    target_type: {
      type: 'varchar(50)',
      notNull: true,
    },
    target_id: {
      type: 'varchar(255)',
    },
    details: {
      type: 'jsonb',
      default: pgm.func("'{}'::jsonb"),
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('audit_log', 'admin_user_id');
  pgm.createIndex('audit_log', 'action');
  pgm.createIndex('audit_log', 'target_type');
  pgm.createIndex('audit_log', 'created_at');

  // admin_user_summary VIEW
  // Joins users with subscription info and card counts — NO content fields exposed
  pgm.sql(`
    CREATE VIEW admin_user_summary AS
    SELECT
      u.id AS user_id,
      u.email,
      u.role,
      u.is_locked,
      u.locked_until,
      u.created_at AS registration_date,
      u.updated_at,
      s.id AS subscription_id,
      sp.name AS plan_name,
      sp.display_name AS plan_display_name,
      s.status AS subscription_status,
      s.current_period_end,
      COALESCE(ic.item_count, 0) AS card_count,
      COALESCE(ic.total_file_size_bytes, 0) AS total_storage_used_bytes
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id
    LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::integer AS item_count,
        COALESCE(SUM(file_size), 0)::bigint AS total_file_size_bytes
      FROM items
      WHERE items.user_id = u.id AND items.is_deleted = false
    ) ic ON true;
  `);

  // Seed admin roles
  pgm.sql(`
    INSERT INTO admin_roles (id, name, permissions)
    VALUES
      (
        uuid_generate_v4(),
        'super_admin',
        '["users.view", "users.disable", "users.delete", "users.unlock", "plans.create", "plans.modify", "plans.deactivate", "entitlements.manage", "moderation.flag", "moderation.disable", "audit.view", "metrics.view", "roles.manage"]'::jsonb
      ),
      (
        uuid_generate_v4(),
        'admin',
        '["users.view", "users.disable", "users.delete", "users.unlock", "plans.create", "plans.modify", "plans.deactivate", "entitlements.manage", "audit.view", "metrics.view"]'::jsonb
      ),
      (
        uuid_generate_v4(),
        'moderator',
        '["users.view", "moderation.flag", "moderation.disable", "audit.view"]'::jsonb
      );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP VIEW IF EXISTS admin_user_summary;');
  pgm.dropTable('audit_log');
  pgm.dropTable('admin_users');
  pgm.dropTable('admin_roles');
}
