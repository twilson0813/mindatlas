import { queryOne } from '../../db/db.js';

/**
 * Account Lockout Module
 *
 * Encapsulates the account lockout mechanism:
 * - Tracks failed login attempts per user
 * - Locks account for 15 minutes after 5 consecutive failures
 * - Auto-unlocks when lockout period expires
 * - Resets failed attempts on successful login
 *
 * Requirements: 1.5
 */

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export interface LockableUser {
  id: string;
  is_locked: boolean;
  locked_until: Date | null;
  failed_attempts: number;
}

/**
 * Checks whether a user account is currently locked.
 * An account is locked if `is_locked` is true AND the lockout period has not yet expired.
 * If the lockout period has passed, the account is considered unlocked (auto-unlock).
 */
export function isAccountLocked(user: LockableUser): boolean {
  if (!user.is_locked) {
    return false;
  }

  // If locked_until is null but is_locked is true, treat as locked indefinitely
  if (!user.locked_until) {
    return true;
  }

  // Check if lockout period has expired
  return new Date() < new Date(user.locked_until);
}

/**
 * Locks a user account for 15 minutes.
 * Sets is_locked to true and locked_until to current time + 15 minutes.
 */
export async function lockAccount(userId: string): Promise<void> {
  const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
  await queryOne(
    `UPDATE "user" SET is_locked = true, locked_until = $1 WHERE id = $2`,
    [lockUntil, userId]
  );
}

/**
 * Unlocks a user account by resetting lock status and failed attempt counter.
 * Called when the lockout period has passed and the user attempts to log in again.
 */
export async function unlockAccount(userId: string): Promise<void> {
  await queryOne(
    `UPDATE "user" SET is_locked = false, locked_until = NULL, failed_attempts = 0 WHERE id = $1`,
    [userId]
  );
}

/**
 * Resets the failed login attempts counter for a user.
 * Called after a successful login.
 */
export async function resetFailedAttempts(userId: string): Promise<void> {
  await queryOne(
    `UPDATE "user" SET failed_attempts = 0 WHERE id = $1`,
    [userId]
  );
}

/**
 * Records a failed login attempt for a user.
 * If the number of failed attempts reaches the threshold (5),
 * the account is automatically locked for 15 minutes.
 *
 * Returns true if the account was locked as a result of this failure.
 */
export async function recordFailedAttempt(userId: string, currentFailedAttempts: number): Promise<boolean> {
  const newAttempts = currentFailedAttempts + 1;

  if (newAttempts >= MAX_FAILED_ATTEMPTS) {
    // Lock the account
    const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
    await queryOne(
      `UPDATE "user" SET failed_attempts = $1, is_locked = true, locked_until = $2 WHERE id = $3`,
      [newAttempts, lockUntil, userId]
    );
    return true;
  }

  // Just increment the counter
  await queryOne(
    `UPDATE "user" SET failed_attempts = $1 WHERE id = $2`,
    [newAttempts, userId]
  );
  return false;
}
