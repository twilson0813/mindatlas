import { queryOne } from '../../db/db.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger({ module: 'credential-store' });

// ─── Provider Schema Types ───────────────────────────────────────────────────

/** Platform credential shapes keyed by provider name */
export interface OpenAICredentials {
  apiKey: string;
}

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

export interface StripeCredentials {
  secretKey: string;
  webhookSecret: string;
}

export interface NotionUserCredentials {
  accessToken: string;
}

export interface N8nUserCredentials {
  webhookUrl: string;
  apiKey: string;
}

/** Registry of known platform provider schemas */
export type PlatformProviderMap = {
  openai: OpenAICredentials;
  twilio: TwilioCredentials;
  stripe: StripeCredentials;
};

/** Registry of known user integration provider schemas */
export type UserProviderMap = {
  notion: NotionUserCredentials;
  n8n: N8nUserCredentials;
};

// ─── Cache Layer ─────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class CredentialCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/** Shared cache instance used by credential store methods */
export const credentialCache = new CredentialCache();

// ─── Platform Credentials ────────────────────────────────────────────────────

/**
 * Retrieves and decrypts platform credentials for the given provider.
 * Results are cached in-memory with TTL.
 * Throws if provider is not configured.
 */
export async function getPlatformCredentials<K extends keyof PlatformProviderMap>(
  provider: K,
): Promise<PlatformProviderMap[K]> {
  const cacheKey = `platform:${provider}`;
  const cached = credentialCache.get<PlatformProviderMap[K]>(cacheKey);
  if (cached) return cached;

  const row = await queryOne<{ credentials_encrypted: string }>(
    'SELECT credentials_encrypted FROM platform_credentials WHERE provider = $1',
    [provider],
  );

  if (!row) {
    throw new Error(`Platform credentials not configured for provider: ${provider}`);
  }

  const decrypted = JSON.parse(decrypt(row.credentials_encrypted)) as PlatformProviderMap[K];
  credentialCache.set(cacheKey, decrypted);
  return decrypted;
}

/** Typed convenience getter for OpenAI credentials */
export async function getOpenAICredentials(): Promise<OpenAICredentials> {
  return getPlatformCredentials('openai');
}

/** Typed convenience getter for Twilio credentials */
export async function getTwilioCredentials(): Promise<TwilioCredentials> {
  return getPlatformCredentials('twilio');
}

/** Typed convenience getter for Stripe credentials */
export async function getStripeCredentials(): Promise<StripeCredentials> {
  return getPlatformCredentials('stripe');
}

/**
 * Encrypts and upserts platform credentials for a provider.
 * Invalidates the cache entry for the affected provider.
 */
export async function setPlatformCredentials<K extends keyof PlatformProviderMap>(
  provider: K,
  credentials: PlatformProviderMap[K],
): Promise<void> {
  const encrypted = encrypt(JSON.stringify(credentials));

  await queryOne(
    `INSERT INTO platform_credentials (provider, credentials_encrypted, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (provider)
     DO UPDATE SET credentials_encrypted = EXCLUDED.credentials_encrypted, updated_at = NOW()`,
    [provider, encrypted],
  );

  credentialCache.invalidate(`platform:${provider}`);
  log.info({ provider }, 'Platform credentials updated');
}

// ─── User Integrations ───────────────────────────────────────────────────────

/**
 * Retrieves and decrypts user integration credentials.
 * Uses cache-first lookup with DB fallback.
 * Returns null if no integration exists for the user/provider pair.
 */
export async function getUserIntegration<K extends keyof UserProviderMap>(
  userId: string,
  provider: K,
): Promise<{ credentials: UserProviderMap[K]; metadata: Record<string, unknown> | null } | null> {
  const cacheKey = `user:${userId}:${provider}`;
  const cached = credentialCache.get<{
    credentials: UserProviderMap[K];
    metadata: Record<string, unknown> | null;
  }>(cacheKey);
  if (cached) return cached;

  const row = await queryOne<{
    credentials_encrypted: string;
    metadata: Record<string, unknown> | null;
  }>(
    'SELECT credentials_encrypted, metadata FROM user_integrations WHERE user_id = $1 AND provider = $2',
    [userId, provider],
  );

  if (!row) return null;

  const credentials = JSON.parse(decrypt(row.credentials_encrypted)) as UserProviderMap[K];
  const result = { credentials, metadata: row.metadata };
  credentialCache.set(cacheKey, result);
  log.info({ userId, provider }, 'User integration credentials retrieved');
  return result;
}

/**
 * Encrypts and upserts user integration credentials.
 * Invalidates the cache entry for the affected user/provider.
 */
export async function setUserIntegration<K extends keyof UserProviderMap>(
  userId: string,
  provider: K,
  credentials: UserProviderMap[K],
  metadata?: Record<string, unknown> | null,
): Promise<void> {
  const encrypted = encrypt(JSON.stringify(credentials));

  await queryOne(
    `INSERT INTO user_integrations (user_id, provider, credentials_encrypted, metadata, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, provider)
     DO UPDATE SET credentials_encrypted = EXCLUDED.credentials_encrypted,
                   metadata = COALESCE(EXCLUDED.metadata, user_integrations.metadata),
                   updated_at = NOW()`,
    [userId, provider, encrypted, metadata ? JSON.stringify(metadata) : null],
  );

  credentialCache.invalidate(`user:${userId}:${provider}`);
  log.info({ userId, provider }, 'User integration credentials updated');
}

/**
 * Removes a user integration and invalidates its cache.
 */
export async function deleteUserIntegration(userId: string, provider: string): Promise<void> {
  await queryOne('DELETE FROM user_integrations WHERE user_id = $1 AND provider = $2', [
    userId,
    provider,
  ]);
  credentialCache.invalidate(`user:${userId}:${provider}`);
  log.info({ userId, provider }, 'User integration removed');
}

// ─── Generic / Extensible Provider Support ───────────────────────────────────

/** Schema registry for runtime type validation of new providers */
type SchemaValidator = (data: unknown) => boolean;
const providerSchemas = new Map<string, SchemaValidator>();

/**
 * Registers a schema validator for a user integration provider.
 * Allows new providers to define their credential structure without code changes
 * to the core service.
 */
export function registerProviderSchema(provider: string, validator: SchemaValidator): void {
  providerSchemas.set(provider, validator);
  log.info({ provider }, 'Provider schema registered');
}

/**
 * Generic read for any user integration provider (including unregistered ones).
 * Useful for future providers added at runtime.
 */
export async function getGenericUserIntegration(
  userId: string,
  provider: string,
): Promise<{
  credentials: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
} | null> {
  const row = await queryOne<{
    credentials_encrypted: string;
    metadata: Record<string, unknown> | null;
  }>(
    'SELECT credentials_encrypted, metadata FROM user_integrations WHERE user_id = $1 AND provider = $2',
    [userId, provider],
  );

  if (!row) return null;

  const credentials = JSON.parse(decrypt(row.credentials_encrypted)) as Record<string, unknown>;
  return { credentials, metadata: row.metadata };
}

/**
 * Generic write for any user integration provider.
 * Validates against registered schema if available.
 */
export async function setGenericUserIntegration(
  userId: string,
  provider: string,
  credentials: Record<string, unknown>,
  metadata?: Record<string, unknown> | null,
): Promise<void> {
  // Validate against registered schema if available
  const validator = providerSchemas.get(provider);
  if (validator && !validator(credentials)) {
    throw new Error(`Credentials do not match registered schema for provider: ${provider}`);
  }

  const encrypted = encrypt(JSON.stringify(credentials));
  await queryOne(
    `INSERT INTO user_integrations (user_id, provider, credentials_encrypted, metadata, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, provider)
     DO UPDATE SET credentials_encrypted = EXCLUDED.credentials_encrypted,
                   metadata = COALESCE(EXCLUDED.metadata, user_integrations.metadata),
                   updated_at = NOW()`,
    [userId, provider, encrypted, metadata ? JSON.stringify(metadata) : null],
  );

  credentialCache.invalidate(`user:${userId}:${provider}`);
  log.info({ userId, provider }, 'Generic user integration credentials updated');
}

// Re-export the providerSchemas for testing purposes
export { providerSchemas as _providerSchemas };
