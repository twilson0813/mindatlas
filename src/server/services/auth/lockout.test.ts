import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isAccountLocked,
  lockAccount,
  unlockAccount,
  resetFailedAttempts,
  recordFailedAttempt,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  LockableUser,
} from './lockout.js';

// Mock the database module
vi.mock('../../db/db.js', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  query: vi.fn(),
}));

import { queryOne } from '../../db/db.js';
const mockQueryOne = vi.mocked(queryOne);

describe('Account Lockout Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constants', () => {
    it('should lock after 5 failed attempts', () => {
      expect(MAX_FAILED_ATTEMPTS).toBe(5);
    });

    it('should lock for 15 minutes', () => {
      expect(LOCKOUT_DURATION_MS).toBe(15 * 60 * 1000);
    });
  });

  describe('isAccountLocked', () => {
    it('should return false for an unlocked account', () => {
      const user: LockableUser = {
        id: 'user-1',
        is_locked: false,
        locked_until: null,
        failed_attempts: 0,
      };
      expect(isAccountLocked(user)).toBe(false);
    });

    it('should return true for a locked account within lockout period', () => {
      const futureDate = new Date(Date.now() + 10 * 60 * 1000); // 10 min from now
      const user: LockableUser = {
        id: 'user-1',
        is_locked: true,
        locked_until: futureDate,
        failed_attempts: 5,
      };
      expect(isAccountLocked(user)).toBe(true);
    });

    it('should return false for a locked account whose lockout period has expired', () => {
      const pastDate = new Date(Date.now() - 1 * 60 * 1000); // 1 min ago
      const user: LockableUser = {
        id: 'user-1',
        is_locked: true,
        locked_until: pastDate,
        failed_attempts: 5,
      };
      expect(isAccountLocked(user)).toBe(false);
    });

    it('should return true for a locked account with no locked_until (locked indefinitely)', () => {
      const user: LockableUser = {
        id: 'user-1',
        is_locked: true,
        locked_until: null,
        failed_attempts: 5,
      };
      expect(isAccountLocked(user)).toBe(true);
    });

    it('should return false when is_locked is false even with a future locked_until', () => {
      const futureDate = new Date(Date.now() + 10 * 60 * 1000);
      const user: LockableUser = {
        id: 'user-1',
        is_locked: false,
        locked_until: futureDate,
        failed_attempts: 3,
      };
      expect(isAccountLocked(user)).toBe(false);
    });
  });

  describe('lockAccount', () => {
    it('should update user to locked state with 15-minute expiry', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const before = Date.now();
      await lockAccount('user-123');
      const after = Date.now();

      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain('is_locked = true');
      expect(sql).toContain('locked_until');

      // Verify the lock duration is ~15 minutes from now
      const lockUntil = params![0] as Date;
      const lockTime = lockUntil.getTime();
      expect(lockTime).toBeGreaterThanOrEqual(before + LOCKOUT_DURATION_MS);
      expect(lockTime).toBeLessThanOrEqual(after + LOCKOUT_DURATION_MS);

      // Verify user ID is passed
      expect(params![1]).toBe('user-123');
    });
  });

  describe('unlockAccount', () => {
    it('should reset lock status and failed attempts', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await unlockAccount('user-456');

      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain('is_locked = false');
      expect(sql).toContain('locked_until = NULL');
      expect(sql).toContain('failed_attempts = 0');
      expect(params![0]).toBe('user-456');
    });
  });

  describe('resetFailedAttempts', () => {
    it('should set failed_attempts to 0', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await resetFailedAttempts('user-789');

      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain('failed_attempts = 0');
      expect(params![0]).toBe('user-789');
    });
  });

  describe('recordFailedAttempt', () => {
    it('should increment failed attempts without locking when under threshold', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const locked = await recordFailedAttempt('user-1', 2);

      expect(locked).toBe(false);
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain('failed_attempts = $1');
      expect(sql).not.toContain('is_locked = true');
      expect(params![0]).toBe(3); // 2 + 1
      expect(params![1]).toBe('user-1');
    });

    it('should lock account when reaching threshold (5th failure)', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const locked = await recordFailedAttempt('user-1', 4);

      expect(locked).toBe(true);
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain('is_locked = true');
      expect(sql).toContain('locked_until');
      expect(params![0]).toBe(5); // 4 + 1
    });

    it('should lock account when already over threshold', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const locked = await recordFailedAttempt('user-1', 7);

      expect(locked).toBe(true);
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain('is_locked = true');
      expect(params![0]).toBe(8); // 7 + 1
    });

    it('should not lock on the 4th failure (under threshold)', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const locked = await recordFailedAttempt('user-1', 3);

      expect(locked).toBe(false);
      const [sql] = mockQueryOne.mock.calls[0];
      expect(sql).not.toContain('is_locked = true');
    });

    it('should set lockout duration to 15 minutes when locking', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const before = Date.now();
      await recordFailedAttempt('user-1', 4);
      const after = Date.now();

      const [, params] = mockQueryOne.mock.calls[0];
      const lockUntil = params![1] as Date;
      expect(lockUntil.getTime()).toBeGreaterThanOrEqual(before + LOCKOUT_DURATION_MS);
      expect(lockUntil.getTime()).toBeLessThanOrEqual(after + LOCKOUT_DURATION_MS);
    });
  });
});
