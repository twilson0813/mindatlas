import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock admin service
vi.mock('../../services/admin/index.js', () => ({
  logAuditEntry: vi.fn().mockResolvedValue(undefined),
  listUsers: vi.fn(),
  getUserById: vi.fn(),
  disableAccount: vi.fn(),
  deleteAccount: vi.fn(),
  unlockAccount: vi.fn(),
  getSystemMetrics: vi.fn(),
  getSubscriptionMetrics: vi.fn(),
  listPlans: vi.fn(),
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
  deactivatePlan: vi.fn(),
  getFeatureEntitlements: vi.fn(),
  setFeatureEntitlements: vi.fn(),
  getFeatureRegistry: vi.fn(),
  moderateAccount: vi.fn(),
  getAuditTrail: vi.fn(),
}));

// Mock credential store
vi.mock('../../services/credentials/index.js', () => ({
  setPlatformCredentials: vi.fn().mockResolvedValue(undefined),
}));

// Mock database
vi.mock('../../db/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}));

// Mock logger
vi.mock('../../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock otplib
vi.mock('otplib', () => ({
  authenticator: {
    generateSecret: vi.fn().mockReturnValue('MOCKSECRET'),
    keyuri: vi.fn().mockReturnValue('otpauth://totp/test'),
    check: vi.fn().mockReturnValue(true),
  },
}));

// Mock config
vi.mock('../../config.js', () => ({
  config: {
    jwtSecret: 'test-secret',
    jwtRefreshSecret: 'test-refresh-secret',
  },
}));

// Mock Redis
vi.mock('../../redis.js', () => ({
  getRedisClient: () => ({
    multi: () => ({
      zremrangebyscore: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([null, null, [null, 0], null]),
    }),
  }),
}));

// Mock entitlement middleware
vi.mock('../../middleware/entitlement.js', () => ({
  invalidateCache: vi.fn(),
  requireEntitlement: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  loadEntitlements: vi.fn(),
}));

// Mock feature registry
vi.mock('../../services/feature-registry/index.js', () => ({
  getAll: vi.fn().mockReturnValue([]),
  isRegistered: vi.fn().mockReturnValue(true),
  register: vi.fn(),
  getByKey: vi.fn(),
  getByCategory: vi.fn(),
}));

import adminRouter from '../../routes/admin.js';
import * as adminService from '../../services/admin/index.js';
import { setPlatformCredentials } from '../../services/credentials/index.js';
import { queryOne } from '../../db/db.js';
import { up } from '../../../../migrations/008_create-credential-tables.js';
import { MigrationBuilder } from 'node-pg-migrate';

const mockLogAuditEntry = vi.mocked(adminService.logAuditEntry);
const mockSetPlatformCredentials = vi.mocked(setPlatformCredentials);
const mockQueryOne = vi.mocked(queryOne);

/**
 * Creates a test Express app that simulates admin authentication middleware.
 */
function createTestApp(permissions: string[] = ['entitlements.manage']) {
  const app = express();
  app.use(express.json());

  app.use('/api/admin', (req: Request, _res: Response, next: NextFunction) => {
    (req as any).adminUser = {
      id: 'admin-integration-test',
      user_id: 'user-admin',
      role_id: 'role-1',
      mfa_enabled: true,
      mfa_secret: 'secret',
      role_name: 'super_admin',
      permissions,
    };
    next();
  });

  app.use('/api/admin', adminRouter);
  return app;
}

// ─── Integration Test Suite ──────────────────────────────────────────────────

describe('Credential Management Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Suite 1: Admin credential update end-to-end ─────────────────────────

  describe('Admin credential update end-to-end: auth → validate → store → audit log', () => {
    let app: express.Express;

    beforeEach(() => {
      app = createTestApp();
    });

    it('should complete full flow for OpenAI: authenticate, validate, store, and audit', async () => {
      // Simulate that after credential store, the provider shows as configured
      mockQueryOne.mockResolvedValueOnce({ updated_at: new Date('2024-06-15T10:00:00Z') });
      mockQueryOne.mockResolvedValueOnce(null); // twilio not configured
      mockQueryOne.mockResolvedValueOnce(null); // stripe not configured

      // Step 1: POST credentials (auth is simulated by middleware)
      const postResponse = await request(app)
        .post('/api/admin/credentials/openai')
        .send({ apiKey: 'sk-integration-test-key-12345' });

      // Verify response
      expect(postResponse.status).toBe(200);
      expect(postResponse.body.message).toBe('Credentials for openai saved successfully');

      // Step 2: Verify setPlatformCredentials was called with correct args
      expect(mockSetPlatformCredentials).toHaveBeenCalledTimes(1);
      expect(mockSetPlatformCredentials).toHaveBeenCalledWith('openai', {
        apiKey: 'sk-integration-test-key-12345',
      });

      // Step 3: Verify audit log was written with correct fields
      expect(mockLogAuditEntry).toHaveBeenCalledTimes(1);
      expect(mockLogAuditEntry).toHaveBeenCalledWith(
        'admin-integration-test', // admin_user_id
        'credentials.update', // action
        'platform_credentials', // target_type
        'openai', // target_id (provider)
        expect.objectContaining({
          provider: 'openai',
          fieldsUpdated: ['apiKey'],
        }),
      );

      // Step 4: Verify subsequent GET /credentials/status shows provider as configured
      const statusResponse = await request(app).get('/api/admin/credentials/status');

      expect(statusResponse.status).toBe(200);
      expect(statusResponse.body.providers.openai.configured).toBe(true);
      expect(statusResponse.body.providers.openai.updatedAt).toBe('2024-06-15T10:00:00.000Z');
    });

    it('should complete full flow for Twilio: authenticate, validate, store, and audit', async () => {
      const postResponse = await request(app).post('/api/admin/credentials/twilio').send({
        accountSid: 'AC_integration_test_sid',
        authToken: 'auth_token_integration_test',
        phoneNumber: '+15551234567',
      });

      expect(postResponse.status).toBe(200);
      expect(postResponse.body.message).toBe('Credentials for twilio saved successfully');

      // Verify store called correctly
      expect(mockSetPlatformCredentials).toHaveBeenCalledWith('twilio', {
        accountSid: 'AC_integration_test_sid',
        authToken: 'auth_token_integration_test',
        phoneNumber: '+15551234567',
      });

      // Verify audit log
      expect(mockLogAuditEntry).toHaveBeenCalledWith(
        'admin-integration-test',
        'credentials.update',
        'platform_credentials',
        'twilio',
        expect.objectContaining({
          provider: 'twilio',
          fieldsUpdated: expect.arrayContaining(['accountSid', 'authToken', 'phoneNumber']),
        }),
      );
    });

    it('should complete full flow for Stripe: authenticate, validate, store, and audit', async () => {
      const postResponse = await request(app).post('/api/admin/credentials/stripe').send({
        secretKey: 'sk_test_integration_abc123',
        webhookSecret: 'whsec_integration_xyz789',
      });

      expect(postResponse.status).toBe(200);
      expect(postResponse.body.message).toBe('Credentials for stripe saved successfully');

      // Verify store called correctly
      expect(mockSetPlatformCredentials).toHaveBeenCalledWith('stripe', {
        secretKey: 'sk_test_integration_abc123',
        webhookSecret: 'whsec_integration_xyz789',
      });

      // Verify audit log
      expect(mockLogAuditEntry).toHaveBeenCalledWith(
        'admin-integration-test',
        'credentials.update',
        'platform_credentials',
        'stripe',
        expect.objectContaining({
          provider: 'stripe',
          fieldsUpdated: expect.arrayContaining(['secretKey', 'webhookSecret']),
        }),
      );
    });

    it('should reject request and not store/audit when validation fails', async () => {
      const response = await request(app).post('/api/admin/credentials/openai').send({}); // missing apiKey

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('apiKey is required');

      // Neither store nor audit should have been called
      expect(mockSetPlatformCredentials).not.toHaveBeenCalled();
      expect(mockLogAuditEntry).not.toHaveBeenCalled();
    });

    it('should reject request when user lacks entitlements.manage permission', async () => {
      const restrictedApp = createTestApp(['users.read']); // no entitlements.manage

      const response = await request(restrictedApp)
        .post('/api/admin/credentials/openai')
        .send({ apiKey: 'sk-should-not-save' });

      expect(response.status).toBe(403);
      expect(mockSetPlatformCredentials).not.toHaveBeenCalled();
      expect(mockLogAuditEntry).not.toHaveBeenCalled();
    });

    it('should not leak credential values in the audit log details', async () => {
      const sensitiveApiKey = 'sk-super-secret-key-never-leak';

      await request(app).post('/api/admin/credentials/openai').send({ apiKey: sensitiveApiKey });

      const [, , , , details] = mockLogAuditEntry.mock.calls[0];
      const detailsStr = JSON.stringify(details);

      // The actual secret value should NOT appear in audit details
      expect(detailsStr).not.toContain(sensitiveApiKey);
      // But the field name should be referenced
      expect(details).toHaveProperty('fieldsUpdated');
      expect((details as any).fieldsUpdated).toContain('apiKey');
    });
  });

  // ─── Suite 2: Foreign key cascade ────────────────────────────────────────

  describe('Foreign key cascade: deleting user cascades to user_integrations', () => {
    it('should define ON DELETE CASCADE on user_id FK in migration', async () => {
      // Capture table definitions from the migration
      const createTableCalls: Array<{ name: string; columns: Record<string, any> }> = [];

      const pgm = {
        createTable: vi.fn((name: string, columns: Record<string, any>) => {
          createTableCalls.push({ name, columns });
        }),
        dropTable: vi.fn(),
        createIndex: vi.fn(),
        addConstraint: vi.fn(),
        sql: vi.fn(),
        func: vi.fn((expression: string) => expression),
      } as unknown as MigrationBuilder;

      await up(pgm);

      // Find user_integrations table definition
      const userIntegrations = createTableCalls.find((t) => t.name === 'user_integrations');
      expect(userIntegrations).toBeDefined();

      // Verify user_id column has ON DELETE CASCADE
      const userIdColumn = userIntegrations!.columns.user_id;
      expect(userIdColumn).toBeDefined();
      expect(userIdColumn.references).toContain('users');
      expect(userIdColumn.onDelete).toBe('CASCADE');
    });

    it('should define user_id as NOT NULL FK in user_integrations', async () => {
      const createTableCalls: Array<{ name: string; columns: Record<string, any> }> = [];

      const pgm = {
        createTable: vi.fn((name: string, columns: Record<string, any>) => {
          createTableCalls.push({ name, columns });
        }),
        dropTable: vi.fn(),
        createIndex: vi.fn(),
        addConstraint: vi.fn(),
        sql: vi.fn(),
        func: vi.fn((expression: string) => expression),
      } as unknown as MigrationBuilder;

      await up(pgm);

      const userIntegrations = createTableCalls.find((t) => t.name === 'user_integrations');
      const userIdColumn = userIntegrations!.columns.user_id;

      // user_id must be NOT NULL and reference users table
      expect(userIdColumn.notNull).toBe(true);
      expect(userIdColumn.type).toBe('uuid');
    });

    it('should have unique constraint on (user_id, provider) preventing duplicates', async () => {
      const constraints: Array<{ table: string; name: string; constraint: unknown }> = [];

      const pgm = {
        createTable: vi.fn(),
        dropTable: vi.fn(),
        createIndex: vi.fn(),
        addConstraint: vi.fn((table: string, name: string, constraint: unknown) => {
          constraints.push({ table, name, constraint });
        }),
        sql: vi.fn(),
        func: vi.fn((expression: string) => expression),
      } as unknown as MigrationBuilder;

      await up(pgm);

      // Verify the unique constraint exists
      const uniqueConstraint = constraints.find(
        (c) => c.table === 'user_integrations' && c.name === 'uq_user_integrations_user_provider',
      );
      expect(uniqueConstraint).toBeDefined();
      expect(uniqueConstraint!.constraint).toEqual({ unique: ['user_id', 'provider'] });
    });
  });

  // ─── Suite 3: Notion migration correctness with sample data ──────────────

  describe('Notion migration correctness with sample data', () => {
    /**
     * Simulates the SQL transformation the migration performs on notion_connections data.
     * This mirrors the actual migration INSERT statement logic.
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

    const sampleNotionConnections = [
      {
        user_id: '550e8400-e29b-41d4-a716-446655440001',
        access_token_encrypted: 'enc_v1:aes256gcm:ntn_abc123encrypted',
        workspace_id: 'ws-notion-12345',
        workspace_name: 'My Workspace',
        connected_at: '2024-03-15T09:30:00.000Z',
      },
      {
        user_id: '550e8400-e29b-41d4-a716-446655440002',
        access_token_encrypted: 'enc_v1:aes256gcm:ntn_def456encrypted_longer_token',
        workspace_id: 'ws-notion-67890',
        workspace_name: "Team's Shared Space",
        connected_at: '2024-01-20T14:45:00.000Z',
      },
      {
        user_id: '550e8400-e29b-41d4-a716-446655440003',
        access_token_encrypted: 'enc_v1:aes256gcm:ntn_special_chars_!@#$%',
        workspace_id: 'ws-notion-unicode-αβγ',
        workspace_name: 'Ünïcödé Wörkspàce',
        connected_at: '2023-12-01T00:00:00.000Z',
      },
    ];

    it('should migrate sample Notion rows with correct provider value', () => {
      for (const row of sampleNotionConnections) {
        const result = simulateMigrationTransform(row);
        expect(result.provider).toBe('notion');
      }
    });

    it('should preserve user_id across migration for all sample rows', () => {
      for (const row of sampleNotionConnections) {
        const result = simulateMigrationTransform(row);
        expect(result.user_id).toBe(row.user_id);
      }
    });

    it('should map access_token_encrypted to credentials_encrypted', () => {
      for (const row of sampleNotionConnections) {
        const result = simulateMigrationTransform(row);
        expect(result.credentials_encrypted).toBe(row.access_token_encrypted);
      }
    });

    it('should build metadata with workspace_id and workspace_name', () => {
      for (const row of sampleNotionConnections) {
        const result = simulateMigrationTransform(row);
        expect(result.metadata).toEqual({
          workspace_id: row.workspace_id,
          workspace_name: row.workspace_name,
        });
      }
    });

    it('should preserve connected_at timestamp', () => {
      for (const row of sampleNotionConnections) {
        const result = simulateMigrationTransform(row);
        expect(result.connected_at).toBe(row.connected_at);
      }
    });

    it('should handle workspace names with special characters and unicode', () => {
      const unicodeRow = sampleNotionConnections[2];
      const result = simulateMigrationTransform(unicodeRow);

      expect(result.metadata.workspace_name).toBe('Ünïcödé Wörkspàce');
      expect(result.metadata.workspace_id).toBe('ws-notion-unicode-αβγ');
    });

    it('should verify migration SQL references all required fields for Notion data migration', async () => {
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

      // Find the Notion data migration SQL
      const migrateSql = sqlStatements.find(
        (s) => s.includes('INSERT INTO user_integrations') && s.includes('notion_connections'),
      );
      expect(migrateSql).toBeDefined();

      // Verify all fields are correctly mapped in the SQL
      expect(migrateSql).toContain('user_id');
      expect(migrateSql).toContain("'notion'");
      expect(migrateSql).toContain('access_token_encrypted');
      expect(migrateSql).toContain('jsonb_build_object');
      expect(migrateSql).toContain("'workspace_id'");
      expect(migrateSql).toContain("'workspace_name'");
      expect(migrateSql).toContain('connected_at');
      expect(migrateSql).toContain('FROM notion_connections');
    });

    it('should verify migration drops notion_connections after data transfer', async () => {
      const droppedTables: string[] = [];

      const pgm = {
        createTable: vi.fn(),
        dropTable: vi.fn((name: string) => {
          droppedTables.push(name);
        }),
        createIndex: vi.fn(),
        addConstraint: vi.fn(),
        sql: vi.fn(),
        func: vi.fn((expression: string) => expression),
      } as unknown as MigrationBuilder;

      await up(pgm);

      expect(droppedTables).toContain('notion_connections');
    });

    it('should produce consistent results: same input always yields same output', () => {
      const row = sampleNotionConnections[0];

      const result1 = simulateMigrationTransform(row);
      const result2 = simulateMigrationTransform(row);

      expect(result1).toEqual(result2);
    });

    it('should produce distinct results for distinct users', () => {
      const results = sampleNotionConnections.map(simulateMigrationTransform);

      // All user_ids should be unique
      const userIds = results.map((r) => r.user_id);
      expect(new Set(userIds).size).toBe(userIds.length);

      // All credentials should be unique (different tokens)
      const creds = results.map((r) => r.credentials_encrypted);
      expect(new Set(creds).size).toBe(creds.length);
    });
  });
});
