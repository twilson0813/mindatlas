import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validatePassword,
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  register,
  login,
  refresh,
} from './index.js';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';

// Mock the database module
vi.mock('../../db/db.js', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  query: vi.fn(),
}));

import { queryOne } from '../../db/db.js';
const mockQueryOne = vi.mocked(queryOne);

describe('Auth Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validatePassword', () => {
    it('should accept a valid password meeting all criteria', () => {
      const result = validatePassword('Str0ng!Pass');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject password shorter than 8 characters', () => {
      const result = validatePassword('Ab1!xyz');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters long');
    });

    it('should reject password without uppercase letter', () => {
      const result = validatePassword('str0ng!pass');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one uppercase letter');
    });

    it('should reject password without lowercase letter', () => {
      const result = validatePassword('STR0NG!PASS');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one lowercase letter');
    });

    it('should reject password without digit', () => {
      const result = validatePassword('Strong!Pass');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one digit');
    });

    it('should reject password without special character', () => {
      const result = validatePassword('Str0ngPass');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one special character');
    });

    it('should report multiple errors for a completely invalid password', () => {
      const result = validatePassword('abc');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });

    it('should accept password with exactly 8 characters meeting all rules', () => {
      const result = validatePassword('Ab1!cdef');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('hashPassword', () => {
    it('should produce a valid bcrypt hash', async () => {
      const hash = await hashPassword('TestPass1!');
      expect(hash).toMatch(/^\$2[aby]?\$\d{2}\$/);
    });

    it('should use cost factor 12', async () => {
      const hash = await hashPassword('TestPass1!');
      // bcrypt hash format: $2b$12$...
      expect(hash).toContain('$12$');
    });

    it('should produce different hashes for same password (salt)', async () => {
      const hash1 = await hashPassword('TestPass1!');
      const hash2 = await hashPassword('TestPass1!');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyPassword', () => {
    it('should return true for correct password', async () => {
      const hash = await hashPassword('TestPass1!');
      const result = await verifyPassword('TestPass1!', hash);
      expect(result).toBe(true);
    });

    it('should return false for incorrect password', async () => {
      const hash = await hashPassword('TestPass1!');
      const result = await verifyPassword('WrongPass1!', hash);
      expect(result).toBe(false);
    });
  });

  describe('generateAccessToken', () => {
    it('should generate a valid JWT with correct claims', () => {
      const token = generateAccessToken('user-123', 'test@example.com', 'user');
      const decoded = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;

      expect(decoded.sub).toBe('user-123');
      expect(decoded.email).toBe('test@example.com');
      expect(decoded.role).toBe('user');
      expect(decoded.exp).toBeDefined();
    });

    it('should expire in approximately 15 minutes', () => {
      const token = generateAccessToken('user-123', 'test@example.com', 'user');
      const decoded = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;

      const now = Math.floor(Date.now() / 1000);
      const fifteenMinutes = 15 * 60;
      // Allow 5 seconds tolerance
      expect(decoded.exp! - now).toBeGreaterThan(fifteenMinutes - 5);
      expect(decoded.exp! - now).toBeLessThanOrEqual(fifteenMinutes);
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a valid JWT with refresh type', () => {
      const token = generateRefreshToken('user-123');
      const decoded = jwt.verify(token, config.jwtRefreshSecret) as jwt.JwtPayload;

      expect(decoded.sub).toBe('user-123');
      expect(decoded.type).toBe('refresh');
      expect(decoded.exp).toBeDefined();
    });

    it('should expire in approximately 7 days', () => {
      const token = generateRefreshToken('user-123');
      const decoded = jwt.verify(token, config.jwtRefreshSecret) as jwt.JwtPayload;

      const now = Math.floor(Date.now() / 1000);
      const sevenDays = 7 * 24 * 60 * 60;
      // Allow 5 seconds tolerance
      expect(decoded.exp! - now).toBeGreaterThan(sevenDays - 5);
      expect(decoded.exp! - now).toBeLessThanOrEqual(sevenDays);
    });
  });

  describe('register', () => {
    it('should create a new user with hashed password', async () => {
      const mockUser = {
        id: 'uuid-123',
        email: 'test@example.com',
        phone_number: null,
        is_locked: false,
        locked_until: null,
        failed_attempts: 0,
        role: 'user',
        created_at: new Date(),
        updated_at: new Date(),
      };

      // First call: check existing user (return null)
      mockQueryOne.mockResolvedValueOnce(null);
      // Second call: insert user
      mockQueryOne.mockResolvedValueOnce(mockUser);

      const user = await register('test@example.com', 'ValidPass1!');

      expect(user).toEqual(mockUser);
      expect(mockQueryOne).toHaveBeenCalledTimes(2);
      // Verify the INSERT was called with a bcrypt hash
      const insertCall = mockQueryOne.mock.calls[1];
      expect(insertCall[0]).toContain('INSERT INTO "user"');
      expect(insertCall[1]![0]).toBe('test@example.com');
      // The second param should be a bcrypt hash
      expect(insertCall[1]![1] as string).toMatch(/^\$2[aby]?\$12\$/);
    });

    it('should throw if email already exists', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'existing-id' });

      await expect(register('existing@example.com', 'ValidPass1!')).rejects.toThrow(
        'A user with this email already exists',
      );
    });

    it('should throw if password does not meet complexity rules', async () => {
      await expect(register('test@example.com', 'weak')).rejects.toThrow(
        'Password validation failed',
      );
    });
  });

  describe('login', () => {
    const createMockUser = (overrides = {}) => ({
      id: 'uuid-123',
      email: 'test@example.com',
      password_hash: '', // Will be set in test
      phone_number: null,
      is_locked: false,
      locked_until: null,
      failed_attempts: 0,
      role: 'user',
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    });

    it('should return access and refresh tokens on successful login', async () => {
      const hash = await hashPassword('ValidPass1!');
      mockQueryOne.mockResolvedValueOnce(createMockUser({ password_hash: hash }));
      // Reset failed attempts call (won't happen since failed_attempts is 0)

      const result = await login('test@example.com', 'ValidPass1!');

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();

      // Verify access token
      const decoded = jwt.verify(result.accessToken, config.jwtSecret) as jwt.JwtPayload;
      expect(decoded.sub).toBe('uuid-123');
      expect(decoded.email).toBe('test@example.com');
    });

    it('should throw error for non-existent user', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(login('nonexistent@example.com', 'ValidPass1!')).rejects.toThrow(
        'Invalid email or password',
      );
    });

    it('should throw error for wrong password', async () => {
      const hash = await hashPassword('CorrectPass1!');
      mockQueryOne.mockResolvedValueOnce(createMockUser({ password_hash: hash }));
      mockQueryOne.mockResolvedValueOnce(null); // Update failed_attempts

      await expect(login('test@example.com', 'WrongPass1!')).rejects.toThrow(
        'Invalid email or password',
      );
    });

    it('should throw error for locked account within lockout period', async () => {
      const futureDate = new Date(Date.now() + 10 * 60 * 1000); // 10 min from now
      const hash = await hashPassword('ValidPass1!');
      mockQueryOne.mockResolvedValueOnce(
        createMockUser({
          password_hash: hash,
          is_locked: true,
          locked_until: futureDate,
        }),
      );

      await expect(login('test@example.com', 'ValidPass1!')).rejects.toThrow('Account is locked');
    });

    it('should reset failed attempts on successful login', async () => {
      const hash = await hashPassword('ValidPass1!');
      mockQueryOne.mockResolvedValueOnce(
        createMockUser({ password_hash: hash, failed_attempts: 3 }),
      );
      mockQueryOne.mockResolvedValueOnce(null); // Reset failed attempts

      await login('test@example.com', 'ValidPass1!');

      // Verify reset query was called
      const resetCall = mockQueryOne.mock.calls[1];
      expect(resetCall[0]).toContain('failed_attempts = 0');
    });
  });

  describe('refresh', () => {
    it('should return a new access token for a valid refresh token', async () => {
      const refreshToken = generateRefreshToken('user-123');
      mockQueryOne.mockResolvedValueOnce({
        id: 'user-123',
        email: 'test@example.com',
        role: 'user',
      });

      const result = await refresh(refreshToken);

      expect(result.accessToken).toBeDefined();
      const decoded = jwt.verify(result.accessToken, config.jwtSecret) as jwt.JwtPayload;
      expect(decoded.sub).toBe('user-123');
    });

    it('should throw for an expired refresh token', async () => {
      // Create a token that has already expired
      const expiredToken = jwt.sign({ sub: 'user-123', type: 'refresh' }, config.jwtRefreshSecret, {
        expiresIn: '-1s',
      });

      await expect(refresh(expiredToken)).rejects.toThrow('Refresh token has expired');
    });

    it('should throw for an invalid token', async () => {
      await expect(refresh('invalid.token.here')).rejects.toThrow('Invalid refresh token');
    });

    it('should throw for a token signed with wrong secret', async () => {
      const badToken = jwt.sign({ sub: 'user-123', type: 'refresh' }, 'wrong-secret', {
        expiresIn: '7d',
      });

      await expect(refresh(badToken)).rejects.toThrow('Invalid refresh token');
    });

    it('should throw if user no longer exists', async () => {
      const refreshToken = generateRefreshToken('deleted-user');
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(refresh(refreshToken)).rejects.toThrow('User not found');
    });
  });
});
