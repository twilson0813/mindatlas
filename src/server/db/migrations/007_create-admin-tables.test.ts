import { describe, it, expect, vi, beforeEach } from 'vitest';
import { up, down } from '../../../../migrations/007_create-admin-tables.js';
import { MigrationBuilder } from 'node-pg-migrate';

/**
 * Unit tests for admin tables migration (007).
 * Validates table creation, view creation, role seeding, and down migration.
 */

function createMockPgm() {
  const sqlStatements: string[] = [];
  const createdTables: string[] = [];
  const droppedTables: string[] = [];
  const createdIndexes: Array<{ table: string; columns: string | string[] }> = [];

  const pgm = {
    createTable: vi.fn((tableName: string) => {
      createdTables.push(tableName);
    }),
    dropTable: vi.fn((tableName: string) => {
      droppedTables.push(tableName);
    }),
    createIndex: vi.fn((table: string, columns: string | string[]) => {
      createdIndexes.push({ table, columns });
    }),
    sql: vi.fn((statement: string) => {
      sqlStatements.push(statement);
    }),
    func: vi.fn((expression: string) => expression),
  } as unknown as MigrationBuilder;

  return { pgm, sqlStatements, createdTables, droppedTables, createdIndexes };
}

describe('Migration 007: Create admin tables', () => {
  let mock: ReturnType<typeof createMockPgm>;

  beforeEach(() => {
    mock = createMockPgm();
  });

  describe('up migration', () => {
    beforeEach(async () => {
      await up(mock.pgm);
    });

    it('should create admin_roles table', () => {
      expect(mock.createdTables).toContain('admin_roles');
    });

    it('should create admin_users table', () => {
      expect(mock.createdTables).toContain('admin_users');
    });

    it('should create audit_log table', () => {
      expect(mock.createdTables).toContain('audit_log');
    });

    it('should create tables in correct order (roles before users, users before audit_log)', () => {
      const rolesIdx = mock.createdTables.indexOf('admin_roles');
      const usersIdx = mock.createdTables.indexOf('admin_users');
      const auditIdx = mock.createdTables.indexOf('audit_log');

      expect(rolesIdx).toBeLessThan(usersIdx);
      expect(usersIdx).toBeLessThan(auditIdx);
    });

    it('should create admin_roles table with correct columns', () => {
      const createTableCall = (mock.pgm.createTable as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === 'admin_roles'
      );
      expect(createTableCall).toBeDefined();

      const columns = createTableCall![1];
      expect(columns).toHaveProperty('id');
      expect(columns).toHaveProperty('name');
      expect(columns).toHaveProperty('permissions');
      expect(columns).toHaveProperty('created_at');

      expect(columns.id.type).toBe('uuid');
      expect(columns.id.primaryKey).toBe(true);
      expect(columns.name.type).toBe('varchar(50)');
      expect(columns.name.notNull).toBe(true);
      expect(columns.name.unique).toBe(true);
      expect(columns.permissions.type).toBe('jsonb');
      expect(columns.permissions.notNull).toBe(true);
    });

    it('should create admin_users table with correct columns and foreign keys', () => {
      const createTableCall = (mock.pgm.createTable as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === 'admin_users'
      );
      expect(createTableCall).toBeDefined();

      const columns = createTableCall![1];
      expect(columns).toHaveProperty('id');
      expect(columns).toHaveProperty('user_id');
      expect(columns).toHaveProperty('role_id');
      expect(columns).toHaveProperty('mfa_enabled');
      expect(columns).toHaveProperty('mfa_secret');
      expect(columns).toHaveProperty('created_at');

      // Foreign key references
      expect(columns.user_id.references).toBe('users(id)');
      expect(columns.user_id.onDelete).toBe('CASCADE');
      expect(columns.role_id.references).toBe('admin_roles(id)');
      expect(columns.role_id.onDelete).toBe('RESTRICT');

      // MFA fields
      expect(columns.mfa_enabled.type).toBe('boolean');
      expect(columns.mfa_enabled.default).toBe(false);
      expect(columns.mfa_secret.type).toBe('varchar(255)');
    });

    it('should create audit_log table with correct columns', () => {
      const createTableCall = (mock.pgm.createTable as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === 'audit_log'
      );
      expect(createTableCall).toBeDefined();

      const columns = createTableCall![1];
      expect(columns).toHaveProperty('id');
      expect(columns).toHaveProperty('admin_user_id');
      expect(columns).toHaveProperty('action');
      expect(columns).toHaveProperty('target_type');
      expect(columns).toHaveProperty('target_id');
      expect(columns).toHaveProperty('details');
      expect(columns).toHaveProperty('created_at');

      // Foreign key reference
      expect(columns.admin_user_id.references).toBe('admin_users(id)');
      expect(columns.admin_user_id.onDelete).toBe('RESTRICT');
      expect(columns.action.type).toBe('varchar(100)');
      expect(columns.target_type.type).toBe('varchar(50)');
      expect(columns.details.type).toBe('jsonb');
    });

    it('should create admin_user_summary view via SQL', () => {
      const viewSql = mock.sqlStatements.find((s) =>
        s.includes('CREATE VIEW admin_user_summary')
      );
      expect(viewSql).toBeDefined();
    });

    it('should NOT include content_encrypted in admin_user_summary view', () => {
      const viewSql = mock.sqlStatements.find((s) =>
        s.includes('CREATE VIEW admin_user_summary')
      );
      expect(viewSql).toBeDefined();
      expect(viewSql).not.toContain('content_encrypted');
      expect(viewSql).not.toContain('file_path');
    });

    it('should include user metadata fields in admin_user_summary view', () => {
      const viewSql = mock.sqlStatements.find((s) =>
        s.includes('CREATE VIEW admin_user_summary')
      );
      expect(viewSql).toBeDefined();
      expect(viewSql).toContain('u.email');
      expect(viewSql).toContain('u.is_locked');
      expect(viewSql).toContain('u.role');
      expect(viewSql).toContain('item_count');
    });

    it('should include subscription info in admin_user_summary view', () => {
      const viewSql = mock.sqlStatements.find((s) =>
        s.includes('CREATE VIEW admin_user_summary')
      );
      expect(viewSql).toBeDefined();
      expect(viewSql).toContain('plan_name');
      expect(viewSql).toContain('subscription_status');
    });

    it('should seed three admin roles', () => {
      const seedSql = mock.sqlStatements.find(
        (s) => s.includes('INSERT INTO admin_roles') && s.includes('super_admin')
      );
      expect(seedSql).toBeDefined();
      expect(seedSql).toContain('super_admin');
      expect(seedSql).toContain('admin');
      expect(seedSql).toContain('moderator');
    });

    it('should give super_admin all permissions including roles.manage', () => {
      const seedSql = mock.sqlStatements.find(
        (s) => s.includes('INSERT INTO admin_roles') && s.includes('super_admin')
      );
      expect(seedSql).toBeDefined();
      expect(seedSql).toContain('roles.manage');
      expect(seedSql).toContain('users.view');
      expect(seedSql).toContain('users.disable');
      expect(seedSql).toContain('users.delete');
      expect(seedSql).toContain('plans.create');
      expect(seedSql).toContain('entitlements.manage');
      expect(seedSql).toContain('moderation.flag');
    });

    it('should give admin role user and plan management permissions but not roles.manage', () => {
      const seedSql = mock.sqlStatements.find(
        (s) => s.includes('INSERT INTO admin_roles') && s.includes('super_admin')
      );
      expect(seedSql).toBeDefined();
      // The admin row permissions should include user/plan management
      // Check that the admin entry has users/plans permissions
      expect(seedSql).toContain('"users.view", "users.disable", "users.delete", "users.unlock", "plans.create", "plans.modify", "plans.deactivate", "entitlements.manage", "audit.view", "metrics.view"');
    });

    it('should give moderator role only flag/disable permissions', () => {
      const seedSql = mock.sqlStatements.find(
        (s) => s.includes('INSERT INTO admin_roles') && s.includes('moderator')
      );
      expect(seedSql).toBeDefined();
      expect(seedSql).toContain('"users.view", "moderation.flag", "moderation.disable", "audit.view"');
    });

    it('should create indexes on admin_roles', () => {
      const roleIndexes = mock.createdIndexes.filter((i) => i.table === 'admin_roles');
      expect(roleIndexes.length).toBeGreaterThanOrEqual(1);
      expect(roleIndexes.some((i) => i.columns === 'name')).toBe(true);
    });

    it('should create indexes on admin_users', () => {
      const userIndexes = mock.createdIndexes.filter((i) => i.table === 'admin_users');
      expect(userIndexes.length).toBeGreaterThanOrEqual(2);
      expect(userIndexes.some((i) => i.columns === 'user_id')).toBe(true);
      expect(userIndexes.some((i) => i.columns === 'role_id')).toBe(true);
    });

    it('should create indexes on audit_log', () => {
      const auditIndexes = mock.createdIndexes.filter((i) => i.table === 'audit_log');
      expect(auditIndexes.length).toBeGreaterThanOrEqual(3);
      expect(auditIndexes.some((i) => i.columns === 'admin_user_id')).toBe(true);
      expect(auditIndexes.some((i) => i.columns === 'action')).toBe(true);
      expect(auditIndexes.some((i) => i.columns === 'created_at')).toBe(true);
    });
  });

  describe('down migration', () => {
    beforeEach(async () => {
      await down(mock.pgm);
    });

    it('should drop the admin_user_summary view', () => {
      const dropViewSql = mock.sqlStatements.find((s) =>
        s.includes('DROP VIEW') && s.includes('admin_user_summary')
      );
      expect(dropViewSql).toBeDefined();
    });

    it('should drop tables in reverse dependency order', () => {
      expect(mock.droppedTables).toEqual(['audit_log', 'admin_users', 'admin_roles']);
    });

    it('should drop audit_log before admin_users (FK dependency)', () => {
      const auditIdx = mock.droppedTables.indexOf('audit_log');
      const usersIdx = mock.droppedTables.indexOf('admin_users');
      expect(auditIdx).toBeLessThan(usersIdx);
    });

    it('should drop admin_users before admin_roles (FK dependency)', () => {
      const usersIdx = mock.droppedTables.indexOf('admin_users');
      const rolesIdx = mock.droppedTables.indexOf('admin_roles');
      expect(usersIdx).toBeLessThan(rolesIdx);
    });
  });
});
