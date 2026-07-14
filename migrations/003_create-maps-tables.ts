import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Maps table
  pgm.createTable('maps', {
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
      notNull: true,
    },
    layout_data: {
      type: 'jsonb',
      default: "'{}'",
    },
    generated_at: {
      type: 'timestamp with time zone',
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('maps', 'user_id');

  // Map nodes table
  pgm.createTable('map_nodes', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    map_id: {
      type: 'uuid',
      notNull: true,
      references: 'maps(id)',
      onDelete: 'CASCADE',
    },
    item_id: {
      type: 'uuid',
      notNull: true,
      references: 'items(id)',
      onDelete: 'CASCADE',
    },
    x_position: {
      type: 'real',
      notNull: true,
      default: 0,
    },
    y_position: {
      type: 'real',
      notNull: true,
      default: 0,
    },
  });

  pgm.createIndex('map_nodes', 'map_id');
  pgm.createIndex('map_nodes', 'item_id');
  pgm.addConstraint('map_nodes', 'map_nodes_map_item_unique', {
    unique: ['map_id', 'item_id'],
  });

  // Map edges table
  pgm.createTable('map_edges', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    map_id: {
      type: 'uuid',
      notNull: true,
      references: 'maps(id)',
      onDelete: 'CASCADE',
    },
    relationship_id: {
      type: 'uuid',
      notNull: true,
      references: 'relationships(id)',
      onDelete: 'CASCADE',
    },
  });

  pgm.createIndex('map_edges', 'map_id');
  pgm.createIndex('map_edges', 'relationship_id');
  pgm.addConstraint('map_edges', 'map_edges_map_relationship_unique', {
    unique: ['map_id', 'relationship_id'],
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('map_edges');
  pgm.dropTable('map_nodes');
  pgm.dropTable('maps');
}
