import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listUsers,
  disableAccount,
  deleteAccount,
  unlockAccount,
  getSystemMetrics,
  moderateAccount,
  getAuditTrail,
  AdminDataAccess,
  ContentAccessViolationError,
} from './index.js';

// Mock dependencies
vi.mock('../../db/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../../middleware/entitlement.js', () => ({
  invalidateCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../feature-registry/index.js', () => ({
  getAll: vi.fn().mockReturnValue([]),
  isRegistered: vi.fn().mockReturnValue(false),
}));

vi.mock('../../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { query, queryOne, queryMany } from '../../db/db.js';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockQueryMany = vi.mocked(queryMany);

describe('Admin Service - User Management & Content Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── AdminDataAccess Content Isolation ───────────────────────────────────

  describe('AdminDataAccess.validateQuerySafety', () => {
    it('should reject queries containing content_encrypted', () => {
      expect(() =>
        AdminDataAccess.validateQuerySafety(
          'SELECT content_encrypted FROM items'
        )
      ).toThrow(ContentAccessViolationError);
    });

    it('should reject queries containing file_path', () => {
      expect(() =>
        AdminDataAccess.validateQuerySafety(
          'SELECT file_path FROM items WHERE user_id = $1'
        )
      ).toThrow(ContentAccessViolationError);
    });

    it('should reject queries containing content as a standalone field', () => {
      expect(() =>
        AdminDataAccess.validateQuerySafety(
          'SELECT id, content FROM items'
        )
      ).toThrow(ContentAccessViolationError);
    });

    it('should reject queries containing file_data', () => {
      expect(() =>
        AdminDataAccess.validateQuerySafety(
          'SELECT file_data FROM items'
        )
      ).toThrow(ContentAccessViolationError);
    });

    it('should allow queries that do not reference content fields', () => {
      expect(() =>
        AdminDataAccess.validateQuerySafety(
          'SELECT user_id, email, role, is_locked FROM admin_user_summary'
        )
      ).not.toThrow();
    });

    it('should allow queries with substrings (card_count does not match content)', () => {
      expect(() =>
        AdminDataAccess.validateQuerySafety(
          'SELECT card_count, total_storage_used_bytes FROM admin_user_summary'
        )
      ).not.toThrow();
    });

    it('should be case-insensitive when checking', () => {
      expect(() =>
        AdminDataAccess.validateQuerySafety(
          'SELECT CONTENT_ENCRYPTED FROM items'
        )
      ).toThrow(ContentAccessViolationError);
    });
  });

  describe('AdminDataAccess.sanitizeResponse', () => {
    it('should strip content_encrypted from response', () => {
      const obj = { userId: '123', content_encrypted: 'secret', email: 'a@b.com' };
      const result = AdminDataAccess.sanitizeResponse(obj);
      expect(result).not.toHaveProperty('content_encrypted');
      expect(result.email).toBe('a@b.com');
    });

    it('should strip file_path from response', () => {
      const obj = { userId: '123', file_path: '/path/to/file', email: 'a@b.com' };
      const result = AdminDataAccess.sanitizeResponse(obj);
      expect(result).not.toHaveProperty('file_path');
    });

    it('should strip content from response', () => {
      const obj = { userId: '123', content: 'user private text', email: 'a@b.com' };
      const result = AdminDataAccess.sanitizeResponse(obj);
      expect(result).not.toHaveProperty('content');
    });

    it('should return unchanged object when no forbidden fields present', () => {
      const obj = { userId: '123', email: 'a@b.com', role: 'user' };
      const result = AdminDataAccess.sanitizeResponse(obj);
      expect(result).toEqual(obj);
    });
  });

  // ─── ContentAccessViolationError ───────────────────────────────────────────

  describe('ContentAccessViolationError', () => {
    it('should have the correct name and field', () => {
      const error = new ContentAccessViolationError('content_encrypted');
      expect(error.name).toBe('ContentAccessViolationError');
      expect(error.field).toBe('content_encrypted');
      expect(error.message).toContain('content_encrypted');
      expect(error.message).toContain('Admin content isolation violation');
    });

    it('should be an instance of Error', () => {
      const error = new ContentAccessViolationError('file_path');
      expect(error).toBeInstanceOf(Error);
    });
  });

  // ─── listUsers ─────────────────────────────────────────────────────────────

  describe('listUsers', () => {
    it('should return paginated users from admin_user_summary view', async () => {
      mockQueryOne.mockResolvedValueOnce({ total: 2 });
      mockQueryMany.mockResolvedValueOnce([
        {
          user_id: 'u1',
          email: 'alice@test.com',
          role: 'user',
          is_locked: false,
          locked_until: null,
          registration_date: new Date('2024-01-01'),
          updated_at: new Date('2024-06-01'),
          subscription_id: 's1',
          plan_name: 'pro',
          plan_display_name: 'Pro',
          subscription_status: 'active',
          current_period_end: new Date('2024-07-01'),
          card_count: 42,
          total_storage_used_bytes: 10240,
        },
        {
          user_id: 'u2',
          email: 'bob@test.com',
          role: 'user',
          is_locked: true,
          locked_until: new Date('2024-06-15'),
          registration_date: new Date('2024-02-01'),
          updated_at: new Date('2024-06-10'),
          subscription_id: null,
          plan_name: null,
          plan_display_name: null,
          subscription_status: null,
          current_period_end: null,
          card_count: 5,
          total_storage_used_bytes: 0,
        },
      ]);

      const result = await listUsers({ page: 1, pageSize: 25 });

      expect(result.total).toBe(2);
      expect(result.users).toHaveLength(2);
      expect(result.users[0].email).toBe('alice@test.com');
      expect(result.users[0].cardCount).toBe(42);
      expect(result.users[1].isLocked).toBe(true);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
      expect(result.totalPages).toBe(1);
    });

    it('should filter by email', async () => {
      mockQueryOne.mockResolvedValueOnce({ total: 1 });
      mockQueryMany.mockResolvedValueOnce([
        {
          user_id: 'u1',
          email: 'alice@test.com',
          role: 'user',
          is_locked: false,
          locked_until: null,
          registration_date: new Date('2024-01-01'),
          updated_at: new Date('2024-06-01'),
          subscription_id: null,
          plan_name: null,
          plan_display_name: null,
          subscription_status: null,
          current_period_end: null,
          card_count: 0,
          total_storage_used_bytes: 0,
        },
      ]);

      const result = await listUsers({ email: 'alice' });

      const countCall = mockQueryOne.mock.calls[0];
      expect(countCall[0]).toContain('ILIKE');
      expect(countCall[1]).toContain('%alice%');
      expect(result.users).toHaveLength(1);
    });

    it('should filter by locked status', async () => {
      mockQueryOne.mockResolvedValueOnce({ total: 0 });
      mockQueryMany.mockResolvedValueOnce([]);

      await listUsers({ status: 'locked' });

      const countCall = mockQueryOne.mock.calls[0];
      expect(countCall[0]).toContain('is_locked = true');
    });

    it('should never query content_encrypted fields', async () => {
      mockQueryOne.mockResolvedValueOnce({ total: 0 });
      mockQueryMany.mockResolvedValueOnce([]);

      await listUsers();

      const allCalls = [...mockQueryOne.mock.calls, ...mockQueryMany.mock.calls];
      for (const call of allCalls) {
        const sql = call[0] as string;
        expect(sql).not.toContain('content_encrypted');
        expect(sql).not.toContain('file_path');
      }
    });

    it('should default to page 1 and pageSize 25', async () => {
      mockQueryOne.mockResolvedValueOnce({ total: 0 });
      mockQueryMany.mockResolvedValueOnce([]);

      const result = await listUsers();

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
    });
  });

  // ─── disableAccount ────────────────────────────────────────────────────────

  describe('disableAccount', () => {
    it('should lock the user account', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockQueryOne.mockResolvedValue(null);

      await disableAccount('admin1', 'user1', 'Policy violation');

      const updateCall = mockQuery.mock.calls[0];
      expect(updateCall[0]).toContain('UPDATE users');
      expect(updateCall[0]).toContain('is_locked = true');
      expect(updateCall[1]).toContain('user1');
    });

    it('should write an audit log entry', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockQueryOne.mockResolvedValue(null);

      await disableAccount('admin1', 'user1', 'Spam');

      // Audit log is written via queryOne (logAuditEntry)
      const auditCall = mockQueryOne.mock.calls[0];
      expect(auditCall[0]).toContain('INSERT INTO audit_log');
      expect(auditCall[1]).toContain('admin1');
      expect(auditCall[1]).toContain('disable_account');
      expect(auditCall[1]).toContain('user1');
    });

    it('should not access content fields', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockQueryOne.mockResolvedValue(null);

      await disableAccount('admin1', 'user1', 'Test');

      for (const call of mockQuery.mock.calls) {
        const sql = call[0] as string;
        expect(sql).not.toContain('content_encrypted');
        expect(sql).not.toContain('file_path');
      }
    });
  });

  // ─── deleteAccount ─────────────────────────────────────────────────────────

  describe('deleteAccount', () => {
    it('should soft-delete user items and lock the account', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockQueryOne.mockResolvedValue(null);

      await deleteAccount('admin1', 'user1', 'User requested deletion');

      // First call: soft-delete items
      const itemCall = mockQuery.mock.calls[0];
      expect(itemCall[0]).toContain('UPDATE items');
      expect(itemCall[0]).toContain('is_deleted = true');
      expect(itemCall[1]).toContain('user1');

      // Second call: lock account
      const userCall = mockQuery.mock.calls[1];
      expect(userCall[0]).toContain('UPDATE users');
      expect(userCall[0]).toContain('is_locked = true');
    });

    it('should write an audit log entry', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockQueryOne.mockResolvedValue(null);

      await deleteAccount('admin1', 'user1', 'Requested');

      const auditCall = mockQueryOne.mock.calls[0];
      expect(auditCall[0]).toContain('INSERT INTO audit_log');
      expect(auditCall[1]).toContain('delete_account');
    });

    it('should not access content fields during deletion', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockQueryOne.mockResolvedValue(null);

      await deleteAccount('admin1', 'user1', 'Test');

      for (const call of mockQuery.mock.calls) {
        const sql = call[0] as string;
        expect(sql).not.toContain('content_encrypted');
        expect(sql).not.toContain('file_path');
      }
    });
  });

  // ─── unlockAccount ─────────────────────────────────────────────────────────

  describe('unlockAccount', () => {
    it('should unlock the account and reset failed attempts', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockQueryOne.mockResolvedValue(null);

      await unlockAccount('admin1', 'user1');

      const updateCall = mockQuery.mock.calls[0];
      expect(updateCall[0]).toContain('is_locked = false');
      expect(updateCall[0]).toContain('failed_attempts = 0');
      expect(updateCall[1]).toContain('user1');
    });

    it('should write an audit log entry', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockQueryOne.mockResolvedValue(null);

      await unlockAccount('admin1', 'user1');

      const auditCall = mockQueryOne.mock.calls[0];
      expect(auditCall[0]).toContain('INSERT INTO audit_log');
      expect(auditCall[1]).toContain('unlock_account');
    });
  });

  // ─── getSystemMetrics ──────────────────────────────────────────────────────

  describe('getSystemMetrics', () => {
    it('should return aggregated metrics', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ count: 100 })  // totalUsers
        .mockResolvedValueOnce({ count: 25 })   // activeDaily
        .mockResolvedValueOnce({ count: 60 })   // activeWeekly
        .mockResolvedValueOnce({ count: 80 })   // activeMonthly
        .mockResolvedValueOnce({ count: 5000 }) // totalCards
        .mockResolvedValueOnce({ count: 200 })  // apiVolume24h
        .mockResolvedValueOnce({ count: 1200 }) // apiVolume7d
        .mockResolvedValueOnce({ count: 3 })    // errors24h
        .mockResolvedValueOnce({ count: 15 });  // errors7d

      const metrics = await getSystemMetrics();

      expect(metrics.totalUsers).toBe(100);
      expect(metrics.activeUsersDaily).toBe(25);
      expect(metrics.activeUsersWeekly).toBe(60);
      expect(metrics.activeUsersMonthly).toBe(80);
      expect(metrics.totalCards).toBe(5000);
      expect(metrics.apiRequestVolume.last24h).toBe(200);
      expect(metrics.apiRequestVolume.last7d).toBe(1200);
      expect(metrics.aiQueueDepth).toBe(0);
      expect(metrics.errorRates.last24h).toBe(3);
      expect(metrics.errorRates.last7d).toBe(15);
    });

    it('should return zeros when no data exists', async () => {
      mockQueryOne.mockResolvedValue(null);

      const metrics = await getSystemMetrics();

      expect(metrics.totalUsers).toBe(0);
      expect(metrics.activeUsersDaily).toBe(0);
      expect(metrics.totalCards).toBe(0);
    });

    it('should not query content fields in any metrics query', async () => {
      mockQueryOne.mockResolvedValue({ count: 0 });

      await getSystemMetrics();

      for (const call of mockQueryOne.mock.calls) {
        const sql = call[0] as string;
        expect(sql).not.toContain('content_encrypted');
        expect(sql).not.toContain('file_path');
      }
    });
  });

  // ─── moderateAccount ───────────────────────────────────────────────────────

  describe('moderateAccount', () => {
    it('should disable account when action is disable', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockQueryOne.mockResolvedValue(null);

      await moderateAccount('admin1', 'user1', 'disable');

      const updateCall = mockQuery.mock.calls[0];
      expect(updateCall[0]).toContain('UPDATE users');
      expect(updateCall[0]).toContain('is_locked = true');
    });

    it('should write audit log for flag action without modifying user', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockQueryOne.mockResolvedValue(null);

      await moderateAccount('admin1', 'user1', 'flag');

      // No UPDATE call on users — only audit log via queryOne
      expect(mockQuery.mock.calls).toHaveLength(0);
      const auditCall = mockQueryOne.mock.calls[0];
      expect(auditCall[0]).toContain('INSERT INTO audit_log');
      expect(auditCall[1]).toContain('moderate_flag');
    });

    it('should write audit log for unflag action without modifying user', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockQueryOne.mockResolvedValue(null);

      await moderateAccount('admin1', 'user1', 'unflag');

      expect(mockQuery.mock.calls).toHaveLength(0);
      const auditCall = mockQueryOne.mock.calls[0];
      expect(auditCall[1]).toContain('moderate_unflag');
    });

    it('should not access content fields during moderation', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);
      mockQueryOne.mockResolvedValue(null);

      await moderateAccount('admin1', 'user1', 'disable');

      for (const call of mockQuery.mock.calls) {
        const sql = call[0] as string;
        expect(sql).not.toContain('content_encrypted');
        expect(sql).not.toContain('file_path');
      }
    });
  });

  // ─── getAuditTrail ─────────────────────────────────────────────────────────

  describe('getAuditTrail', () => {
    it('should return paginated audit entries', async () => {
      mockQueryOne.mockResolvedValueOnce({ total: 2 });
      mockQueryMany.mockResolvedValueOnce([
        {
          id: 'a1',
          admin_user_id: 'admin1',
          action: 'disable_account',
          target_type: 'user',
          target_id: 'user1',
          details: { reason: 'Spam' },
          created_at: new Date('2024-06-01'),
        },
        {
          id: 'a2',
          admin_user_id: 'admin1',
          action: 'unlock_account',
          target_type: 'user',
          target_id: 'user2',
          details: {},
          created_at: new Date('2024-06-02'),
        },
      ]);

      const result = await getAuditTrail({ page: 1, pageSize: 50 });

      expect(result.total).toBe(2);
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].action).toBe('disable_account');
      expect(result.entries[0].adminUserId).toBe('admin1');
      expect(result.entries[1].targetId).toBe('user2');
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });

    it('should filter by action', async () => {
      mockQueryOne.mockResolvedValueOnce({ total: 0 });
      mockQueryMany.mockResolvedValueOnce([]);

      await getAuditTrail({ action: 'disable_account' });

      const countCall = mockQueryOne.mock.calls[0];
      expect(countCall[0]).toContain('action = $');
      expect(countCall[1]).toContain('disable_account');
    });

    it('should filter by date range', async () => {
      mockQueryOne.mockResolvedValueOnce({ total: 0 });
      mockQueryMany.mockResolvedValueOnce([]);

      const start = new Date('2024-01-01');
      const end = new Date('2024-06-01');
      await getAuditTrail({ startDate: start, endDate: end });

      const countCall = mockQueryOne.mock.calls[0];
      expect(countCall[0]).toContain('created_at >=');
      expect(countCall[0]).toContain('created_at <=');
    });

    it('should filter by target type', async () => {
      mockQueryOne.mockResolvedValueOnce({ total: 0 });
      mockQueryMany.mockResolvedValueOnce([]);

      await getAuditTrail({ targetType: 'user' });

      const countCall = mockQueryOne.mock.calls[0];
      expect(countCall[0]).toContain('target_type = $');
      expect(countCall[1]).toContain('user');
    });

    it('should default to page 1 and pageSize 50', async () => {
      mockQueryOne.mockResolvedValueOnce({ total: 0 });
      mockQueryMany.mockResolvedValueOnce([]);

      const result = await getAuditTrail();

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });
  });
});
