import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Feature Registry table
  pgm.createTable('feature_registry', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    key: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    description: {
      type: 'text',
      notNull: true,
    },
    category: {
      type: 'varchar(50)',
      notNull: true,
      check: "category IN ('input_channels', 'ai_capabilities', 'integrations', 'export_formats', 'advanced')",
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('feature_registry', 'key');
  pgm.createIndex('feature_registry', 'category');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('feature_registry');
}
