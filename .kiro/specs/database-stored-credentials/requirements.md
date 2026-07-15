# Requirements Document

## Introduction

This feature moves third-party API credentials (OpenAI, Twilio, Stripe) out of environment variables and into the PostgreSQL database, encrypted at rest with AES-256-GCM. Platform-level credentials are managed by admins via the Admin Console with structured fields. User-level integrations (Notion, n8n, and future providers) are consolidated into a unified `user_integrations` table. A new credential store service provides typed getters for consuming code. Environment variables are retained only for infrastructure secrets (DATABASE_URL, REDIS_URL, JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_MASTER_KEY).

## Glossary

- **Credential_Store_Service**: A server-side TypeScript service that provides typed methods for reading and writing encrypted credentials from the database.
- **Platform_Credentials_Table**: A PostgreSQL table (`platform_credentials`) that stores admin-managed API credentials with a provider discriminator column and an encrypted JSON credentials column.
- **User_Integrations_Table**: A PostgreSQL table (`user_integrations`) that stores per-user integration credentials with a provider discriminator and encrypted JSON credentials column.
- **Admin_Console**: The existing administrative web interface protected by MFA and role-based permissions.
- **Encryption_Utilities**: The existing AES-256-GCM encryption module at `src/server/utils/encryption.ts` that encrypts and decrypts string payloads.
- **Provider**: A named third-party service (e.g., openai, twilio, stripe, notion, n8n) used as a discriminator value in credential tables.

## Requirements

### Requirement 1: Platform Credentials Storage

**User Story:** As an admin, I want platform API credentials stored encrypted in the database so that credentials are centrally managed without requiring environment variable changes and server restarts.

#### Acceptance Criteria

1. THE Platform_Credentials_Table SHALL store each credential row with columns: id (UUID primary key), provider (varchar, unique), credentials_encrypted (text), created_at (timestamptz), and updated_at (timestamptz).
2. THE Platform_Credentials_Table SHALL enforce a unique constraint on the provider column so that each provider has exactly one credential row.
3. WHEN a credential row is inserted or updated, THE Credential_Store_Service SHALL encrypt the JSON credentials payload using the Encryption_Utilities before writing to the credentials_encrypted column.
4. WHEN a credential row is read, THE Credential_Store_Service SHALL decrypt the credentials_encrypted column and return a typed object matching the provider schema.

### Requirement 2: Admin Credential Management

**User Story:** As an admin, I want structured forms in the Admin Console for each provider so that I can configure credentials with clear field labels and validation.

#### Acceptance Criteria

1. THE Admin_Console SHALL display a "Platform Credentials" page accessible to admin users with the `entitlements.manage` permission.
2. WHEN the admin navigates to the Platform Credentials page, THE Admin_Console SHALL display separate configuration sections for OpenAI, Twilio, and Stripe providers.
3. THE Admin_Console SHALL display the OpenAI section with a single structured field: API Key.
4. THE Admin_Console SHALL display the Twilio section with structured fields: Account SID, Auth Token, and Phone Number.
5. THE Admin_Console SHALL display the Stripe section with structured fields: Secret Key and Webhook Secret.
6. WHEN the admin submits credential values for a provider, THE Admin_Console SHALL send the values to a protected API endpoint that writes them to the Platform_Credentials_Table.
7. WHEN credentials are saved successfully, THE Admin_Console SHALL display a success confirmation to the admin.
8. WHEN the admin views a provider section that has saved credentials, THE Admin_Console SHALL display masked placeholder text indicating credentials are configured without revealing the actual values.

### Requirement 3: Credential Store Service

**User Story:** As a developer, I want a typed credential store service so that consuming code retrieves provider credentials through a consistent, type-safe interface.

#### Acceptance Criteria

1. THE Credential_Store_Service SHALL expose a typed getter method for OpenAI credentials that returns an object with an apiKey string field.
2. THE Credential_Store_Service SHALL expose a typed getter method for Twilio credentials that returns an object with accountSid, authToken, and phoneNumber string fields.
3. THE Credential_Store_Service SHALL expose a typed getter method for Stripe credentials that returns an object with secretKey and webhookSecret string fields.
4. IF the requested provider has no stored credentials, THEN THE Credential_Store_Service SHALL throw a descriptive error indicating the provider is not configured.
5. THE Credential_Store_Service SHALL cache decrypted credentials in memory with a configurable time-to-live to avoid repeated database reads and decryption operations on every request.
6. WHEN credentials are updated via the Admin Console, THE Credential_Store_Service SHALL invalidate the cached entry for the affected provider.

### Requirement 4: User Integrations Table

**User Story:** As a developer, I want a unified table for all user-managed integrations so that adding new providers does not require schema changes.

#### Acceptance Criteria

1. THE User_Integrations_Table SHALL store each integration row with columns: id (UUID primary key), user_id (UUID foreign key to users), provider (varchar), credentials_encrypted (text), metadata (jsonb, nullable), connected_at (timestamptz), and updated_at (timestamptz).
2. THE User_Integrations_Table SHALL enforce a unique constraint on the combination of user_id and provider so that each user has at most one connection per provider.
3. WHEN a user integration row is inserted or updated, THE Credential_Store_Service SHALL encrypt the credentials JSON payload using the Encryption_Utilities before writing to the credentials_encrypted column.
4. THE User_Integrations_Table SHALL define a foreign key on user_id referencing the users table with ON DELETE CASCADE behavior.

### Requirement 5: Notion Connection Migration

**User Story:** As a developer, I want existing Notion connections migrated into the unified user_integrations table so that all user integrations follow a single pattern.

#### Acceptance Criteria

1. WHEN the migration runs, THE migration script SHALL copy each row from notion_connections into user_integrations with provider set to "notion", credentials_encrypted containing the existing encrypted access token, and metadata containing workspace_id and workspace_name.
2. WHEN the migration completes, THE migration script SHALL drop the notion_connections table.
3. WHEN Notion integration code reads a connection, THE Credential_Store_Service SHALL read from the User_Integrations_Table with provider "notion" instead of the former notion_connections table.

### Requirement 6: n8n User Integration

**User Story:** As a user, I want to configure my n8n webhook URL and API key in user settings so that my MindAtlas account can receive items from n8n workflows.

#### Acceptance Criteria

1. WHEN a user saves n8n integration settings, THE Credential_Store_Service SHALL store the webhook URL and API key as encrypted credentials in the User_Integrations_Table with provider set to "n8n".
2. WHEN the n8n integration is read, THE Credential_Store_Service SHALL return a typed object with webhookUrl and apiKey string fields.
3. IF the user has no n8n integration configured, THEN THE Credential_Store_Service SHALL return null to indicate the integration is not set up.

### Requirement 7: Environment Variable Removal

**User Story:** As an operations engineer, I want third-party API credentials removed from environment variables so that credential rotation does not require redeployment.

#### Acceptance Criteria

1. THE config module SHALL remove the openaiApiKey, twilioAccountSid, twilioAuthToken, twilioPhoneNumber, stripeSecretKey, and stripeWebhookSecret fields from the AppConfig interface and loadConfig function.
2. THE config module SHALL retain only the following environment variable fields: port, nodeEnv, databaseUrl, redisUrl, jwtSecret, jwtRefreshSecret, and encryptionMasterKey.
3. WHEN existing code requires OpenAI, Twilio, or Stripe credentials, THE consuming service SHALL obtain credentials from the Credential_Store_Service instead of the config module.
4. THE .env.example file SHALL remove entries for OPENAI_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, STRIPE_SECRET_KEY, and STRIPE_WEBHOOK_SECRET.
5. THE config module SHALL remove the notionClientId, notionClientSecret, and notionRedirectUri fields since Notion OAuth credentials are managed through the user integrations flow.

### Requirement 8: Audit Logging for Credential Changes

**User Story:** As a security officer, I want all credential modifications logged in the audit trail so that changes can be traced back to the responsible admin.

#### Acceptance Criteria

1. WHEN an admin creates or updates platform credentials, THE Admin_Console backend SHALL write an entry to the audit_log table with action "credentials.update", target_type "platform_credentials", and target_id set to the provider name.
2. THE audit_log entry SHALL record the admin_user_id of the admin who performed the change.
3. THE audit_log entry details field SHALL record which provider was modified without storing the credential values.

### Requirement 9: API Endpoint Security

**User Story:** As a security officer, I want credential management endpoints protected by admin authentication and MFA so that only authorized admins can modify platform credentials.

#### Acceptance Criteria

1. THE credential management API endpoints SHALL require a valid admin session with MFA verification before processing requests.
2. THE credential management API endpoints SHALL verify the requesting admin has the `entitlements.manage` permission.
3. IF a request lacks valid admin authentication or required permissions, THEN THE API endpoint SHALL return a 403 Forbidden response without revealing credential data.
4. THE credential management API endpoints SHALL accept and return JSON payloads over HTTPS only.

### Requirement 10: Extensible Provider Pattern

**User Story:** As a developer, I want an extensible pattern for adding new integration providers so that future integrations require minimal code changes.

#### Acceptance Criteria

1. THE Credential_Store_Service SHALL accept a provider name parameter in generic read and write methods that operate on the User_Integrations_Table without requiring code changes per provider.
2. THE User_Integrations_Table schema SHALL support new providers by inserting rows with new provider discriminator values without requiring database migrations.
3. THE Credential_Store_Service SHALL provide a registration mechanism for typed provider schemas so that new providers can define their credential structure at the application level.
