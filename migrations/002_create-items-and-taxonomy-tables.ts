import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Categories table
  pgm.createTable('categories', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    name: {
      type: 'varchar(100)',
      notNull: true,
      unique: true,
    },
    color: {
      type: 'varchar(7)',
      notNull: true,
      default: "'#6B7280'",
    },
  });

  // Tags table
  pgm.createTable('tags', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    category_id: {
      type: 'uuid',
      notNull: true,
      references: 'categories(id)',
      onDelete: 'CASCADE',
    },
    name: {
      type: 'varchar(100)',
      notNull: true,
    },
    color: {
      type: 'varchar(7)',
      notNull: true,
      default: "'#6B7280'",
    },
  });

  pgm.createIndex('tags', 'category_id');
  pgm.addConstraint('tags', 'tags_name_category_unique', {
    unique: ['name', 'category_id'],
  });

  // Items table
  pgm.createTable('items', {
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
    title: {
      type: 'varchar(500)',
    },
    content_encrypted: {
      type: 'text',
      notNull: true,
    },
    content_type: {
      type: 'varchar(50)',
      notNull: true,
      default: "'plain_text'",
    },
    metadata: {
      type: 'jsonb',
      default: "'{}'",
    },
    source_channel: {
      type: 'varchar(50)',
    },
    source_domain: {
      type: 'varchar(255)',
    },
    file_path: {
      type: 'varchar(1024)',
    },
    file_size: {
      type: 'integer',
    },
    is_deleted: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    deleted_at: {
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

  pgm.createIndex('items', 'user_id');
  pgm.createIndex('items', ['user_id', 'is_deleted']);
  pgm.createIndex('items', 'content_type');
  pgm.createIndex('items', 'created_at');

  // Item-Tag junction table
  pgm.createTable('item_tags', {
    item_id: {
      type: 'uuid',
      notNull: true,
      references: 'items(id)',
      onDelete: 'CASCADE',
    },
    tag_id: {
      type: 'uuid',
      notNull: true,
      references: 'tags(id)',
      onDelete: 'CASCADE',
    },
    confidence_score: {
      type: 'real',
      notNull: true,
      default: 1.0,
    },
  });

  pgm.addConstraint('item_tags', 'item_tags_pkey', {
    primaryKey: ['item_id', 'tag_id'],
  });
  pgm.createIndex('item_tags', 'tag_id');

  // Relationships table
  pgm.createTable('relationships', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    source_item_id: {
      type: 'uuid',
      notNull: true,
      references: 'items(id)',
      onDelete: 'CASCADE',
    },
    target_item_id: {
      type: 'uuid',
      notNull: true,
      references: 'items(id)',
      onDelete: 'CASCADE',
    },
    relationship_type: {
      type: 'varchar(100)',
      notNull: true,
    },
    strength: {
      type: 'real',
      notNull: true,
      default: 0.5,
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('relationships', 'source_item_id');
  pgm.createIndex('relationships', 'target_item_id');
  pgm.addConstraint('relationships', 'relationships_no_self_reference', {
    check: 'source_item_id != target_item_id',
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('relationships');
  pgm.dropTable('item_tags');
  pgm.dropTable('items');
  pgm.dropTable('tags');
  pgm.dropTable('categories');
}
