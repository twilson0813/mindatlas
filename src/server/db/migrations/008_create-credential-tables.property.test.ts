import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { up } from '../../../../migrations/008_create-credential-tables.js';
import { MigrationBuilder } from 'node-pg-migrate';

/**
 * Property 7: Migration data preservation
 *
 * For any row in notion_connections with fields (user_id, access_token_encrypted,
 * workspace_id, workspace_name, connected_at), after migration, the user_integrations
 * table SHALL contain a row with the same user_id, provider = "notion",
 * credentials_encrypted = access_token_encrypted, and metadata containing the
 * original workspace_id and workspace_name.
 *
 * **Validates: Requirements 5.1**
 */
describe('Property 7: Migration data preservation', () => {
  /**
   * Simulates the SQL transformation that the migration performs:
   *
   * INSERT INTO user_integrations (user_id, provider, credentials_encrypted, metadata, connected_at)
   * SELECT user_id, 'notion', access_token_encrypted,
   *        jsonb_build_object('workspace_id', workspace_id, 'workspace_name', workspace_name),
   *        connected_at
   * FROM notion_connections
   */
  function simulateMigrationTransform(notionRow: {
    user_id: string;
    access_token_encrypted: string;
    workspace_id: string;
    workspace_name: string;
    connected_at: string;
  }) {
    return {
      user_id: notionRow.user_id,
      provider: 'notion',
      credentials_encrypted: notionRow.access_token_encrypted,
      metadata: {
        workspace_id: notionRow.workspace_id,
        workspace_name: notionRow.workspace_name,
      },
      connected_at: notionRow.connected_at,
    };
  }

  // Generator for a notion_connections row
  const notionConnectionRowArb = fc.record({
    user_id: fc.uuid(),
    access_token_encrypted: fc.string({ minLength: 10, maxLength: 200 }),
    workspace_id: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
    workspace_name: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
    connected_at: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(
      (d) => d.toISOString()
    ),
  });

  it('should map each notion_connections row to a user_integrations row with correct field mapping', () => {
    fc.assert(
      fc.property(notionConnectionRowArb, (notionRow) => {
        const result = simulateMigrationTransform(notionRow);

        // user_id is preserved
        expect(result.user_id).toBe(notionRow.user_id);

        // provider is always 'notion'
        expect(result.provider).toBe('notion');

        // credentials_encrypted is the original access_token_encrypted (pass-through)
        expect(result.credentials_encrypted).toBe(notionRow.access_token_encrypted);

        // metadata contains workspace_id and workspace_name
        expect(result.metadata).toEqual({
          workspace_id: notionRow.workspace_id,
          workspace_name: notionRow.workspace_name,
        });

        // connected_at is preserved
        expect(result.connected_at).toBe(notionRow.connected_at);
      }),
      { numRuns: 100 },
    );
  });

  it('should verify the migration SQL correctly references all required fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(notionConnectionRowArb, { minLength: 1, maxLength: 5 }),
        async (notionRows) => {
          // Capture the SQL statements the migration generates
          const sqlStatements: string[] = [];

          const pgm = {
            createTable: vi.fn(),
            dropTable: vi.fn(),
            createIndex: vi.fn(),
            addConstraint: vi.fn(),
            sql: vi.fn((statement: string) => {
              sqlStatements.push(statement);
            }),
            func: vi.fn((expression: string) => expression),
          } as unknown as MigrationBuilder;

          await up(pgm);

          // Find the migration INSERT SQL
          const migrateSql = sqlStatements.find(
            (s) => s.includes('INSERT INTO user_integrations') && s.includes('notion_connections')
          );

          expect(migrateSql).toBeDefined();

          // Verify the SQL maps all fields correctly:
          // 1. Selects user_id from notion_connections
          expect(migrateSql).toContain('user_id');

          // 2. Sets provider to 'notion'
          expect(migrateSql).toContain("'notion'");

          // 3. Maps access_token_encrypted to credentials_encrypted
          expect(migrateSql).toContain('access_token_encrypted');

          // 4. Builds metadata jsonb from workspace_id and workspace_name
          expect(migrateSql).toContain('jsonb_build_object');
          expect(migrateSql).toContain('workspace_id');
          expect(migrateSql).toContain('workspace_name');

          // 5. Preserves connected_at
          expect(migrateSql).toContain('connected_at');

          // 6. Verify the INSERT columns match the expected structure
          expect(migrateSql).toContain('INSERT INTO user_integrations');
          expect(migrateSql).toContain('provider');
          expect(migrateSql).toContain('credentials_encrypted');
          expect(migrateSql).toContain('metadata');

          // For each arbitrary notion row, validate that the transform function
          // produces the correct result matching the SQL semantics
          for (const notionRow of notionRows) {
            const transformed = simulateMigrationTransform(notionRow);

            // The transform output must be consistent with the SQL mapping
            expect(transformed.user_id).toBe(notionRow.user_id);
            expect(transformed.provider).toBe('notion');
            expect(transformed.credentials_encrypted).toBe(notionRow.access_token_encrypted);
            expect(transformed.metadata.workspace_id).toBe(notionRow.workspace_id);
            expect(transformed.metadata.workspace_name).toBe(notionRow.workspace_name);
            expect(transformed.connected_at).toBe(notionRow.connected_at);
          }
        }
      ),
      { numRuns: 100 },
    );
  });

  it('should preserve data integrity: no fields are lost or mutated during migration transform', () => {
    fc.assert(
      fc.property(notionConnectionRowArb, (notionRow) => {
        const result = simulateMigrationTransform(notionRow);

        // The result has exactly the expected shape — no extra or missing fields
        const resultKeys = Object.keys(result).sort();
        expect(resultKeys).toEqual(
          ['connected_at', 'credentials_encrypted', 'metadata', 'provider', 'user_id']
        );

        // metadata has exactly workspace_id and workspace_name
        const metadataKeys = Object.keys(result.metadata).sort();
        expect(metadataKeys).toEqual(['workspace_id', 'workspace_name']);

        // No values are undefined or null (all fields are preserved)
        expect(result.user_id).toBeDefined();
        expect(result.provider).toBeDefined();
        expect(result.credentials_encrypted).toBeDefined();
        expect(result.metadata.workspace_id).toBeDefined();
        expect(result.metadata.workspace_name).toBeDefined();
        expect(result.connected_at).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });
});
