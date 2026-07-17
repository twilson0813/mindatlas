import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getPlatformCredentials,
  getOpenAICredentials,
  getTwilioCredentials,
  getStripeCredentials,
  setPlatformCredentials,
  credentialCache,
} from './index.js';

// Mock the DB module
vi.mock('../../db/db.js', () => ({
  queryOne: vi.fn(),
}));

// Mock the encryption module
vi.mock('../../utils/encryption.js', () => ({
  encrypt: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
  decrypt: vi.fn((encrypted: string) => encrypted.replace('encrypted:', '')),
}));

// Mock the logger module
vi.mock('../../logger.js', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { queryOne } from '../../db/db.js';
import { encrypt, decrypt } from '../../utils/encryption.js';

const mockQueryOne = vi.mocked(queryOne);
const mockEncrypt = vi.mocked(encrypt);
const mockDecrypt = vi.mocked(decrypt);

describe('Platform Credential Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentialCache.clear();
  });

  describe('getPlatformCredentials', () => {
    it('should return cached credentials if available', async () => {
      const creds = { apiKey: 'sk-test-123' };
      credentialCache.set('platform:openai', creds);

      const result = await getPlatformCredentials('openai');

      expect(result).toEqual(creds);
      expect(mockQueryOne).not.toHaveBeenCalled();
    });

    it('should query DB and decrypt when cache is empty', async () => {
      const creds = { apiKey: 'sk-test-456' };
      const encryptedPayload = `encrypted:${JSON.stringify(creds)}`;

      mockQueryOne.mockResolvedValueOnce({ credentials_encrypted: encryptedPayload });
      mockDecrypt.mockReturnValueOnce(JSON.stringify(creds));

      const result = await getPlatformCredentials('openai');

      expect(result).toEqual(creds);
      expect(mockQueryOne).toHaveBeenCalledWith(
        'SELECT credentials_encrypted FROM platform_credentials WHERE provider = $1',
        ['openai'],
      );
      expect(mockDecrypt).toHaveBeenCalledWith(encryptedPayload);
    });

    it('should cache credentials after DB read', async () => {
      const creds = { apiKey: 'sk-test-789' };
      mockQueryOne.mockResolvedValueOnce({
        credentials_encrypted: 'encrypted-blob',
      });
      mockDecrypt.mockReturnValueOnce(JSON.stringify(creds));

      await getPlatformCredentials('openai');

      // Second call should use cache
      const result = await getPlatformCredentials('openai');
      expect(result).toEqual(creds);
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
    });

    it('should throw descriptive error if provider not configured', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(getPlatformCredentials('openai')).rejects.toThrow(
        'Platform credentials not configured for provider: openai',
      );
    });

    it('should throw error containing the provider name for twilio', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(getPlatformCredentials('twilio')).rejects.toThrow(
        'Platform credentials not configured for provider: twilio',
      );
    });

    it('should throw error containing the provider name for stripe', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(getPlatformCredentials('stripe')).rejects.toThrow(
        'Platform credentials not configured for provider: stripe',
      );
    });
  });

  describe('getOpenAICredentials', () => {
    it('should return OpenAI credentials with apiKey field', async () => {
      const creds = { apiKey: 'sk-openai-key' };
      mockQueryOne.mockResolvedValueOnce({
        credentials_encrypted: 'encrypted-blob',
      });
      mockDecrypt.mockReturnValueOnce(JSON.stringify(creds));

      const result = await getOpenAICredentials();

      expect(result).toEqual({ apiKey: 'sk-openai-key' });
    });
  });

  describe('getTwilioCredentials', () => {
    it('should return Twilio credentials with accountSid, authToken, and phoneNumber', async () => {
      const creds = {
        accountSid: 'AC123',
        authToken: 'auth-token-456',
        phoneNumber: '+15551234567',
      };
      mockQueryOne.mockResolvedValueOnce({
        credentials_encrypted: 'encrypted-blob',
      });
      mockDecrypt.mockReturnValueOnce(JSON.stringify(creds));

      const result = await getTwilioCredentials();

      expect(result).toEqual(creds);
    });
  });

  describe('getStripeCredentials', () => {
    it('should return Stripe credentials with secretKey and webhookSecret', async () => {
      const creds = {
        secretKey: 'sk_test_stripe',
        webhookSecret: 'whsec_stripe',
      };
      mockQueryOne.mockResolvedValueOnce({
        credentials_encrypted: 'encrypted-blob',
      });
      mockDecrypt.mockReturnValueOnce(JSON.stringify(creds));

      const result = await getStripeCredentials();

      expect(result).toEqual(creds);
    });
  });

  describe('setPlatformCredentials', () => {
    it('should encrypt credentials and call upsert query', async () => {
      const creds = { apiKey: 'sk-new-key' };
      mockEncrypt.mockReturnValueOnce('encrypted-result');
      mockQueryOne.mockResolvedValueOnce(null);

      await setPlatformCredentials('openai', creds);

      expect(mockEncrypt).toHaveBeenCalledWith(JSON.stringify(creds));
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO platform_credentials'),
        ['openai', 'encrypted-result'],
      );
    });

    it('should use ON CONFLICT upsert pattern', async () => {
      const creds = { secretKey: 'sk_test', webhookSecret: 'whsec_test' };
      mockEncrypt.mockReturnValueOnce('encrypted-stripe');
      mockQueryOne.mockResolvedValueOnce(null);

      await setPlatformCredentials('stripe', creds);

      expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (provider)'), [
        'stripe',
        'encrypted-stripe',
      ]);
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining(
          'DO UPDATE SET credentials_encrypted = EXCLUDED.credentials_encrypted, updated_at = NOW()',
        ),
        expect.any(Array),
      );
    });

    it('should invalidate cache for the affected provider', async () => {
      // Pre-populate cache
      credentialCache.set('platform:openai', { apiKey: 'old-key' });
      mockEncrypt.mockReturnValueOnce('encrypted-new');
      mockQueryOne.mockResolvedValueOnce(null);

      await setPlatformCredentials('openai', { apiKey: 'new-key' });

      // Cache should be invalidated
      expect(credentialCache.get('platform:openai')).toBeUndefined();
    });

    it('should not invalidate cache for other providers', async () => {
      credentialCache.set('platform:twilio', {
        accountSid: 'AC1',
        authToken: 'tok',
        phoneNumber: '+1',
      });
      mockEncrypt.mockReturnValueOnce('encrypted-new');
      mockQueryOne.mockResolvedValueOnce(null);

      await setPlatformCredentials('openai', { apiKey: 'new-key' });

      // Twilio cache should remain
      expect(credentialCache.get('platform:twilio')).toEqual({
        accountSid: 'AC1',
        authToken: 'tok',
        phoneNumber: '+1',
      });
    });
  });
});
