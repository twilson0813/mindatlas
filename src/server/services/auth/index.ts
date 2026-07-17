import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { queryOne } from '../../db/db.js';
import {
  isAccountLocked,
  lockAccount,
  unlockAccount,
  resetFailedAttempts,
  recordFailedAttempt,
} from './lockout.js';

// Re-export lockout utilities for external use
export {
  isAccountLocked,
  lockAccount,
  unlockAccount,
  resetFailedAttempts,
  recordFailedAttempt,
} from './lockout.js';
export type { LockableUser } from './lockout.js';
export { MAX_FAILED_ATTEMPTS, LOCKOUT_DURATION_MS } from './lockout.js';

/**
 * Auth Service
 *
 * Handles user registration, login, token refresh, and password validation.
 * - Passwords are hashed with bcrypt (cost factor 12)
 * - JWT access tokens expire in 15 minutes
 * - JWT refresh tokens expire in 7 days
 */

const BCRYPT_COST_FACTOR = 12;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

export interface User {
  id: string;
  email: string;
  phone_number: string | null;
  is_locked: boolean;
  locked_until: Date | null;
  failed_attempts: number;
  role: string;
  created_at: Date;
  updated_at: Date;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates password complexity rules.
 * Requirements: min 8 chars, uppercase, lowercase, digit, special character.
 */
export function validatePassword(password: string): ValidationResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one digit');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Hashes a password using bcrypt with cost factor 12.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST_FACTOR);
}

/**
 * Verifies a password against a bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generates a JWT access token (15-minute expiry).
 */
export function generateAccessToken(userId: string, email: string, role: string): string {
  return jwt.sign({ sub: userId, email, role }, config.jwtSecret, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}

/**
 * Generates a JWT refresh token (7-day expiry).
 */
export function generateRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, type: 'refresh' }, config.jwtRefreshSecret, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

/**
 * Registers a new user account.
 * Hashes password with bcrypt cost factor 12, inserts into users table.
 * Returns the user without password_hash.
 */
export async function register(email: string, password: string): Promise<User> {
  // Validate password complexity
  const validation = validatePassword(password);
  if (!validation.valid) {
    throw new Error(`Password validation failed: ${validation.errors.join(', ')}`);
  }

  // Check if user already exists
  const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    throw new Error('A user with this email already exists');
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Insert user
  const user = await queryOne<User>(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, $2, 'user')
     RETURNING id, email, phone_number, is_locked, locked_until, failed_attempts, role, created_at, updated_at`,
    [email, passwordHash],
  );

  if (!user) {
    throw new Error('Failed to create user');
  }

  return user;
}

/**
 * Authenticates a user and issues JWT access and refresh tokens.
 * Verifies password with bcrypt, returns token pair on success.
 */
export async function login(email: string, password: string): Promise<TokenPair> {
  // Find user by email
  const user = await queryOne<User & { password_hash: string }>(
    `SELECT id, email, password_hash, phone_number, is_locked, locked_until, failed_attempts, role, created_at, updated_at
     FROM users WHERE email = $1`,
    [email],
  );

  if (!user) {
    throw new Error('Invalid email or password');
  }

  // Check if account is locked
  if (isAccountLocked(user)) {
    throw new Error('Account is locked. Please try again later.');
  }

  // Auto-unlock if lockout period has passed
  if (user.is_locked && !isAccountLocked(user)) {
    await unlockAccount(user.id);
  }

  // Verify password
  const isValid = await verifyPassword(password, user.password_hash);

  if (!isValid) {
    // Record failed attempt (may lock the account)
    await recordFailedAttempt(user.id, user.failed_attempts);
    throw new Error('Invalid email or password');
  }

  // Reset failed attempts on successful login
  if (user.failed_attempts > 0) {
    await resetFailedAttempts(user.id);
  }

  // Generate tokens
  const accessToken = generateAccessToken(user.id, user.email, user.role);
  const refreshToken = generateRefreshToken(user.id);

  return { accessToken, refreshToken };
}

/**
 * Refreshes an access token using a valid refresh token.
 * Verifies the refresh token and issues a new access token.
 */
export async function refresh(refreshToken: string): Promise<{ accessToken: string }> {
  try {
    const payload = jwt.verify(refreshToken, config.jwtRefreshSecret) as {
      sub: string;
      type: string;
    };

    if (payload.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    // Fetch current user info for the new access token
    const user = await queryOne<{ id: string; email: string; role: string }>(
      'SELECT id, email, role FROM users WHERE id = $1',
      [payload.sub],
    );

    if (!user) {
      throw new Error('User not found');
    }

    const accessToken = generateAccessToken(user.id, user.email, user.role);
    return { accessToken };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Refresh token has expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid refresh token');
    }
    throw error;
  }
}
