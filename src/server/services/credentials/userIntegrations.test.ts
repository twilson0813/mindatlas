import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module
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
  })),
}));

import { queryOne } from '../../db/db.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import {
  getUserIntegration,
  setUserIntegration,
  deleteUserIntegration,
  registerProviderSchema,
  getGenericUserIntegration,
  setGenericUserIntegration,
  credentialCache,
  _providerSchemas,
} from './index.js';

const mockQueryOne = vi.mocked(queryOne);
const mockEncrypt = vi.mocked(encrypt);
const mockDecrypt = vi.mocked(decrypt);

describe('User Integration Credential Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentialCache.clear();
    _providerSchemas.clear();
  });

  describe('getUserIntegration', () => {
    it('should return null when no integration exists', async () => {
      mockQueryOne.mockResolvedValue(null);

      const result = await getUserIntegration('user-123', 'notion');

      expect(result).toBeNull();
      expect(mockQueryOne).toHaveBeenCalledWith(
        'SELECT credentials_encrypted, metadata FROM user_integrations WHERE user_id = $1 AND provider = $2',
        ['user-123', 'notion'],
      );
    });

    it('should decrypt and return credentials with metadata from DB', async () => {
      const creds = { accessToken: 'ntn_abc123' };
      const metadata = { workspace_id: 'ws-1', workspace_name: 'My Workspace' };

      mockQueryOne.mockResolvedValue({
        credentials_encrypted: `encrypted:${JSON.stringify(creds)}`,
        metadata,
      });

      const result = await getUserIntegration('user-123', 'notion');

      expect(result).toEqual({ credentials: creds, metadata });
      expect(mockDecrypt).toHaveBeenCalledWith(`encrypted:${JSON.stringify(creds)}`);
    });

    it('should return cached result on subsequent calls', async () => {
      const creds = { accessToken: 'ntn_abc123' };
      mockQueryOne.mockResolvedValue({
        credentials_encrypted: `encrypted:${JSON.stringify(creds)}`,
        metadata: null,
      });

      // First call - DB lookup
      await getUserIntegration('user-123', 'notion');
      // Second call - should use cache
      const result = await getUserIntegration('user-123', 'notion');

      expect(result).toEqual({ credentials: creds, metadata: null });
      expect(mockQueryOne).toHaveBeenCalledTimes(1); // Only one DB call
    });

    it('should use correct cache key format user:userId:provider', async () => {
      mockQueryOne.mockResolvedValue(null);

      await getUserIntegration('user-abc', 'n8n');

      // Verify we can manually seed the cache with the expected key format
      const cachedValue = {
        credentials: { webhookUrl: 'http://test', apiKey: 'key-1' },
        metadata: null,
      };
      credentialCache.set('user:user-abc:n8n', cachedValue);

      // Now the function should return cached
      const result = await getUserIntegration('user-abc', 'n8n');
      expect(result).toEqual(cachedValue);
    });

    it('should return metadata as null when DB row has null metadata', async () => {
      const creds = { webhookUrl: 'http://n8n.local', apiKey: 'key-123' };
      mockQueryOne.mockResolvedValue({
        credentials_encrypted: `encrypted:${JSON.stringify(creds)}`,
        metadata: null,
      });

      const result = await getUserIntegration('user-456', 'n8n');

      expect(result).toEqual({ credentials: creds, metadata: null });
    });
  });

  describe('setUserIntegration', () => {
    it('should encrypt credentials and upsert into DB', async () => {
      mockQueryOne.mockResolvedValue(null);
      const creds = { accessToken: 'ntn_token_xyz' };

      await setUserIntegration('user-123', 'notion', creds);

      expect(mockEncrypt).toHaveBeenCalledWith(JSON.stringify(creds));
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_integrations'),
        ['user-123', 'notion', `encrypted:${JSON.stringify(creds)}`, null],
      );
    });

    it('should pass metadata as JSON string when provided', async () => {
      mockQueryOne.mockResolvedValue(null);
      const creds = { accessToken: 'ntn_token_xyz' };
      const metadata = { workspace_id: 'ws-1' };

      await setUserIntegration('user-123', 'notion', creds, metadata);

      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_integrations'),
        ['user-123', 'notion', `encrypted:${JSON.stringify(creds)}`, JSON.stringify(metadata)],
      );
    });

    it('should invalidate cache after upsert', async () => {
      mockQueryOne.mockResolvedValue(null);

      // Pre-seed cache
      credentialCache.set('user:user-123:notion', {
        credentials: { accessToken: 'old' },
        metadata: null,
      });

      await setUserIntegration('user-123', 'notion', { accessToken: 'new_token' });

      // Cache should be invalidated
      expect(credentialCache.get('user:user-123:notion')).toBeUndefined();
    });

    it('should use ON CONFLICT upsert with COALESCE for metadata', async () => {
      mockQueryOne.mockResolvedValue(null);

      await setUserIntegration('user-123', 'notion', { accessToken: 'tok' });

      const sqlArg = mockQueryOne.mock.calls[0][0];
      expect(sqlArg).toContain('ON CONFLICT (user_id, provider)');
      expect(sqlArg).toContain('COALESCE(EXCLUDED.metadata, user_integrations.metadata)');
    });
  });

  describe('deleteUserIntegration', () => {
    it('should delete the integration from DB', async () => {
      mockQueryOne.mockResolvedValue(null);

      await deleteUserIntegration('user-123', 'notion');

      expect(mockQueryOne).toHaveBeenCalledWith(
        'DELETE FROM user_integrations WHERE user_id = $1 AND provider = $2',
        ['user-123', 'notion'],
      );
    });

    it('should invalidate cache after deletion', async () => {
      mockQueryOne.mockResolvedValue(null);

      // Pre-seed cache
      credentialCache.set('user:user-123:n8n', {
        credentials: { webhookUrl: 'x', apiKey: 'y' },
        metadata: null,
      });

      await deleteUserIntegration('user-123', 'n8n');

      expect(credentialCache.get('user:user-123:n8n')).toBeUndefined();
    });

    it('should not throw if integration does not exist', async () => {
      mockQueryOne.mockResolvedValue(null);

      await expect(deleteUserIntegration('user-999', 'notion')).resolves.not.toThrow();
    });
  });

  describe('registerProviderSchema', () => {
    it('should store a validator for the given provider', () => {
      const validator = (data: unknown) =>
        typeof data === 'object' && data !== null && 'apiKey' in data;

      registerProviderSchema('custom-provider', validator);

      expect(_providerSchemas.get('custom-provider')).toBe(validator);
    });

    it('should allow overwriting an existing schema', () => {
      const v1 = () => true;
      const v2 = () => false;

      registerProviderSchema('my-provider', v1);
      registerProviderSchema('my-provider', v2);

      expect(_providerSchemas.get('my-provider')).toBe(v2);
    });
  });

  describe('getGenericUserIntegration', () => {
    it('should return null when no integration exists', async () => {
      mockQueryOne.mockResolvedValue(null);

      const result = await getGenericUserIntegration('user-123', 'custom-provider');

      expect(result).toBeNull();
    });

    it('should decrypt and return credentials as generic object', async () => {
      const creds = { token: 'abc', endpoint: 'https://api.custom.io' };
      const metadata = { region: 'us-east-1' };

      mockQueryOne.mockResolvedValue({
        credentials_encrypted: `encrypted:${JSON.stringify(creds)}`,
        metadata,
      });

      const result = await getGenericUserIntegration('user-123', 'custom-provider');

      expect(result).toEqual({ credentials: creds, metadata });
    });

    it('should work for unregistered providers', async () => {
      const creds = { key: 'value' };
      mockQueryOne.mockResolvedValue({
        credentials_encrypted: `encrypted:${JSON.stringify(creds)}`,
        metadata: null,
      });

      // No schema registered for 'unknown-provider'
      const result = await getGenericUserIntegration('user-1', 'unknown-provider');

      expect(result).toEqual({ credentials: creds, metadata: null });
    });
  });

  describe('setGenericUserIntegration', () => {
    it('should encrypt and store credentials for any provider', async () => {
      mockQueryOne.mockResolvedValue(null);
      const creds = { apiToken: 'tok_123', url: 'https://hook.example.com' };

      await setGenericUserIntegration('user-123', 'webhooks', creds);

      expect(mockEncrypt).toHaveBeenCalledWith(JSON.stringify(creds));
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_integrations'),
        ['user-123', 'webhooks', `encrypted:${JSON.stringify(creds)}`, null],
      );
    });

    it('should validate against registered schema and pass', async () => {
      mockQueryOne.mockResolvedValue(null);
      const validator = (data: unknown) => {
        const obj = data as Record<string, unknown>;
        return typeof obj.apiKey === 'string';
      };
      registerProviderSchema('validated-provider', validator);

      await expect(
        setGenericUserIntegration('user-1', 'validated-provider', { apiKey: 'key-123' }),
      ).resolves.not.toThrow();
    });

    it('should throw when credentials fail schema validation', async () => {
      const validator = (data: unknown) => {
        const obj = data as Record<string, unknown>;
        return typeof obj.apiKey === 'string' && typeof obj.secret === 'string';
      };
      registerProviderSchema('strict-provider', validator);

      await expect(
        setGenericUserIntegration('user-1', 'strict-provider', { apiKey: 'key-123' }),
      ).rejects.toThrow('Credentials do not match registered schema for provider: strict-provider');
    });

    it('should skip validation when no schema is registered', async () => {
      mockQueryOne.mockResolvedValue(null);

      // No schema registered for 'unregistered'
      await expect(
        setGenericUserIntegration('user-1', 'unregistered', { anything: true }),
      ).resolves.not.toThrow();
    });

    it('should invalidate cache after write', async () => {
      mockQueryOne.mockResolvedValue(null);
      credentialCache.set('user:user-1:my-provider', {
        credentials: { old: true },
        metadata: null,
      });

      await setGenericUserIntegration('user-1', 'my-provider', { new: true });

      expect(credentialCache.get('user:user-1:my-provider')).toBeUndefined();
    });

    it('should pass metadata when provided', async () => {
      mockQueryOne.mockResolvedValue(null);
      const metadata = { label: 'Production' };

      await setGenericUserIntegration('user-1', 'custom', { key: 'val' }, metadata);

      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_integrations'),
        ['user-1', 'custom', expect.any(String), JSON.stringify(metadata)],
      );
    });
  });
});
