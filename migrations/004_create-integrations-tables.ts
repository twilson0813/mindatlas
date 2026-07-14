import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // API Keys table
  pgm.createTable('api_keys', {
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
    key_hash: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    label: {
      type: 'varchar(255)',
      notNull: true,
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    last_used_at: {
      type: 'timestamp with time zone',
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('api_keys', 'user_id');
  pgm.createIndex('api_keys', 'key_hash');

  // Notion Connections table
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
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('notion_connections');
  pgm.dropTable('api_keys');
}
