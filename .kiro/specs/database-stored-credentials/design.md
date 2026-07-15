# Technical Design Document

## Overview

This document describes the architecture for moving third-party API credentials from environment variables into PostgreSQL (encrypted at rest with AES-256-GCM), unifying user integrations under a single table, and providing a typed credential store service with in-memory caching. The design preserves the existing Express/TypeScript/node-pg-migrate stack and integrates with the established admin console, Redis caching, and Pino logging patterns.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Admin Console UI                           │
│  (Platform Credentials page — per-provider structured forms)     │
└──────────────────────────┬───────────────────────────────────────┘
                           │ HTTPS / JSON
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│              Admin API Routes (Express Router)                    │
│  POST /api/admin/credentials/:provider                           │
│  GET  /api/admin/credentials/status                              │
│  requireAdmin + requirePermission('entitlements.manage')         │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│               Credential Store Service                            │
│  ┌──────────────┐  ┌────────────┐  ┌─────────────────────────┐  │
│  │ Typed Getters│  │ Cache Layer│  │ Generic CRUD (user integ)│  │
│  │ (OpenAI,    │  │ (in-memory │  │ read/write by provider   │  │
│  │  Twilio,    │  │  Map + TTL)│  │                          │  │
│  │  Stripe)    │  │            │  │                          │  │
│  └──────────────┘  └────────────┘  └─────────────────────────┘  │
└──────────────────────────┬───────────────────────────────────────┘
                           │
              ┌────────────┼─────────────┐
              ▼            ▼             ▼
┌─────────────────┐ ┌──────────────┐ ┌──────────────────────┐
│ platform_creds  │ │ user_integs  │ │ Encryption Utilities │
│ (PostgreSQL)    │ │ (PostgreSQL) │ │ (AES-256-GCM)        │
└─────────────────┘ └──────────────┘ └──────────────────────┘
```


## Data Models

### platform_credentials Table

```sql
CREATE TABLE platform_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(50) NOT NULL UNIQUE,
  credentials_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_platform_credentials_provider ON platform_credentials (provider);
```

The `provider` column uses a unique constraint (not an enum) so new providers can be added without migrations. Known platform providers: `openai`, `twilio`, `stripe`.

The `credentials_encrypted` column stores the output of `encrypt(JSON.stringify(credentials))` using the existing AES-256-GCM utility at `src/server/utils/encryption.ts`.

### user_integrations Table

```sql
CREATE TABLE user_integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  credentials_encrypted TEXT NOT NULL,
  metadata JSONB,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

CREATE INDEX idx_user_integrations_user_id ON user_integrations (user_id);
CREATE INDEX idx_user_integrations_provider ON user_integrations (provider);
```

The compound unique constraint `(user_id, provider)` ensures one connection per provider per user. The `metadata` JSONB column stores non-secret provider-specific data (e.g., Notion workspace name).


## Migration Strategy

### Migration 008: Create Credential Tables and Migrate Notion Data

File: `migrations/008_create-credential-tables.ts`

```typescript
import { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  // 1. Create platform_credentials table
  pgm.createTable('platform_credentials', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    provider: { type: 'varchar(50)', notNull: true, unique: true },
    credentials_encrypted: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // 2. Create user_integrations table
  pgm.createTable('user_integrations', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    user_id: { type: 'uuid', notNull: true, references: '"user"(id)', onDelete: 'CASCADE' },
    provider: { type: 'varchar(50)', notNull: true },
    credentials_encrypted: { type: 'text', notNull: true },
    metadata: { type: 'jsonb' },
    connected_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('user_integrations', 'uq_user_integrations_user_provider', {
    unique: ['user_id', 'provider'],
  });
  pgm.createIndex('user_integrations', 'user_id');
  pgm.createIndex('user_integrations', 'provider');

  // 3. Migrate notion_connections → user_integrations
  pgm.sql(`
    INSERT INTO user_integrations (user_id, provider, credentials_encrypted, metadata, connected_at)
    SELECT
      user_id,
      'notion',
      access_token_encrypted,
      jsonb_build_object('workspace_id', workspace_id, 'workspace_name', workspace_name),
      connected_at
    FROM notion_connections
  `);

  // 4. Drop the old table
  pgm.dropTable('notion_connections');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Recreate notion_connections
  pgm.createTable('notion_connections', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    user_id: { type: 'uuid', notNull: true, unique: true, references: '"user"(id)', onDelete: 'CASCADE' },
    access_token_encrypted: { type: 'text', notNull: true },
    workspace_id: { type: 'varchar(255)', notNull: true },
    workspace_name: { type: 'varchar(255)' },
    connected_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('notion_connections', 'user_id');

  // Migrate data back
  pgm.sql(`
    INSERT INTO notion_connections (user_id, access_token_encrypted, workspace_id, workspace_name, connected_at)
    SELECT
      user_id,
      credentials_encrypted,
      metadata->>'workspace_id',
      metadata->>'workspace_name',
      connected_at
    FROM user_integrations WHERE provider = 'notion'
  `);

  pgm.dropTable('user_integrations');
  pgm.dropTable('platform_credentials');
}
```


## Components and Interfaces

File: `src/server/services/credentials/index.ts`

### Provider Schema Types

```typescript
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
```

### Cache Layer

```typescript
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

class CredentialCache {
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
```

The cache uses an in-memory `Map` rather than Redis because:
- Credential reads are infrequent (service startup, lazy first-call)
- In-memory avoids a network hop for latency-sensitive credential lookups
- TTL-based expiry ensures credentials refresh periodically
- Explicit invalidation on admin update guarantees freshness


### Service Interface

```typescript
import { queryOne } from '../../db/db.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger({ module: 'credential-store' });
const cache = new CredentialCache();

// ─── Platform Credentials ────────────────────────────────────────────────────

/**
 * Retrieves and decrypts platform credentials for the given provider.
 * Results are cached in-memory with TTL.
 * Throws if provider is not configured.
 */
export async function getPlatformCredentials<K extends keyof PlatformProviderMap>(
  provider: K
): Promise<PlatformProviderMap[K]> {
  const cacheKey = `platform:${provider}`;
  const cached = cache.get<PlatformProviderMap[K]>(cacheKey);
  if (cached) return cached;

  const row = await queryOne<{ credentials_encrypted: string }>(
    'SELECT credentials_encrypted FROM platform_credentials WHERE provider = $1',
    [provider]
  );

  if (!row) {
    throw new Error(`Platform credentials not configured for provider: ${provider}`);
  }

  const decrypted = JSON.parse(decrypt(row.credentials_encrypted)) as PlatformProviderMap[K];
  cache.set(cacheKey, decrypted);
  return decrypted;
}

/** Typed convenience getters */
export async function getOpenAICredentials(): Promise<OpenAICredentials> {
  return getPlatformCredentials('openai');
}

export async function getTwilioCredentials(): Promise<TwilioCredentials> {
  return getPlatformCredentials('twilio');
}

export async function getStripeCredentials(): Promise<StripeCredentials> {
  return getPlatformCredentials('stripe');
}

/**
 * Encrypts and upserts platform credentials for a provider.
 * Invalidates the cache entry for the affected provider.
 */
export async function setPlatformCredentials<K extends keyof PlatformProviderMap>(
  provider: K,
  credentials: PlatformProviderMap[K]
): Promise<void> {
  const encrypted = encrypt(JSON.stringify(credentials));

  await queryOne(
    `INSERT INTO platform_credentials (provider, credentials_encrypted, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (provider)
     DO UPDATE SET credentials_encrypted = EXCLUDED.credentials_encrypted, updated_at = NOW()`,
    [provider, encrypted]
  );

  cache.invalidate(`platform:${provider}`);
  log.info({ provider }, 'Platform credentials updated');
}


// ─── User Integrations ───────────────────────────────────────────────────────

/**
 * Retrieves and decrypts user integration credentials.
 * Returns null if no integration exists for the user/provider pair.
 */
export async function getUserIntegration<K extends keyof UserProviderMap>(
  userId: string,
  provider: K
): Promise<{ credentials: UserProviderMap[K]; metadata: Record<string, unknown> | null } | null> {
  const cacheKey = `user:${userId}:${provider}`;
  const cached = cache.get<{ credentials: UserProviderMap[K]; metadata: Record<string, unknown> | null }>(cacheKey);
  if (cached) return cached;

  const row = await queryOne<{ credentials_encrypted: string; metadata: Record<string, unknown> | null }>(
    'SELECT credentials_encrypted, metadata FROM user_integrations WHERE user_id = $1 AND provider = $2',
    [userId, provider]
  );

  if (!row) return null;

  const credentials = JSON.parse(decrypt(row.credentials_encrypted)) as UserProviderMap[K];
  const result = { credentials, metadata: row.metadata };
  cache.set(cacheKey, result);
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
  metadata?: Record<string, unknown> | null
): Promise<void> {
  const encrypted = encrypt(JSON.stringify(credentials));

  await queryOne(
    `INSERT INTO user_integrations (user_id, provider, credentials_encrypted, metadata, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, provider)
     DO UPDATE SET credentials_encrypted = EXCLUDED.credentials_encrypted,
                   metadata = COALESCE(EXCLUDED.metadata, user_integrations.metadata),
                   updated_at = NOW()`,
    [userId, provider, encrypted, metadata ? JSON.stringify(metadata) : null]
  );

  cache.invalidate(`user:${userId}:${provider}`);
  log.info({ userId, provider }, 'User integration credentials updated');
}

/**
 * Removes a user integration and invalidates its cache.
 */
export async function deleteUserIntegration(userId: string, provider: string): Promise<void> {
  await queryOne(
    'DELETE FROM user_integrations WHERE user_id = $1 AND provider = $2',
    [userId, provider]
  );
  cache.invalidate(`user:${userId}:${provider}`);
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
  provider: string
): Promise<{ credentials: Record<string, unknown>; metadata: Record<string, unknown> | null } | null> {
  const row = await queryOne<{ credentials_encrypted: string; metadata: Record<string, unknown> | null }>(
    'SELECT credentials_encrypted, metadata FROM user_integrations WHERE user_id = $1 AND provider = $2',
    [userId, provider]
  );

  if (!row) return null;

  const credentials = JSON.parse(decrypt(row.credentials_encrypted)) as Record<string, unknown>;
  return { credentials, metadata: row.metadata };
}

/**
 * Generic write for any user integration provider.
 */
export async function setGenericUserIntegration(
  userId: string,
  provider: string,
  credentials: Record<string, unknown>,
  metadata?: Record<string, unknown> | null
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
    [userId, provider, encrypted, metadata ? JSON.stringify(metadata) : null]
  );

  cache.invalidate(`user:${userId}:${provider}`);
}
```


## Admin Console API Endpoints

New routes added to `src/server/routes/admin.ts`:

### POST /api/admin/credentials/:provider

Upserts credentials for a platform provider.

```typescript
router.post(
  '/credentials/:provider',
  requirePermission('entitlements.manage'),
  async (req: Request, res: Response) => {
    const adminReq = req as AdminAuthenticatedRequest;
    const { provider } = req.params;

    const validProviders = ['openai', 'twilio', 'stripe'];
    if (!validProviders.includes(provider)) {
      res.status(400).json({ error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` });
      return;
    }

    // Validate required fields per provider
    const validation = validateProviderPayload(provider, req.body);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    await credentialStore.setPlatformCredentials(
      provider as keyof PlatformProviderMap,
      req.body
    );

    // Audit log
    await logAuditEntry(adminReq.adminUser.id, {
      action: 'credentials.update',
      targetType: 'platform_credentials',
      targetId: provider,
      details: { provider, fieldsUpdated: Object.keys(req.body) },
    });

    res.status(200).json({ message: `Credentials for ${provider} saved successfully` });
  }
);
```

### GET /api/admin/credentials/status

Returns configuration status for all platform providers (without revealing values).

```typescript
router.get(
  '/credentials/status',
  requirePermission('entitlements.manage'),
  async (_req: Request, res: Response) => {
    const providers = ['openai', 'twilio', 'stripe'];
    const status: Record<string, { configured: boolean; updatedAt: string | null }> = {};

    for (const provider of providers) {
      const row = await queryOne<{ updated_at: Date }>(
        'SELECT updated_at FROM platform_credentials WHERE provider = $1',
        [provider]
      );
      status[provider] = {
        configured: !!row,
        updatedAt: row?.updated_at?.toISOString() ?? null,
      };
    }

    res.status(200).json({ providers: status });
  }
);
```

### Payload Validation Helper

```typescript
function validateProviderPayload(
  provider: string,
  body: Record<string, unknown>
): { valid: boolean; error?: string } {
  switch (provider) {
    case 'openai':
      if (!body.apiKey || typeof body.apiKey !== 'string') {
        return { valid: false, error: 'apiKey is required and must be a string' };
      }
      return { valid: true };
    case 'twilio':
      if (!body.accountSid || !body.authToken || !body.phoneNumber) {
        return { valid: false, error: 'accountSid, authToken, and phoneNumber are required' };
      }
      return { valid: true };
    case 'stripe':
      if (!body.secretKey || !body.webhookSecret) {
        return { valid: false, error: 'secretKey and webhookSecret are required' };
      }
      return { valid: true };
    default:
      return { valid: false, error: 'Unknown provider' };
  }
}
```


## Service Refactoring

### AI Mapper Service (`src/server/services/ai-mapper/index.ts`)

Before:
```typescript
import { config } from '../../config.js';

export function createOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: config.openaiApiKey });
}
```

After:
```typescript
import { getOpenAICredentials } from '../credentials/index.js';

export async function createOpenAIClient(): OpenAI {
  const { apiKey } = await getOpenAICredentials();
  return new OpenAI({ apiKey });
}
```

The `getClient()` helper becomes async. Since OpenAI calls are already async, the impact is minimal — the credential fetch happens on first use and is cached thereafter.

### SMS Gateway Service (`src/server/services/sms/index.ts`)

Before:
```typescript
import { config } from '../../config.js';

export function getTwilioClient(): Twilio {
  if (!twilioClient) {
    twilioClient = new Twilio(config.twilioAccountSid, config.twilioAuthToken);
  }
  return twilioClient;
}
```

After:
```typescript
import { getTwilioCredentials } from '../credentials/index.js';

export async function getTwilioClient(): Promise<Twilio> {
  if (!twilioClient) {
    const { accountSid, authToken } = await getTwilioCredentials();
    twilioClient = new Twilio(accountSid, authToken);
  }
  return twilioClient;
}

export async function getTwilioPhoneNumber(): Promise<string> {
  const { phoneNumber } = await getTwilioCredentials();
  return phoneNumber;
}
```

The `sendReply` function updates to `await getTwilioClient()` and `await getTwilioPhoneNumber()`.

### Subscription Service (`src/server/services/subscription/index.ts`)

Before:
```typescript
import { config } from '../../config.js';

export function getStripeClient(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(config.stripeSecretKey, { apiVersion: '...' });
  }
  return stripeClient;
}
```

After:
```typescript
import { getStripeCredentials } from '../credentials/index.js';

export async function getStripeClient(): Promise<Stripe> {
  if (!stripeClient) {
    const { secretKey } = await getStripeCredentials();
    stripeClient = new Stripe(secretKey, { apiVersion: '2025-02-24.acacia' });
  }
  return stripeClient;
}

export async function getStripeWebhookSecret(): Promise<string> {
  const { webhookSecret } = await getStripeCredentials();
  return webhookSecret;
}
```

The webhook handler changes `config.stripeWebhookSecret` to `await getStripeWebhookSecret()`.


### Notion Integration Service (`src/server/services/integrations/notion.ts`)

Before:
```typescript
import { queryOne } from '../../db/db.js';
import { config } from '../../config.js';

// Reads from notion_connections table
const row = await queryOne<NotionConnectionRow>(
  'SELECT * FROM notion_connections WHERE user_id = $1',
  [userId]
);
```

After:
```typescript
import { getUserIntegration } from '../credentials/index.js';

// Reads from user_integrations table via credential store
const integration = await getUserIntegration(userId, 'notion');
if (!integration) return null;

const { credentials, metadata } = integration;
// credentials.accessToken available for Notion API calls
// metadata.workspace_id, metadata.workspace_name available for display
```

The `connectNotion` function updates to use `setUserIntegration` instead of inserting directly into `notion_connections`. Notion OAuth client credentials (clientId, clientSecret) are stored in `platform_credentials` with provider `notion_oauth` if needed, or handled via the user integrations flow directly since they're exchanged server-side during OAuth.

## Config Module Changes

File: `src/server/config.ts`

```typescript
export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  jwtRefreshSecret: string;
  encryptionMasterKey: string;
}

export function loadConfig(): AppConfig {
  return {
    port: parseInt(getEnvVar('PORT', '3000'), 10),
    nodeEnv: getEnvVar('NODE_ENV', 'development'),
    databaseUrl: getEnvVar('DATABASE_URL', 'postgresql://localhost:5432/mindatlas'),
    redisUrl: getEnvVar('REDIS_URL', 'redis://localhost:6379'),
    jwtSecret: getEnvVar('JWT_SECRET', 'dev-jwt-secret'),
    jwtRefreshSecret: getEnvVar('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
    encryptionMasterKey: getEnvVar('ENCRYPTION_MASTER_KEY', 'dev-encryption-key-32-bytes-long!'),
  };
}
```

Removed fields: `openaiApiKey`, `twilioAccountSid`, `twilioAuthToken`, `twilioPhoneNumber`, `stripeSecretKey`, `stripeWebhookSecret`, `notionClientId`, `notionClientSecret`, `notionRedirectUri`.


## Error Handling

| Scenario | Behavior |
|----------|----------|
| Provider not configured (no DB row) | `getPlatformCredentials` throws `Error('Platform credentials not configured for provider: X')` |
| User integration not found | `getUserIntegration` returns `null` |
| Decryption fails (corrupted data or key mismatch) | AES-256-GCM auth tag check fails, propagated as decryption error |
| Invalid provider on admin API | 400 response with validation message |
| Missing permission on admin API | 403 response without credential data |
| Schema validation fails (generic provider) | `setGenericUserIntegration` throws with schema mismatch message |

All errors are logged via Pino structured logger with the `credential-store` module tag. Credential values are never included in log messages.

## Security Considerations

1. **Encryption at rest**: All credentials encrypted with AES-256-GCM before database write. Key derived from `ENCRYPTION_MASTER_KEY` env var (the only secret remaining in env).
2. **No plaintext in transit within system**: Decrypted values exist only in service memory and the in-memory cache. Never logged, never stored in Redis.
3. **Audit trail**: Every admin mutation creates an audit_log entry with provider name but no credential values in the details field.
4. **Access control**: Admin endpoints require `requireAdmin` (JWT + MFA) and `requirePermission('entitlements.manage')`.
5. **Cache isolation**: In-memory cache is process-local. In multi-instance deployments, cache TTL ensures eventual consistency (5-minute window). Admin updates could optionally publish a Redis pub/sub invalidation event for immediate cross-instance refresh (future enhancement).

## Data Flow Diagrams

### Admin Updates Credentials

```
Admin UI → POST /api/admin/credentials/twilio
  → requireAdmin (JWT + MFA check)
  → requirePermission('entitlements.manage')
  → validateProviderPayload('twilio', body)
  → credentialStore.setPlatformCredentials('twilio', body)
    → encrypt(JSON.stringify(body))
    → UPSERT platform_credentials WHERE provider = 'twilio'
    → cache.invalidate('platform:twilio')
  → logAuditEntry(adminId, { action: 'credentials.update', ... })
  → 200 { message: 'Credentials saved' }
```

### Service Reads Credentials

```
SMS Service → getTwilioCredentials()
  → getPlatformCredentials('twilio')
    → cache.get('platform:twilio') → HIT? return cached
    → SELECT credentials_encrypted FROM platform_credentials WHERE provider = 'twilio'
    → decrypt(row.credentials_encrypted)
    → JSON.parse → TwilioCredentials
    → cache.set('platform:twilio', parsed)
    → return parsed
```


## Testing Strategy

- **Property-based tests**: Cover round-trip encryption, cache invalidation, uniqueness constraints, extensible provider storage, migration data preservation, and credential masking. Minimum 100 iterations per property.
- **Unit tests**: Cover typed getter return shapes, admin API validation responses, error messages for missing providers, and correct audit log structure.
- **Integration tests**: Cover the full admin credential update flow (auth → validate → store → audit), foreign key cascade behavior, and Notion migration end-to-end.
- **Smoke tests**: Verify table schema after migration runs, and confirm the config module compiles without removed fields.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Credential encryption round-trip

*For any* valid JSON credentials object (containing string fields representing API keys, tokens, or URLs), encrypting the object with the Encryption Utilities and then decrypting the result SHALL produce an object identical to the original.

**Validates: Requirements 1.3, 1.4, 4.3, 6.1**

### Property 2: Platform provider uniqueness

*For any* provider name string, attempting to insert two rows into `platform_credentials` with the same provider value SHALL result in the second operation either updating the existing row (upsert) or being rejected by the unique constraint — never creating a duplicate.

**Validates: Requirements 1.2**

### Property 3: User integration uniqueness per provider

*For any* user_id and provider combination, attempting to insert two rows into `user_integrations` with the same (user_id, provider) pair SHALL result in the second operation either updating the existing row (upsert) or being rejected by the unique constraint — never creating a duplicate.

**Validates: Requirements 4.2**

### Property 4: Missing platform provider error

*For any* provider name string that has no corresponding row in `platform_credentials`, calling `getPlatformCredentials` SHALL throw an error containing the provider name in the message.

**Validates: Requirements 3.4**

### Property 5: Missing user integration returns null

*For any* user_id and provider combination that has no corresponding row in `user_integrations`, calling `getUserIntegration` SHALL return null.

**Validates: Requirements 6.3**

### Property 6: Cache invalidation on credential update

*For any* provider and two distinct credential payloads A and B, if credentials are set to A, then read (populating cache), then updated to B, the subsequent read SHALL return B (not the stale cached A).

**Validates: Requirements 3.6**

### Property 7: Migration data preservation

*For any* row in `notion_connections` with fields (user_id, access_token_encrypted, workspace_id, workspace_name, connected_at), after migration, the `user_integrations` table SHALL contain a row with the same user_id, provider = "notion", credentials_encrypted = access_token_encrypted, and metadata containing the original workspace_id and workspace_name.

**Validates: Requirements 5.1**

### Property 8: Audit log completeness without credential leakage

*For any* admin credential update operation on any provider, the resulting audit_log entry SHALL contain action = "credentials.update", target_type = "platform_credentials", target_id = provider name, and admin_user_id of the acting admin, AND the details field SHALL NOT contain any substring matching the actual credential values.

**Validates: Requirements 8.1, 8.2, 8.3**

### Property 9: Unauthorized access rejection without credential leakage

*For any* HTTP request to credential management endpoints that lacks valid admin authentication or lacks the `entitlements.manage` permission, the response SHALL have status code 401 or 403, AND the response body SHALL NOT contain any credential values from the database.

**Validates: Requirements 9.1, 9.2, 9.3**

### Property 10: Extensible provider storage

*For any* valid provider name string (alphanumeric + hyphens, 1-50 chars) and any valid JSON credentials object, the generic `setGenericUserIntegration` and `getGenericUserIntegration` methods SHALL successfully store and retrieve the credentials without requiring code changes or database migrations.

**Validates: Requirements 10.1, 10.2**

### Property 11: Credential masking in admin display

*For any* stored credential string value of length > 4, the masked representation shown in the Admin Console SHALL NOT contain any contiguous substring of the original value longer than 4 characters.

**Validates: Requirements 2.8**

