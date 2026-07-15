import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Platform credentials table
  pgm.createTable('platform_credentials', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    provider: {
      type: 'varchar(50)',
      notNull: true,
      unique: true,
    },
    credentials_encrypted: {
      type: 'text',
      notNull: true,
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

  // User integrations table
  pgm.createTable('user_integrations', {
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
    provider: {
      type: 'varchar(50)',
      notNull: true,
    },
    credentials_encrypted: {
      type: 'text',
      notNull: true,
    },
    metadata: {
      type: 'jsonb',
    },
    connected_at: {
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

  pgm.addConstraint('user_integrations', 'uq_user_integrations_user_provider', {
    unique: ['user_id', 'provider'],
  });
  pgm.createIndex('user_integrations', 'user_id');
  pgm.createIndex('user_integrations', 'provider');

  // Migrate notion_connections data into user_integrations
  pgm.sql(`
    INSERT INTO user_integrations (user_id, provider, credentials_encrypted, metadata, connected_at)
    SELECT
      user_id,
      'notion',
      access_token_encrypted,
      jsonb_build_object('workspace_id', workspace_id, 'workspace_name', workspace_name),
      connected_at
    FROM notion_connections
  `);

  // Drop the old table
  pgm.dropTable('notion_connections');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Recreate notion_connections
  pgm.createTable('notion_connections', {
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
    access_token_encrypted: {
      type: 'text',
      notNull: true,
    },
    workspace_id: {
      type: 'varchar(255)',
      notNull: true,
    },
    workspace_name: {
      type: 'varchar(255)',
    },
    connected_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('notion_connections', 'user_id');

  // Migrate data back from user_integrations to notion_connections
  pgm.sql(`
    INSERT INTO notion_connections (user_id, access_token_encrypted, workspace_id, workspace_name, connected_at)
    SELECT
      user_id,
      credentials_encrypted,
      metadata->>'workspace_id',
      metadata->>'workspace_name',
      connected_at
    FROM user_integrations WHERE provider = 'notion'
  `);

  pgm.dropTable('user_integrations');
  pgm.dropTable('platform_credentials');
}
