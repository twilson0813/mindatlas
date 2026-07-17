import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// Mock the DB module
vi.mock('../../db/db.js', () => ({
  queryOne: vi.fn(),
}));

// Mock the encryption module with passthrough behavior
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
import {
  getPlatformCredentials,
  setPlatformCredentials,
  getUserIntegration,
  setUserIntegration,
  setGenericUserIntegration,
  getGenericUserIntegration,
  credentialCache,
} from './index.js';

const mockQueryOne = vi.mocked(queryOne);

/**
 * Property 6: Cache invalidation on credential update
 *
 * For any provider and two distinct credential payloads A and B, if credentials
 * are set to A, then read (populating cache), then updated to B, the subsequent
 * read SHALL return B (not the stale cached A).
 *
 * **Validates: Requirements 3.6**
 */
describe('Property 6: Cache invalidation on credential update', () => {
  // Simulated DB storage keyed by provider
  let dbStore: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    credentialCache.clear();
    dbStore = new Map();

    // Mock queryOne to simulate real DB behavior:
    // - INSERT/UPDATE queries store the encrypted value
    // - SELECT queries return the stored value
    mockQueryOne.mockImplementation(async (sql: string, params?: unknown[]) => {
      const sqlStr = sql as string;
      const paramArr = params as string[];

      if (sqlStr.includes('INSERT INTO platform_credentials')) {
        // Upsert: store the encrypted credentials for the provider
        const provider = paramArr[0];
        const encryptedValue = paramArr[1];
        dbStore.set(provider, encryptedValue);
        return null;
      }

      if (sqlStr.includes('SELECT credentials_encrypted FROM platform_credentials')) {
        // Read: return stored value for the provider
        const provider = paramArr[0];
        const stored = dbStore.get(provider);
        if (!stored) return null;
        return { credentials_encrypted: stored };
      }

      return null;
    });
  });

  // Generator for provider names
  const providerArb = fc.constantFrom('openai' as const, 'twilio' as const, 'stripe' as const);

  // Generator for OpenAI credentials
  const openaiCredsArb = fc.record({
    apiKey: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  });

  // Generator for Twilio credentials
  const twilioCredsArb = fc.record({
    accountSid: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
    authToken: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
    phoneNumber: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  });

  // Generator for Stripe credentials
  const stripeCredsArb = fc.record({
    secretKey: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
    webhookSecret: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  });

  // Generator for two distinct credentials for a given provider
  const providerWithDistinctCredsArb = providerArb.chain((provider) => {
    switch (provider) {
      case 'openai':
        return fc
          .tuple(openaiCredsArb, openaiCredsArb)
          .filter(([a, b]) => a.apiKey !== b.apiKey)
          .map(([a, b]) => ({ provider, credsA: a, credsB: b }));
      case 'twilio':
        return fc
          .tuple(twilioCredsArb, twilioCredsArb)
          .filter(
            ([a, b]) =>
              a.accountSid !== b.accountSid ||
              a.authToken !== b.authToken ||
              a.phoneNumber !== b.phoneNumber,
          )
          .map(([a, b]) => ({ provider, credsA: a, credsB: b }));
      case 'stripe':
        return fc
          .tuple(stripeCredsArb, stripeCredsArb)
          .filter(([a, b]) => a.secretKey !== b.secretKey || a.webhookSecret !== b.webhookSecret)
          .map(([a, b]) => ({ provider, credsA: a, credsB: b }));
    }
  });

  it('should return updated credentials B after set A → read → set B → read', async () => {
    await fc.assert(
      fc.asyncProperty(providerWithDistinctCredsArb, async ({ provider, credsA, credsB }) => {
        // Reset state for each iteration
        credentialCache.clear();
        dbStore.clear();

        // Step 1: Set credentials to A
        await setPlatformCredentials(provider as any, credsA as any);

        // Step 2: Read credentials (populates cache with A)
        const readA = await getPlatformCredentials(provider as any);
        expect(readA).toEqual(credsA);

        // Step 3: Update credentials to B (should invalidate cache)
        await setPlatformCredentials(provider as any, credsB as any);

        // Step 4: Read credentials again — must return B, not stale cached A
        const readB = await getPlatformCredentials(provider as any);
        expect(readB).toEqual(credsB);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 3: User integration uniqueness per provider
 *
 * For any (user_id, provider) pair, attempting to insert two rows into
 * `user_integrations` with the same (user_id, provider) pair SHALL result in
 * the second operation updating the existing row (upsert) — never creating
 * a duplicate.
 *
 * **Validates: Requirements 4.2**
 */
describe('Property 3: User integration uniqueness per provider', () => {
  // Simulated DB storage keyed by composite key `${userId}:${provider}`
  let dbStore: Map<string, { credentials_encrypted: string; metadata: string | null }>;

  beforeEach(() => {
    vi.clearAllMocks();
    credentialCache.clear();
    dbStore = new Map();

    // Mock queryOne to simulate DB with ON CONFLICT (user_id, provider) upsert behavior
    mockQueryOne.mockImplementation(async (sql: string, params?: unknown[]) => {
      const sqlStr = sql as string;
      const paramArr = params as string[];

      if (sqlStr.includes('INSERT INTO user_integrations')) {
        const userId = paramArr[0];
        const provider = paramArr[1];
        const encryptedValue = paramArr[2];
        const metadata = paramArr[3];
        const compositeKey = `${userId}:${provider}`;

        // ON CONFLICT (user_id, provider) DO UPDATE — always upsert
        dbStore.set(compositeKey, {
          credentials_encrypted: encryptedValue,
          metadata: metadata,
        });
        return null;
      }

      if (sqlStr.includes('SELECT credentials_encrypted')) {
        const userId = paramArr[0];
        const provider = paramArr[1];
        const compositeKey = `${userId}:${provider}`;
        const stored = dbStore.get(compositeKey);
        if (!stored) return null;
        return {
          credentials_encrypted: stored.credentials_encrypted,
          metadata: stored.metadata ? JSON.parse(stored.metadata) : null,
        };
      }

      return null;
    });
  });

  // Generator for UUID-like user IDs
  const userIdArb = fc.uuid();

  // Generator for user integration providers
  const providerArb = fc.constantFrom('notion' as const, 'n8n' as const);

  // Generator for Notion credentials
  const notionCredsArb = fc.record({
    accessToken: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  });

  // Generator for n8n credentials
  const n8nCredsArb = fc.record({
    webhookUrl: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
    apiKey: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  });

  // Generator for (userId, provider, credsA, credsB) tuples
  const userIntegrationArb = fc.tuple(userIdArb, providerArb).chain(([userId, provider]) => {
    const credsArb = provider === 'notion' ? notionCredsArb : n8nCredsArb;
    return fc
      .tuple(credsArb, credsArb)
      .filter(([a, b]) => JSON.stringify(a) !== JSON.stringify(b))
      .map(([credsA, credsB]) => ({ userId, provider, credsA, credsB }));
  });

  it('should have exactly 1 entry after two setUserIntegration calls with same (userId, provider)', async () => {
    await fc.assert(
      fc.asyncProperty(userIntegrationArb, async ({ userId, provider, credsA, credsB }) => {
        // Reset state for each iteration
        credentialCache.clear();
        dbStore.clear();

        // Step 1: Insert first credentials
        await setUserIntegration(userId, provider as any, credsA as any);

        // Step 2: Insert second credentials with same (userId, provider)
        await setUserIntegration(userId, provider as any, credsB as any);

        // Step 3: Assert mock DB has exactly 1 entry for that (userId, provider) key
        const compositeKey = `${userId}:${provider}`;
        const allMatchingKeys = [...dbStore.keys()].filter((k) => k === compositeKey);
        expect(allMatchingKeys).toHaveLength(1);

        // Step 4: Assert stored value corresponds to credsB (the latest write)
        const stored = dbStore.get(compositeKey);
        expect(stored).toBeDefined();
        const decryptedValue = JSON.parse(stored!.credentials_encrypted.replace('encrypted:', ''));
        expect(decryptedValue).toEqual(credsB);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 4: Missing platform provider error
 *
 * For any provider name that has no corresponding row in platform_credentials,
 * calling getPlatformCredentials SHALL throw an error containing the provider name
 * in the message.
 *
 * **Validates: Requirements 3.4**
 */
describe('Property 4: Missing platform provider error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentialCache.clear();

    // Mock queryOne to return null for all queries (empty database)
    mockQueryOne.mockResolvedValue(null);
  });

  const providerArb = fc.constantFrom('openai' as const, 'twilio' as const, 'stripe' as const);

  it('should throw an error containing the provider name when no DB row exists', async () => {
    await fc.assert(
      fc.asyncProperty(providerArb, async (provider) => {
        // Clear cache before each iteration to ensure DB is hit
        credentialCache.clear();

        // Calling getPlatformCredentials for a provider with no DB row should throw
        await expect(getPlatformCredentials(provider)).rejects.toThrow();

        // Verify the error message contains the provider name
        try {
          await getPlatformCredentials(provider);
        } catch (error: unknown) {
          const message = (error as Error).message;
          expect(message).toContain(provider);
        }
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 5: Missing user integration returns null
 *
 * For any (user_id, provider) combination that has no corresponding row in
 * user_integrations, calling getUserIntegration SHALL return null.
 *
 * **Validates: Requirements 6.3**
 */
describe('Property 5: Missing user integration returns null', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentialCache.clear();

    // Mock queryOne to return null for all queries (empty database)
    mockQueryOne.mockResolvedValue(null);
  });

  // Generator for UUID-format user IDs
  const userIdArb = fc.uuid();

  // Generator for user integration providers
  const providerArb = fc.constantFrom('notion' as const, 'n8n' as const);

  it('should return null when no DB row exists for the user/provider pair', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, providerArb, async (userId, provider) => {
        // Clear cache before each iteration to ensure DB is hit
        credentialCache.clear();

        // Calling getUserIntegration for a non-existent user/provider pair should return null
        const result = await getUserIntegration(userId, provider);
        expect(result).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 2: Platform provider uniqueness
 *
 * For any provider name, attempting to insert two rows into platform_credentials
 * with the same provider value SHALL result in the second operation either updating
 * the existing row (upsert) or being rejected by the unique constraint — never
 * creating a duplicate.
 *
 * **Validates: Requirements 1.2**
 */
describe('Property 2: Platform provider uniqueness', () => {
  // Simulated DB storage keyed by provider — each provider maps to a single row
  let dbStore: Map<string, { provider: string; credentials_encrypted: string }>;

  beforeEach(() => {
    vi.clearAllMocks();
    credentialCache.clear();
    dbStore = new Map();

    // Mock queryOne to simulate ON CONFLICT (provider) DO UPDATE behavior:
    // - INSERT with ON CONFLICT: if provider exists, update the existing row (don't create new)
    // - SELECT: return stored value for the provider
    mockQueryOne.mockImplementation(async (sql: string, params?: unknown[]) => {
      const sqlStr = sql as string;
      const paramArr = params as string[];

      if (sqlStr.includes('INSERT INTO platform_credentials')) {
        const provider = paramArr[0];
        const encryptedValue = paramArr[1];
        // Upsert: always store one row per provider (mimics ON CONFLICT DO UPDATE)
        dbStore.set(provider, { provider, credentials_encrypted: encryptedValue });
        return null;
      }

      if (sqlStr.includes('SELECT credentials_encrypted FROM platform_credentials')) {
        const provider = paramArr[0];
        const stored = dbStore.get(provider);
        if (!stored) return null;
        return { credentials_encrypted: stored.credentials_encrypted };
      }

      return null;
    });
  });

  // Generator for provider names
  const providerArb = fc.constantFrom('openai' as const, 'twilio' as const, 'stripe' as const);

  // Generator for OpenAI credentials
  const openaiCredsArb = fc.record({
    apiKey: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  });

  // Generator for Twilio credentials
  const twilioCredsArb = fc.record({
    accountSid: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
    authToken: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
    phoneNumber: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  });

  // Generator for Stripe credentials
  const stripeCredsArb = fc.record({
    secretKey: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
    webhookSecret: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  });

  // Generator for two different credential payloads for a given provider
  const providerWithTwoCredsArb = providerArb.chain((provider) => {
    switch (provider) {
      case 'openai':
        return fc
          .tuple(openaiCredsArb, openaiCredsArb)
          .map(([a, b]) => ({ provider, credsA: a, credsB: b }));
      case 'twilio':
        return fc
          .tuple(twilioCredsArb, twilioCredsArb)
          .map(([a, b]) => ({ provider, credsA: a, credsB: b }));
      case 'stripe':
        return fc
          .tuple(stripeCredsArb, stripeCredsArb)
          .map(([a, b]) => ({ provider, credsA: a, credsB: b }));
    }
  });

  it('two setPlatformCredentials calls with same provider never create duplicates — store has exactly 1 entry with latest value', async () => {
    await fc.assert(
      fc.asyncProperty(providerWithTwoCredsArb, async ({ provider, credsA, credsB }) => {
        // Reset state for each iteration
        credentialCache.clear();
        dbStore.clear();

        // Step 1: Set credentials to A
        await setPlatformCredentials(provider as any, credsA as any);

        // Step 2: Set credentials to B (same provider)
        await setPlatformCredentials(provider as any, credsB as any);

        // Assert: DB store has exactly 1 entry for this provider (not 2)
        const entriesForProvider = [...dbStore.values()].filter((row) => row.provider === provider);
        expect(entriesForProvider).toHaveLength(1);

        // Assert: The stored value corresponds to credsB (the latest)
        const readResult = await getPlatformCredentials(provider as any);
        expect(readResult).toEqual(credsB);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 10: Extensible provider storage
 *
 * For any valid provider name (alphanumeric + hyphens, 1-50 chars) and any JSON
 * credentials, generic set/get round-trips without code changes or migrations.
 *
 * **Validates: Requirements 10.1, 10.2**
 */
describe('Property 10: Extensible provider storage', () => {
  // Simulated DB storage keyed by `${userId}:${provider}`
  let dbStore: Map<string, { credentials_encrypted: string; metadata: string | null }>;

  beforeEach(() => {
    vi.clearAllMocks();
    credentialCache.clear();
    dbStore = new Map();

    // Mock queryOne to simulate DB with user_integrations upsert behavior
    mockQueryOne.mockImplementation(async (sql: string, params?: unknown[]) => {
      const sqlStr = sql as string;
      const paramArr = params as string[];

      if (sqlStr.includes('INSERT INTO user_integrations')) {
        const userId = paramArr[0];
        const provider = paramArr[1];
        const encryptedValue = paramArr[2];
        const metadata = paramArr[3];
        const compositeKey = `${userId}:${provider}`;

        // ON CONFLICT (user_id, provider) DO UPDATE — always upsert
        dbStore.set(compositeKey, {
          credentials_encrypted: encryptedValue,
          metadata: metadata,
        });
        return null;
      }

      if (sqlStr.includes('SELECT credentials_encrypted')) {
        const userId = paramArr[0];
        const provider = paramArr[1];
        const compositeKey = `${userId}:${provider}`;
        const stored = dbStore.get(compositeKey);
        if (!stored) return null;
        return {
          credentials_encrypted: stored.credentials_encrypted,
          metadata: stored.metadata ? JSON.parse(stored.metadata) : null,
        };
      }

      return null;
    });
  });

  // Generator for valid provider names: alphanumeric + hyphens, 1-50 chars
  // Pattern: starts with alphanumeric, may contain hyphens in middle, ends with alphanumeric
  const validProviderNameArb = fc
    .tuple(
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
        minLength: 1,
        maxLength: 1,
      }),
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
        minLength: 0,
        maxLength: 48,
      }),
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
        minLength: 0,
        maxLength: 1,
      }),
    )
    .map(([first, middle, last]) => {
      const name = `${first}${middle}${last}`;
      // Ensure no trailing/leading hyphens and length 1-50
      return name.replace(/-+$/, '').replace(/^-+/, '');
    })
    .filter(
      (name) =>
        name.length >= 1 &&
        name.length <= 50 &&
        /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(name),
    );

  // Generator for UUID-like user IDs
  const userIdArb = fc.uuid();

  // Generator for arbitrary JSON credential objects with string values
  const credentialsArb = fc.dictionary(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
      minLength: 1,
      maxLength: 20,
    }),
    fc.string({ minLength: 1, maxLength: 100 }),
    { minKeys: 1, maxKeys: 5 },
  );

  it('generic set/get round-trips for any valid provider name without code changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        validProviderNameArb,
        credentialsArb,
        async (userId, provider, credentials) => {
          // Reset state for each iteration
          credentialCache.clear();
          dbStore.clear();

          // Step 1: Set generic user integration with arbitrary provider name
          await setGenericUserIntegration(userId, provider, credentials);

          // Step 2: Read it back using generic get
          const result = await getGenericUserIntegration(userId, provider);

          // Step 3: Assert round-trip correctness
          expect(result).not.toBeNull();
          expect(result!.credentials).toEqual(credentials);
        },
      ),
      { numRuns: 100 },
    );
  });
});
