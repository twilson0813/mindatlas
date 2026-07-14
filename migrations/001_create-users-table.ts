import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Enable uuid-ossp extension for uuid_generate_v4()
  pgm.createExtension('uuid-ossp', { ifNotExists: true });

  pgm.createTable('users', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    email: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    password_hash: {
      type: 'varchar(255)',
      notNull: true,
    },
    phone_number: {
      type: 'varchar(20)',
      unique: true,
    },
    is_locked: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    locked_until: {
      type: 'timestamp with time zone',
    },
    failed_attempts: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    role: {
      type: 'varchar(20)',
      notNull: true,
      default: "'user'",
      check: "role IN ('user', 'admin')",
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

  // Index on email for login lookups
  pgm.createIndex('users', 'email');
  // Index on phone_number for SMS gateway lookups
  pgm.createIndex('users', 'phone_number');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('users');
}
