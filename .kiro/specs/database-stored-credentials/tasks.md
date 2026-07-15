# Implementation Plan: Database-Stored Credentials

## Overview

Move third-party API credentials (OpenAI, Twilio, Stripe) from environment variables into PostgreSQL (encrypted with AES-256-GCM), unify user integrations under a single table, and provide a typed credential store service. Admin Console gets a Platform Credentials page; consuming services are refactored to use the credential store.

## Tasks

- [x] 1. Database migration and credential store foundation
  - [x] 1.1 Create migration 008_create-credential-tables.ts
    - Create `platform_credentials` table with columns: id (UUID PK), provider (varchar unique), credentials_encrypted (text), created_at, updated_at
    - Create `user_integrations` table with columns: id (UUID PK), user_id (FK to users ON DELETE CASCADE), provider (varchar), credentials_encrypted (text), metadata (jsonb nullable), connected_at, updated_at
    - Add unique constraint on (user_id, provider) for user_integrations
    - Add indexes on user_integrations.user_id and user_integrations.provider
    - Migrate existing notion_connections data into user_integrations with provider = "notion"
    - Drop notion_connections table
    - Implement down migration to reverse all changes
    - _Requirements: 1.1, 1.2, 4.1, 4.2, 4.4, 5.1, 5.2_

  - [x] 1.2 Implement credential store service types and cache layer
    - Create `src/server/services/credentials/index.ts`
    - Define provider schema interfaces: OpenAICredentials, TwilioCredentials, StripeCredentials, NotionUserCredentials, N8nUserCredentials
    - Define PlatformProviderMap and UserProviderMap type registries
    - Implement CredentialCache class with in-memory Map, configurable TTL, get/set/invalidate/clear methods
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 10.3_

  - [x] 1.3 Implement platform credential store methods
    - Implement `getPlatformCredentials<K>` with cache-first lookup, DB fallback, decrypt, and cache-on-read
    - Implement typed convenience getters: `getOpenAICredentials()`, `getTwilioCredentials()`, `getStripeCredentials()`
    - Implement `setPlatformCredentials<K>` with encrypt, upsert, and cache invalidation
    - Throw descriptive error if provider not configured (include provider name in message)
    - _Requirements: 1.3, 1.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 1.4 Implement user integration credential store methods
    - Implement `getUserIntegration<K>` with cache-first lookup, DB fallback, returns null if not found
    - Implement `setUserIntegration<K>` with encrypt, upsert, cache invalidation
    - Implement `deleteUserIntegration` with cache invalidation
    - Implement `registerProviderSchema` for extensible provider validation
    - Implement `getGenericUserIntegration` and `setGenericUserIntegration` for untyped provider support
    - _Requirements: 4.3, 6.1, 6.2, 6.3, 10.1, 10.2, 10.3_

  - [x] 1.5 Write property test: Credential encryption round-trip
    - **Property 1: Credential encryption round-trip**
    - Generate arbitrary JSON credential objects with string fields; verify encrypt→decrypt produces identical output
    - **Validates: Requirements 1.3, 1.4, 4.3, 6.1**

  - [x] 1.6 Write property test: Cache invalidation on credential update
    - **Property 6: Cache invalidation on credential update**
    - For arbitrary provider and two distinct payloads A/B, set A, read (cache), update to B, read again → must return B
    - **Validates: Requirements 3.6**

- [x] 2. Checkpoint - Ensure migration and credential store compile and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Admin API endpoints for credential management
  - [x] 3.1 Add admin credential routes to src/server/routes/admin.ts
    - Add `POST /api/admin/credentials/:provider` endpoint with requireAdmin + requirePermission('entitlements.manage')
    - Implement `validateProviderPayload` helper for openai (apiKey), twilio (accountSid, authToken, phoneNumber), stripe (secretKey, webhookSecret)
    - Call `setPlatformCredentials` and write audit_log entry with action "credentials.update", target_type "platform_credentials", target_id = provider name
    - Add `GET /api/admin/credentials/status` endpoint returning configured/updatedAt per provider (no credential values)
    - _Requirements: 2.6, 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 9.4_

  - [x] 3.2 Write property test: Audit log completeness without credential leakage
    - **Property 8: Audit log completeness without credential leakage**
    - For any admin credential update, audit_log SHALL contain action, target_type, target_id, admin_user_id, and details SHALL NOT contain credential values
    - **Validates: Requirements 8.1, 8.2, 8.3**

  - [x] 3.3 Write property test: Unauthorized access rejection without credential leakage
    - **Property 9: Unauthorized access rejection without credential leakage**
    - Requests lacking valid admin auth or entitlements.manage permission return 401/403 with no credential values in body
    - **Validates: Requirements 9.1, 9.2, 9.3**

- [x] 4. Config module refactoring and service updates
  - [x] 4.1 Refactor config module to remove third-party env vars
    - Remove openaiApiKey, twilioAccountSid, twilioAuthToken, twilioPhoneNumber, stripeSecretKey, stripeWebhookSecret, notionClientId, notionClientSecret, notionRedirectUri from AppConfig interface and loadConfig function
    - Retain only: port, nodeEnv, databaseUrl, redisUrl, jwtSecret, jwtRefreshSecret, encryptionMasterKey
    - _Requirements: 7.1, 7.2, 7.5_

  - [x] 4.2 Refactor AI mapper service to use credential store
    - Update `src/server/services/ai-mapper/index.ts` to import `getOpenAICredentials` from credential store
    - Change `createOpenAIClient()` to async, fetch apiKey from credential store
    - Remove `config.openaiApiKey` usage
    - _Requirements: 7.3_

  - [x] 4.3 Refactor SMS service to use credential store
    - Update `src/server/services/sms/index.ts` to import `getTwilioCredentials` from credential store
    - Change `getTwilioClient()` to async, fetch accountSid and authToken from credential store
    - Add `getTwilioPhoneNumber()` async helper
    - Update `sendReply` to await client and phone number
    - Remove `config.twilioAccountSid`, `config.twilioAuthToken`, `config.twilioPhoneNumber` usage
    - _Requirements: 7.3_

  - [x] 4.4 Refactor subscription service to use credential store
    - Update `src/server/services/subscription/index.ts` to import `getStripeCredentials` from credential store
    - Change `getStripeClient()` to async, fetch secretKey from credential store
    - Add `getStripeWebhookSecret()` async helper
    - Update webhook handler to use `await getStripeWebhookSecret()`
    - Remove `config.stripeSecretKey`, `config.stripeWebhookSecret` usage
    - _Requirements: 7.3_

  - [x] 4.5 Refactor Notion integration to use credential store
    - Update `src/server/services/integrations/notion.ts` to import `getUserIntegration` and `setUserIntegration` from credential store
    - Replace direct notion_connections queries with `getUserIntegration(userId, 'notion')`
    - Update `connectNotion` to use `setUserIntegration` with provider "notion"
    - Store workspace metadata in the metadata column
    - Remove `config.notionClientId`, `config.notionClientSecret`, `config.notionRedirectUri` usage
    - _Requirements: 5.3, 7.3, 7.5_

  - [x] 4.6 Write property test: Platform provider uniqueness
    - **Property 2: Platform provider uniqueness**
    - For any provider name, two inserts with same provider never create duplicates — second is upsert or constraint rejection
    - **Validates: Requirements 1.2**

  - [x] 4.7 Write property test: User integration uniqueness per provider
    - **Property 3: User integration uniqueness per provider**
    - For any (user_id, provider) pair, two inserts never create duplicates
    - **Validates: Requirements 4.2**

  - [x] 4.8 Write property test: Missing platform provider error
    - **Property 4: Missing platform provider error**
    - For any provider with no DB row, getPlatformCredentials throws error containing provider name
    - **Validates: Requirements 3.4**

  - [x] 4.9 Write property test: Missing user integration returns null
    - **Property 5: Missing user integration returns null**
    - For any (user_id, provider) with no DB row, getUserIntegration returns null
    - **Validates: Requirements 6.3**

- [x] 5. Checkpoint - Ensure all service refactoring compiles and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Admin Console UI for platform credentials
  - [x] 6.1 Create PlatformCredentials admin page component
    - Create `src/client/admin/pages/PlatformCredentials.tsx`
    - Display separate configuration sections for OpenAI, Twilio, and Stripe
    - OpenAI section: single field for API Key
    - Twilio section: fields for Account SID, Auth Token, Phone Number
    - Stripe section: fields for Secret Key, Webhook Secret
    - Show masked placeholder text (e.g., "••••••••configured") when credentials exist
    - Display success confirmation on save
    - Fetch credential status from GET /api/admin/credentials/status
    - Submit credentials to POST /api/admin/credentials/:provider
    - Gate page access behind `entitlements.manage` permission
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 6.2 Add Platform Credentials route to AdminApp
    - Register PlatformCredentials page in `src/client/admin/AdminApp.tsx` router
    - Add navigation link in AdminLayout sidebar
    - _Requirements: 2.1_

  - [x] 6.3 Write property test: Credential masking in admin display
    - **Property 11: Credential masking in admin display**
    - For any credential string of length > 4, masked representation SHALL NOT contain any contiguous substring of original longer than 4 chars
    - **Validates: Requirements 2.8**

- [x] 7. User integration endpoints (n8n setup)
  - [x] 7.1 Add n8n user integration API endpoints
    - Add PUT /api/integrations/n8n endpoint to save n8n credentials (webhookUrl, apiKey) via `setUserIntegration(userId, 'n8n', ...)`
    - Add GET /api/integrations/n8n endpoint to retrieve n8n integration status (returns typed object or null)
    - Add DELETE /api/integrations/n8n endpoint to remove integration via `deleteUserIntegration`
    - Require authenticated user session
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 7.2 Write property test: Extensible provider storage
    - **Property 10: Extensible provider storage**
    - For any valid provider name (alphanumeric + hyphens, 1-50 chars) and any JSON credentials, generic set/get round-trips without code changes or migrations
    - **Validates: Requirements 10.1, 10.2**

  - [x] 7.3 Write property test: Migration data preservation
    - **Property 7: Migration data preservation**
    - For any notion_connections row, after migration user_integrations contains matching row with correct provider, credentials, and metadata
    - **Validates: Requirements 5.1**

- [x] 8. Environment cleanup and final integration
  - [x] 8.1 Clean up .env.example
    - Remove OPENAI_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, NOTION_CLIENT_ID, NOTION_CLIENT_SECRET, NOTION_REDIRECT_URI entries
    - Retain PORT, NODE_ENV, DATABASE_URL, REDIS_URL, JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_MASTER_KEY
    - _Requirements: 7.4_

  - [x] 8.2 Update existing tests for refactored services
    - Update AI mapper tests to mock `getOpenAICredentials` instead of config
    - Update SMS tests to mock `getTwilioCredentials` instead of config
    - Update subscription tests to mock `getStripeCredentials` instead of config
    - Update Notion integration tests to use credential store mocks
    - Update admin route tests to include credential endpoint coverage
    - _Requirements: 7.3_

  - [x] 8.3 Write integration tests for full credential management flow
    - Test admin credential update end-to-end: auth → validate → store → audit log
    - Test foreign key cascade: deleting user cascades to user_integrations
    - Test Notion migration correctness with sample data
    - _Requirements: 1.1, 4.4, 5.1, 8.1_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The project uses vitest + fast-check for property-based testing
- Existing test patterns (e.g., `*.property.test.ts`) should be followed for new property tests

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4"] },
    { "id": 2, "tasks": ["1.5", "1.6", "4.1"] },
    { "id": 3, "tasks": ["3.1", "4.2", "4.3", "4.4", "4.5"] },
    { "id": 4, "tasks": ["3.2", "3.3", "4.6", "4.7", "4.8", "4.9"] },
    { "id": 5, "tasks": ["6.1", "7.1"] },
    { "id": 6, "tasks": ["6.2", "6.3", "7.2", "7.3"] },
    { "id": 7, "tasks": ["8.1", "8.2"] },
    { "id": 8, "tasks": ["8.3"] }
  ]
}
```
