import { describe, it, expect, vi, beforeEach } from 'vitest';
import { up, down } from '../../../../migrations/008_create-credential-tables.js';
import { MigrationBuilder } from 'node-pg-migrate';

/**
 * Unit tests for credential tables migration (008).
 * Validates table creation, data migration, constraints, indexes, and down migration.
 */

function createMockPgm() {
  const sqlStatements: string[] = [];
  const createdTables: string[] = [];
  const droppedTables: string[] = [];
  const createdIndexes: Array<{ table: string; columns: string | string[] }> = [];
  const addedConstraints: Array<{ table: string; name: string; constraint: unknown }> = [];

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
    addConstraint: vi.fn((table: string, name: string, constraint: unknown) => {
      addedConstraints.push({ table, name, constraint });
    }),
    sql: vi.fn((statement: string) => {
      sqlStatements.push(statement);
    }),
    func: vi.fn((expression: string) => expression),
  } as unknown as MigrationBuilder;

  return { pgm, sqlStatements, createdTables, droppedTables, createdIndexes, addedConstraints };
}

describe('Migration 008: Create credential tables', () => {
  let mock: ReturnType<typeof createMockPgm>;

  beforeEach(() => {
    mock = createMockPgm();
  });

  describe('up migration', () => {
    beforeEach(async () => {
      await up(mock.pgm);
    });

    it('should create platform_credentials table', () => {
      expect(mock.createdTables).toContain('platform_credentials');
    });

    it('should create user_integrations table', () => {
      expect(mock.createdTables).toContain('user_integrations');
    });

    it('should create platform_credentials with correct columns', () => {
      const createTableCall = (mock.pgm.createTable as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === 'platform_credentials'
      );
      expect(createTableCall).toBeDefined();

      const columns = createTableCall![1];
      expect(columns).toHaveProperty('id');
      expect(columns).toHaveProperty('provider');
      expect(columns).toHaveProperty('credentials_encrypted');
      expect(columns).toHaveProperty('created_at');
      expect(columns).toHaveProperty('updated_at');

      expect(columns.id.type).toBe('uuid');
      expect(columns.id.primaryKey).toBe(true);
      expect(columns.provider.type).toBe('varchar(50)');
      expect(columns.provider.notNull).toBe(true);
      expect(columns.provider.unique).toBe(true);
      expect(columns.credentials_encrypted.type).toBe('text');
      expect(columns.credentials_encrypted.notNull).toBe(true);
    });

    it('should create user_integrations with correct columns', () => {
      const createTableCall = (mock.pgm.createTable as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === 'user_integrations'
      );
      expect(createTableCall).toBeDefined();

      const columns = createTableCall![1];
      expect(columns).toHaveProperty('id');
      expect(columns).toHaveProperty('user_id');
      expect(columns).toHaveProperty('provider');
      expect(columns).toHaveProperty('credentials_encrypted');
      expect(columns).toHaveProperty('metadata');
      expect(columns).toHaveProperty('connected_at');
      expect(columns).toHaveProperty('updated_at');

      expect(columns.id.type).toBe('uuid');
      expect(columns.id.primaryKey).toBe(true);
      expect(columns.user_id.type).toBe('uuid');
      expect(columns.user_id.notNull).toBe(true);
      expect(columns.user_id.references).toBe('users(id)');
      expect(columns.user_id.onDelete).toBe('CASCADE');
      expect(columns.provider.type).toBe('varchar(50)');
      expect(columns.provider.notNull).toBe(true);
      expect(columns.credentials_encrypted.type).toBe('text');
      expect(columns.credentials_encrypted.notNull).toBe(true);
      expect(columns.metadata.type).toBe('jsonb');
    });

    it('should add unique constraint on (user_id, provider) for user_integrations', () => {
      const constraint = mock.addedConstraints.find(
        (c) => c.table === 'user_integrations' && c.name === 'uq_user_integrations_user_provider'
      );
      expect(constraint).toBeDefined();
      expect(constraint!.constraint).toEqual({ unique: ['user_id', 'provider'] });
    });

    it('should create indexes on user_integrations.user_id and user_integrations.provider', () => {
      const userIntIndexes = mock.createdIndexes.filter((i) => i.table === 'user_integrations');
      expect(userIntIndexes.length).toBeGreaterThanOrEqual(2);
      expect(userIntIndexes.some((i) => i.columns === 'user_id')).toBe(true);
      expect(userIntIndexes.some((i) => i.columns === 'provider')).toBe(true);
    });

    it('should migrate notion_connections data into user_integrations', () => {
      const migrateSql = mock.sqlStatements.find(
        (s) => s.includes('INSERT INTO user_integrations') && s.includes('notion_connections')
      );
      expect(migrateSql).toBeDefined();
      expect(migrateSql).toContain("'notion'");
      expect(migrateSql).toContain('access_token_encrypted');
      expect(migrateSql).toContain('workspace_id');
      expect(migrateSql).toContain('workspace_name');
      expect(migrateSql).toContain('jsonb_build_object');
    });

    it('should drop notion_connections table after migration', () => {
      expect(mock.droppedTables).toContain('notion_connections');
    });
  });

  describe('down migration', () => {
    beforeEach(async () => {
      await down(mock.pgm);
    });

    it('should recreate notion_connections table', () => {
      expect(mock.createdTables).toContain('notion_connections');
    });

    it('should recreate notion_connections with correct columns', () => {
      const createTableCall = (mock.pgm.createTable as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === 'notion_connections'
      );
      expect(createTableCall).toBeDefined();

      const columns = createTableCall![1];
      expect(columns).toHaveProperty('id');
      expect(columns).toHaveProperty('user_id');
      expect(columns).toHaveProperty('access_token_encrypted');
      expect(columns).toHaveProperty('workspace_id');
      expect(columns).toHaveProperty('workspace_name');
      expect(columns).toHaveProperty('connected_at');

      expect(columns.user_id.references).toBe('users(id)');
      expect(columns.user_id.onDelete).toBe('CASCADE');
      expect(columns.user_id.unique).toBe(true);
    });

    it('should create index on notion_connections.user_id', () => {
      const ncIndexes = mock.createdIndexes.filter((i) => i.table === 'notion_connections');
      expect(ncIndexes.some((i) => i.columns === 'user_id')).toBe(true);
    });

    it('should migrate data back from user_integrations to notion_connections', () => {
      const migrateSql = mock.sqlStatements.find(
        (s) => s.includes('INSERT INTO notion_connections') && s.includes('user_integrations')
      );
      expect(migrateSql).toBeDefined();
      expect(migrateSql).toContain("provider = 'notion'");
      expect(migrateSql).toContain("metadata->>'workspace_id'");
      expect(migrateSql).toContain("metadata->>'workspace_name'");
    });

    it('should drop user_integrations table', () => {
      expect(mock.droppedTables).toContain('user_integrations');
    });

    it('should drop platform_credentials table', () => {
      expect(mock.droppedTables).toContain('platform_credentials');
    });

    it('should drop tables in correct order (user_integrations before platform_credentials)', () => {
      const uiIdx = mock.droppedTables.indexOf('user_integrations');
      const pcIdx = mock.droppedTables.indexOf('platform_credentials');
      expect(uiIdx).toBeLessThan(pcIdx);
    });
  });
});
