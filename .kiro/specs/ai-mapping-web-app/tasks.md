# Implementation Plan: AI Mapping Web App (MindAtlas)

## Overview

This implementation plan breaks down the MindAtlas application into incremental coding tasks organized by domain. The architecture uses Node.js/Express backend, React/TypeScript frontend, PostgreSQL, Redis/BullMQ, and integrates with OpenAI, Twilio, Stripe, and Notion APIs. Each task builds on previous work and ends with wiring into the broader application. Property-based tests use fast-check.

## Tasks

- [x] 1. Project scaffolding and core infrastructure
  - [x] 1.1 Initialize project structure with TypeScript configuration
    - Create monorepo structure: `/src/server/`, `/src/client/`, `/src/shared/`
    - Configure TypeScript (`tsconfig.json`) for both server and client
    - Set up Express server entry point with health check endpoint
    - Configure ESLint, Prettier, and Jest/Vitest with fast-check
    - Set up environment variable loading (dotenv) with typed config
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 1.2 Set up PostgreSQL database with migrations framework
    - Install and configure a migration tool (e.g., node-pg-migrate or Knex)
    - Create initial migration for USER table with all fields (id, email, password_hash, phone_number, is_locked, locked_until, failed_attempts, role, created_at, updated_at)
    - Create migration for CATEGORY, TAG, ITEM, ITEM_TAG, RELATIONSHIP tables
    - Create migration for MAP, MAP_NODE, MAP_EDGE tables
    - Create migration for API_KEY, NOTION_CONNECTION tables
    - Set up database connection pool with typed query helpers
    - _Requirements: 12.2, 14.1_

  - [x] 1.3 Set up Redis connection and BullMQ queue infrastructure
    - Configure Redis client with connection pooling
    - Create BullMQ queue for AI processing jobs
    - Create BullMQ queue for SMS retry jobs
    - Create BullMQ queue for Stripe payment retry jobs
    - Implement structured JSON logger (Winston or Pino) for all log output
    - _Requirements: 10.5, 4.4, 18.11_

  - [x] 1.4 Write property test for structured log output
    - **Property 15: Structured Log Output**
    - Verify all log events produce valid JSON with timestamp, level, and message fields
    - Generator: random log events at various levels
    - **Validates: Requirements 10.5**

  - [x] 1.5 Set up AES-256-GCM encryption utilities
    - Implement encrypt/decrypt functions using AES-256-GCM with unique IV per item
    - Derive encryption key from master key environment variable
    - Create typed interfaces for encrypted content storage
    - _Requirements: 12.2_

  - [x] 1.6 Write property test for encryption round trip
    - **Property 16: Encryption Round Trip**
    - Verify encrypting then decrypting any content string produces the original unchanged
    - Generator: arbitrary strings including unicode, empty, large
    - **Validates: Requirements 12.2**

  - [x] 1.7 Implement input sanitization utilities
    - Create sanitization module using DOMPurify (server-side via jsdom) for HTML/XSS
    - Implement SQL injection prevention via parameterized queries pattern
    - Create express-validator middleware chains for common input patterns
    - _Requirements: 12.5_

  - [x] 1.8 Write property test for input sanitization
    - **Property 18: Input Sanitization**
    - Verify sanitized output contains no executable script content or unescaped SQL control characters
    - Generator: strings with embedded XSS/SQL injection patterns
    - **Validates: Requirements 12.5**

- [x] 2. Authentication and authorization system
  - [x] 2.1 Implement Auth Service with registration and login
    - Create `/src/server/services/auth/` module
    - Implement `register()` with bcrypt hashing (cost factor 12)
    - Implement `login()` with JWT access token (15-min) and refresh token (7-day) issuance
    - Implement `refresh()` for token renewal
    - Implement `validatePassword()` with complexity rules (8+ chars, uppercase, lowercase, digit, special)
    - _Requirements: 1.1, 1.2, 1.3, 12.3_

  - [x] 2.2 Write property test for password complexity validation
    - **Property 1: Password Complexity Validation**
    - Verify validator accepts strings meeting all criteria and rejects those missing any
    - Generator: arbitrary strings with/without required character classes
    - **Validates: Requirements 1.3**

  - [x] 2.3 Write property test for password hashing correctness
    - **Property 17: Password Hashing Correctness**
    - Verify hashing produces valid bcrypt hash with cost >= 12 and verifying original password succeeds
    - Generator: arbitrary password strings
    - **Validates: Requirements 12.3**

  - [x] 2.4 Implement JWT middleware and token validation
    - Create auth middleware that validates JWT on protected routes
    - Implement token expiry checking and rejection
    - Return 401 for missing/invalid tokens on all protected endpoints
    - _Requirements: 1.4, 2.2_

  - [x] 2.5 Write property test for expired token rejection
    - **Property 2: Expired Token Rejection**
    - Verify JWTs with past expiry timestamps are always rejected
    - Generator: JWTs with random past timestamps
    - **Validates: Requirements 1.4**

  - [x] 2.6 Implement account lockout mechanism
    - Track failed login attempts per user in database
    - Lock account for 15 minutes after 5 consecutive failures
    - Implement `lockAccount()` and automatic unlock after timeout
    - Reset failed attempts counter on successful login
    - _Requirements: 1.5_

  - [x] 2.7 Implement ownership enforcement and access control
    - Create authorization middleware that verifies resource ownership
    - All item/map queries scoped by authenticated user ID
    - Return 403 when user attempts to access another user's resources
    - _Requirements: 2.1, 2.3_

  - [x] 2.8 Write property test for ownership enforcement
    - **Property 3: Ownership Enforcement**
    - Verify user B accessing user A's item always receives 403
    - Generator: random user pairs and item IDs
    - **Validates: Requirements 2.1, 2.3**

  - [x] 2.9 Write property test for unauthenticated request rejection
    - **Property 4: Unauthenticated Request Rejection**
    - Verify requests without valid auth token always receive 401
    - Generator: protected endpoints with missing/invalid/malformed tokens
    - **Validates: Requirements 2.2**

  - [x] 2.10 Implement rate limiting middleware
    - Create Redis-backed sliding window rate limiter
    - Enforce 100 requests per minute per user
    - Return 429 with retry-after header when limit exceeded
    - _Requirements: 3.4_

- [x] 3. Checkpoint - Core infrastructure verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Item service and REST API input channel
  - [x] 4.1 Implement Item Service with CRUD operations
    - Create `/src/server/services/items/` module
    - Implement `createItem()` with validation, encryption, and AI job enqueue
    - Implement `getItem()` with ownership check and decryption
    - Implement `listItems()` with pagination, filtering (category, tag, date, keyword)
    - Implement `deleteItem()` with soft-delete pattern
    - Implement `getItemRelationships()` scoped to user
    - _Requirements: 3.1, 3.2, 3.3, 8.5, 12.4_

  - [x] 4.2 Write property test for item payload validation
    - **Property 5: Item Payload Validation**
    - Verify acceptance iff payload has non-empty content and valid content_type enum
    - Generator: random JSON objects with valid/invalid structures
    - **Validates: Requirements 3.2, 3.3**

  - [x] 4.3 Implement REST API routes for items
    - Create `POST /api/items` — create item endpoint
    - Create `GET /api/items` — list items with filter query params
    - Create `GET /api/items/:id` — get item detail
    - Create `DELETE /api/items/:id` — soft-delete item
    - Create `GET /api/items/:id/relationships` — get item relationships
    - Wire all routes through auth middleware and rate limiter
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 4.4 Write property test for search filter correctness
    - **Property 12: Search Filter Correctness**
    - Verify all items in filtered results match every applied criterion, no matching items excluded
    - Generator: random item sets and filter combinations (category, tag, date, keyword)
    - **Validates: Requirements 8.5**

- [x] 5. File upload and web upload input channel
  - [x] 5.1 Implement file upload handler with validation
    - Create upload handler using multer for multipart file processing
    - Validate file size (reject > 25 MB)
    - Validate file type against allowed extensions (PDF, PNG, JPG, GIF, TXT, MD, CSV, JSON, code files)
    - Store files to S3/MinIO, save file_path and file_size to item record
    - Create `POST /api/items/upload` endpoint
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 5.2 Write property test for file size validation
    - **Property 7: File Size Validation**
    - Verify files > 25 MB are always rejected with error message
    - Generator: random integers representing file sizes
    - **Validates: Requirements 5.4**

  - [x] 5.3 Write property test for file type validation
    - **Property 8: File Type Validation**
    - Verify allowed extensions accepted, all others rejected
    - Generator: random filenames with various extensions
    - **Validates: Requirements 5.5**

- [x] 6. SMS input channel
  - [x] 6.1 Implement SMS Gateway service with Twilio integration
    - Create `/src/server/services/sms/` module
    - Implement `handleIncoming()` — verify phone, create item, send confirmation
    - Implement `verifyPhoneNumber()` — lookup user by registered phone
    - Implement `sendReply()` — send SMS confirmation via Twilio
    - Create `POST /api/sms/incoming` webhook endpoint for Twilio
    - Implement retry logic: 3 retries with exponential backoff (1s, 5s, 25s)
    - Discard messages from unregistered numbers with no side effects
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 6.2 Write property test for unregistered phone number rejection
    - **Property 6: Unregistered Phone Number Rejection**
    - Verify SMS from unregistered numbers creates no item and no state change
    - Generator: random phone numbers not in the registered set
    - **Validates: Requirements 4.2**

- [x] 7. AI processing and mapping service
  - [x] 7.1 Implement AI Mapper service with OpenAI integration
    - Create `/src/server/services/ai-mapper/` module
    - Implement `categorizeItem()` — call OpenAI for category/tag assignment with confidence scores
    - Implement `mapRelationships()` — identify relationships between user's items
    - Implement `generateMap()` — build full relationship map for user
    - Implement `queryItems()` — natural language search over user's items
    - Implement `suggestRelated()` — return related items and recommended actions
    - All operations scoped to same user's items only
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4_

  - [x] 7.2 Implement BullMQ AI worker with retry logic
    - Create worker that processes AI categorization jobs from queue
    - Implement exponential backoff: 3 retries (2s, 10s, 60s)
    - Handle graceful degradation: store item even if AI fails
    - Dead letter queue for jobs that exceed max retries
    - _Requirements: 6.1, 7.4_

  - [x] 7.3 Write property test for confidence score bounds
    - **Property 10: Confidence Score Bounds**
    - Verify all confidence scores are between 0.0 and 1.0 inclusive
    - Generator: random categorization results
    - **Validates: Requirements 6.5**

  - [x] 7.4 Write property test for map graph completeness
    - **Property 9: Map Graph Completeness**
    - Verify generated map contains node for every item in a relationship and edge for every relationship
    - Generator: random item sets with random relationships
    - **Validates: Requirements 6.3**

- [x] 8. Checkpoint - Backend core services verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. CSV import and export service
  - [x] 9.1 Implement CSV Import service
    - Create `/src/server/services/csv/` module
    - Implement `validateCsvStructure()` — require "content" header column
    - Implement `validateCsvSize()` — enforce 10 MB and 5000 row limits
    - Implement `parseRow()` — parse individual rows, skip empty content
    - Implement `importCsv()` — orchestrate validation, parsing, bulk item creation
    - Return CsvImportResult with items created, rows skipped, skipped row numbers
    - Handle malformed CSV with descriptive error (line number + issue)
    - Create `POST /api/csv/import` endpoint
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.10_

  - [x] 9.2 Implement CSV Export service and template
    - Implement `exportItems()` — generate CSV with content, content_type, tags, creation_date, metadata columns
    - Implement `exportMaps()` — generate CSV with source_item_id, target_item_id, relationship_type, confidence_score
    - Implement `getTemplate()` — return template with headers and 2 example rows
    - Create `GET /api/csv/export/items` endpoint
    - Create `GET /api/csv/export/maps` endpoint
    - Create `GET /api/csv/template` endpoint
    - _Requirements: 13.7, 13.8, 13.9, 13.12, 13.13_

  - [x] 9.3 Write property test for CSV import-export round trip
    - **Property 19: CSV Import-Export Round Trip**
    - Verify import → export → import produces equivalent item set
    - Generator: random valid CSV content with varying rows, columns, unicode, special chars
    - **Validates: Requirements 13.11**

  - [x] 9.4 Write property test for CSV row creation count
    - **Property 20: CSV Row Creation Count**
    - Verify N rows with M non-empty content → M items created, (N-M) skipped, created + skipped = N
    - Generator: random CSV files with mixes of populated/empty content rows
    - **Validates: Requirements 13.1, 13.3, 13.10**

  - [x] 9.5 Write property test for CSV header validation
    - **Property 21: CSV Header Validation**
    - Verify acceptance iff header row contains "content" column
    - Generator: random sets of column headers with/without "content"
    - **Validates: Requirements 13.2**

  - [x] 9.6 Write property test for CSV empty content row skipping
    - **Property 22: CSV Empty Content Row Skipping**
    - Verify empty/whitespace content rows are skipped and row numbers accurately reported
    - Generator: CSV files with random placement of empty content fields
    - **Validates: Requirements 13.3**

  - [x] 9.7 Write property test for CSV malformed file rejection
    - **Property 23: CSV Malformed File Rejection**
    - Verify malformed CSV rejected with error containing line number and description
    - Generator: strings with unclosed quotes, mismatched columns, invalid encodings
    - **Validates: Requirements 13.4**

  - [x] 9.8 Write property test for CSV size and row limit enforcement
    - **Property 24: CSV Size and Row Limit Enforcement**
    - Verify rejection if > 10 MB or > 5000 rows; acceptance if both within limits
    - Generator: random file sizes [0–20 MB] and row counts [0–10000]
    - **Validates: Requirements 13.5, 13.6**

  - [x] 9.9 Write property test for CSV export completeness
    - **Property 25: CSV Export Completeness**
    - Verify items export has N data rows + header; maps export has R rows + header with correct columns
    - Generator: random item/relationship sets of varying sizes
    - **Validates: Requirements 13.7, 13.8, 13.9**

- [x] 10. Third-party integrations (n8n and Notion)
  - [x] 10.1 Implement n8n webhook endpoint and API key management
    - Create `/src/server/services/integrations/` module
    - Implement `handleWebhook()` — process n8n payloads, create items
    - Implement `generateApiKey()` — create API key with hashed storage
    - Implement `revokeApiKey()` — deactivate API key
    - Create `POST /api/webhooks/n8n` endpoint
    - Create `GET /api/keys`, `POST /api/keys`, `DELETE /api/keys/:id` endpoints
    - Implement API key authentication middleware (equivalent to JWT access)
    - _Requirements: 9.1, 9.2, 9.6, 9.7_

  - [x] 10.2 Write property test for API key access equivalence
    - **Property 14: API Key Access Equivalence**
    - Verify API key auth produces same response as session token for same user/endpoint
    - Generator: random protected endpoints with API key vs JWT authentication
    - **Validates: Requirements 9.7**

  - [x] 10.3 Implement Notion OAuth integration
    - Implement `connectNotion()` — OAuth flow with Notion API
    - Implement `importFromNotion()` — import selected Notion pages as items
    - Implement `exportToNotion()` — export items to connected Notion workspace
    - Create `POST /api/integrations/notion/connect` endpoint
    - Create `POST /api/integrations/notion/import` endpoint
    - Create `POST /api/integrations/notion/export` endpoint
    - Store encrypted access tokens in NOTION_CONNECTION table
    - _Requirements: 9.3, 9.4, 9.5_

- [x] 11. Feature Registry and Entitlement system
  - [x] 11.1 Implement Feature Registry with auto-registration
    - Create `/src/server/services/feature-registry/` module
    - Implement `@RegisterFeature` decorator pattern for auto-registration at module init
    - Implement `register()`, `getAll()`, `getByKey()`, `getByCategory()`, `isRegistered()`
    - Create FEATURE_REGISTRY database table and migration
    - Register all existing features: input.sms, input.api, input.csv, ai.categorization, ai.relationship_mapping, ai.natural_language, ai.cluster_summaries, ai.suggestions, ai.priority_processing, integration.notion, integration.n8n, export.csv, advanced.custom_categories
    - _Requirements: 17.8, 18.15_

  - [x] 11.2 Write property test for feature registry auto-registration and uniqueness
    - **Property 28: Feature Registry Auto-Registration and Uniqueness**
    - Verify registered features appear with unique keys; no duplicates allowed
    - Generator: random feature definitions with various keys and categories
    - **Validates: Requirements 17.8, 18.15**

  - [x] 11.3 Implement Entitlement Middleware with Redis caching
    - Create `/src/server/middleware/entitlement.ts`
    - Implement `requireEntitlement(featureKey)` middleware factory
    - Implement `loadEntitlements(planId)` — read from Redis cache, fallback to DB
    - Implement `invalidateCache(planId)` — flush Redis cache on admin change
    - Return 402 Payment Required for unauthorized feature access
    - Apply middleware to feature-gated routes (SMS, AI, Notion, CSV, n8n)
    - _Requirements: 18.12, 18.14_

  - [x] 11.4 Write property test for entitlement enforcement
    - **Property 29: Entitlement Enforcement**
    - Verify 402 for features not in plan; no block for features in plan
    - Generator: random user/plan/feature combinations
    - **Validates: Requirements 18.12**

  - [x] 11.5 Write property test for runtime entitlement propagation
    - **Property 30: Runtime Entitlement Propagation**
    - Verify admin config changes reflected immediately on next API request without restart
    - Generator: random entitlement config changes, verify immediate reflection
    - **Validates: Requirements 18.14**

- [x] 12. Subscription and billing system
  - [x] 12.1 Create subscription database tables and migrations
    - Create migration for SUBSCRIPTION_PLAN table
    - Create migration for PLAN_FEATURE_ENTITLEMENT table
    - Create migration for USER_SUBSCRIPTION table
    - Create migration for PAYMENT_HISTORY table
    - Seed default plans: Free, Pro, Enterprise with limits per requirements
    - Seed feature entitlements per plan tier
    - _Requirements: 18.1, 18.2, 18.3, 18.4_

  - [x] 12.2 Implement Subscription Service with Stripe integration
    - Create `/src/server/services/subscription/` module
    - Implement `subscribeToPlan()` — create Stripe subscription, activate immediately
    - Implement `upgradePlan()` — prorate billing, activate new features immediately
    - Implement `downgradePlan()` — schedule downgrade at billing period end
    - Implement `cancelSubscription()` — maintain access until period end
    - Implement `handleStripeWebhook()` — process payment events with signature verification
    - Implement `retryFailedPayment()` — 3 retries over 7 days via BullMQ scheduled job
    - Implement `checkEntitlement()`, `checkStorageLimit()`, `checkAiQueryLimit()`
    - Implement `getBillingHistory()`, `updatePaymentMethod()`
    - _Requirements: 18.5, 18.6, 18.7, 18.8, 18.9, 18.11, 18.12, 18.13, 18.14_

  - [x] 12.3 Create billing API routes
    - Create `GET /api/billing/subscription` — current subscription details
    - Create `POST /api/billing/subscribe` — subscribe to plan
    - Create `POST /api/billing/upgrade` — upgrade plan
    - Create `POST /api/billing/downgrade` — downgrade plan
    - Create `POST /api/billing/cancel` — cancel subscription
    - Create `GET /api/billing/history` — payment history
    - Create `PUT /api/billing/payment-method` — update payment method
    - Create `GET /api/billing/usage` — current storage and AI query usage
    - Create `POST /api/webhooks/stripe` — Stripe webhook endpoint
    - _Requirements: 18.6, 18.9_

  - [x] 12.4 Write property test for plan upgrade immediate activation
    - **Property 31: Plan Upgrade Immediate Activation**
    - Verify all new plan features accessible immediately after payment confirmation
    - Generator: random plan transitions with payment confirmation
    - **Validates: Requirements 18.7**

  - [x] 12.5 Write property test for plan downgrade grace period
    - **Property 32: Plan Downgrade Grace Period**
    - Verify current plan features retained until billing period end after downgrade/cancel
    - Generator: random downgrades at various points in billing period
    - **Validates: Requirements 18.8**

  - [x] 12.6 Write property test for unlimited card creation invariant
    - **Property 33: Unlimited Card Creation Invariant**
    - Verify card creation never rejected due to card count limit on any tier
    - Generator: random plans and card counts
    - **Validates: Requirements 18.13**

  - [x] 12.7 Write property test for existing data preservation on limit exceed
    - **Property 34: Existing Data Preservation on Limit Exceed**
    - Verify existing cards remain accessible when storage/AI limits exceeded
    - Generator: random users at/over limits, verify existing cards readable
    - **Validates: Requirements 18.5**

- [x] 13. Checkpoint - Backend services and billing verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Admin Console backend
  - [x] 14.1 Create admin database tables and migrations
    - Create migration for ADMIN_USER table (user_id FK, role_id FK, mfa_enabled, mfa_secret)
    - Create migration for ADMIN_ROLE table (name, permissions JSONB)
    - Create migration for AUDIT_LOG table
    - Create admin_user_summary view (excludes content_encrypted)
    - Seed admin roles: super_admin, admin, moderator
    - _Requirements: 17.1, 17.10_

  - [x] 14.2 Implement Admin Service with content isolation
    - Create `/src/server/services/admin/` module
    - Implement AdminDataAccess layer that structurally excludes content_encrypted fields
    - Implement `listUsers()` — paginated user list with metadata only
    - Implement `disableAccount()`, `deleteAccount()`, `unlockAccount()` with audit logging
    - Implement `getSystemMetrics()` — aggregated counts and rates
    - Implement `moderateAccount()` — flag/disable without content access
    - Implement `getAuditTrail()` — filterable admin action log
    - Log and reject any attempt to access content fields
    - _Requirements: 17.2, 17.3, 17.4, 17.5, 17.9, 17.10_

  - [x] 14.3 Implement Admin plan and entitlement management
    - Implement `createPlan()`, `updatePlan()`, `deactivatePlan()`
    - Implement `setFeatureEntitlements()` — toggle features per plan, invalidate Redis cache
    - Implement `getFeatureRegistry()` — return all registered features for admin UI
    - Wire subscription metrics (subscribers per tier, MRR, churn, upgrades/downgrades)
    - _Requirements: 17.6, 17.7, 17.8, 18.10_

  - [x] 14.4 Implement Admin MFA middleware and auth flow
    - Create `/src/server/middleware/adminAuth.ts`
    - Implement TOTP-based MFA verification
    - Require admin role + MFA verification for all /api/admin/* routes
    - Deny access and log attempts from non-admin or unverified users
    - Serve Admin Console SPA at `/admin` route
    - _Requirements: 17.1, 17.11, 17.12_

  - [x] 14.5 Create Admin API routes
    - Create `GET /api/admin/users` — list users (no content)
    - Create `GET /api/admin/users/:id` — user detail (no content)
    - Create `POST /api/admin/users/:id/disable` — disable account
    - Create `POST /api/admin/users/:id/delete` — mark for deletion
    - Create `POST /api/admin/users/:id/unlock` — unlock account
    - Create `GET /api/admin/metrics` — system metrics
    - Create `GET /api/admin/metrics/subscriptions` — subscription metrics
    - Create `GET/POST /api/admin/plans`, `PUT /api/admin/plans/:id`, `POST /api/admin/plans/:id/deactivate`
    - Create `GET/PUT /api/admin/plans/:id/entitlements`
    - Create `GET /api/admin/features` — registered features
    - Create `GET /api/admin/audit` — audit trail
    - Create `POST /api/admin/moderate/:userId` — moderation action
    - _Requirements: 17.2, 17.5, 17.6, 17.7, 17.9, 17.10, 17.11_

  - [x] 14.6 Write property test for admin content isolation
    - **Property 26: Admin Content Isolation**
    - Verify admin responses never contain content_encrypted, item text, URLs, code, or file data
    - Generator: random admin operations, random user data with content fields
    - **Validates: Requirements 17.3, 17.4**

  - [x] 14.7 Write property test for admin access control
    - **Property 27: Admin Access Control**
    - Verify access granted iff user has admin role AND completed MFA; denied otherwise
    - Generator: random users with/without admin role, with/without MFA verification
    - **Validates: Requirements 17.1, 17.12**

- [x] 15. Checkpoint - Admin and subscription backend verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. React frontend - Dashboard and core UI
  - [x] 16.1 Set up React application with routing and auth context
    - Initialize React app with TypeScript in `/src/client/`
    - Set up React Router with protected routes
    - Implement auth context with JWT storage/refresh
    - Create login/registration pages
    - Set up dark theme with CSS variables or styled-components
    - Configure responsive breakpoints (320px to 2560px)
    - _Requirements: 1.1, 8.8_

  - [x] 16.2 Implement Dashboard layout and ItemGrid with masonry
    - Create `Dashboard` component with sidebar navigation and content area
    - Implement `ItemGrid` with responsive masonry layout (adapt columns by viewport)
    - Implement `ItemCard` showing thumbnail, title, snippet, source domain, timestamp, tag badges
    - Implement `CategoryBadge` with colored hashtag-style labels
    - Display recent items, active maps, summary statistics on dashboard load
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.9_

  - [x] 16.3 Write property test for item card rendering completeness
    - **Property 11: Item Card Rendering Completeness**
    - Verify card displays title, snippet, source domain, timestamp, and all tag badges with hashtag + color
    - Generator: random items with populated fields
    - **Validates: Requirements 8.2, 8.4**

  - [x] 16.4 Implement search, filtering, and item detail views
    - Implement `SearchBar` with category, tag, date range, keyword filters
    - Implement `ItemDetail` showing full content, categories with confidence, related items
    - Implement `MapViewer` with interactive graph visualization (D3 or react-force-graph)
    - _Requirements: 8.5, 8.6, 8.7_

  - [x] 16.5 Write property test for item detail completeness
    - **Property 13: Item Detail Completeness**
    - Verify detail view displays full content, all categories with confidence, and all related items
    - Generator: random items with assigned categories and relationships
    - **Validates: Requirements 8.7**

  - [x] 16.6 Implement Upload Form and CSV upload UI
    - Create `UploadForm` with text input, file upload (drag-and-drop), metadata tags
    - Add CSV file upload option with progress indicator
    - Display import results summary (created/skipped counts)
    - Add CSV template download button
    - _Requirements: 5.1, 5.6, 13.1, 13.12_

- [x] 17. React frontend - Billing and Admin Console
  - [x] 17.1 Implement Billing management pages
    - Create `BillingPage` with current plan, payment history, cancel option
    - Create `PlanSelector` with plan comparison table (Free/Pro/Enterprise)
    - Create `UsageMeter` showing storage and AI query usage vs limits
    - Implement upgrade/downgrade flows with Stripe Checkout integration
    - _Requirements: 18.9_

  - [x] 17.2 Implement Admin Console SPA
    - Create `/src/client/admin/` with separate routing
    - Implement `AdminLayout` with admin navigation sidebar
    - Implement `AdminMfaGate` — MFA verification before access
    - Implement `UserManagement` — user list with disable/delete/unlock (no card content)
    - Implement `SystemMetricsDashboard` — real-time metrics display
    - Implement `PlanManagement` — create/modify/deactivate plans
    - Implement `FeatureEntitlementEditor` — toggle features per plan
    - Implement `ModerationPanel` — flag/disable accounts
    - Implement `AuditTrailViewer` — filterable audit log
    - Implement `SubscriptionMetrics` — subscribers, MRR, churn
    - _Requirements: 17.1, 17.2, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 17.11, 17.12, 18.10_

- [x] 18. Documentation system
  - [x] 18.1 Create Data Dictionary document
    - Create `/docs/data-dictionary.md` with all entities, fields, types, constraints
    - Document all enum values and their meanings
    - Document all entity relationships with cardinality and cascade behavior
    - Include field descriptions: name, type, nullable, default, constraints, FK refs
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.6_

  - [x] 18.2 Create User Manual documentation
    - Create `/docs/user-manual/index.md` with table of contents
    - Create getting-started.md — registration, first item, dashboard orientation
    - Create input-channels.md — API, SMS, web upload, CSV import with examples
    - Create dashboard.md — navigation, search, filtering
    - Create maps.md — map visualization
    - Create ai-tools.md — AI query, suggestions
    - Create integrations.md — n8n, Notion, API keys
    - Create csv-import-export.md — CSV bulk operations
    - Create api-reference.md — all endpoints with request/response examples
    - Create troubleshooting.md — common errors and resolutions
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.7, 15.8_

  - [x] 18.3 Implement OpenAPI specification and Swagger UI
    - Create `/docs/openapi.yaml` with OpenAPI 3.0 spec for all endpoints
    - Configure swagger-jsdoc for auto-generation from route annotations
    - Set up swagger-ui-express at `/api-docs` route with "Try it out" enabled
    - Group endpoints by domain tags: auth, items, maps, ai, integrations, webhooks, csv, keys, admin, billing
    - Document securitySchemes (Bearer JWT and API Key)
    - Document all error response codes per endpoint
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8_

  - [x] 18.4 Implement documentation serving routes
    - Create middleware to serve rendered markdown at `/docs` route
    - Configure Express static middleware for user manual markdown files
    - Implement table of contents navigation with section links
    - _Requirements: 15.7_

- [x] 19. Docker containerization
  - [x] 19.1 Create Dockerfile and container configuration
    - Create multi-stage Dockerfile (build + runtime)
    - Include all runtime dependencies
    - Expose single HTTP port
    - Accept configuration via environment variables (DB, Redis, API keys, Twilio, Stripe, OpenAI)
    - Implement health check endpoint with 30-second readiness target
    - Configure structured JSON log output to stdout
    - Create docker-compose.yml for local development (app + PostgreSQL + Redis + MinIO)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 20. CI/CD pipeline
  - [x] 20.1 Create GitHub Actions workflow
    - Create `.github/workflows/ci-cd.yml`
    - Configure build step: TypeScript compilation, lint, Docker build
    - Configure test step: unit tests, property-based tests, integration tests
    - Configure push step: push image to container registry on test pass
    - Configure deploy step: deploy container to target environment
    - Add commit status notifications on failure
    - Target: build-test-deploy within 10 minutes
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 20.2 Implement CI validation steps for documentation co-changes
    - Add step: warn when migration files modified without data-dictionary.md update
    - Add step: warn when route handlers/UI modified without user-manual update
    - Add step: validate OpenAPI spec syntax (`swagger-cli validate`)
    - Add step: warn when route handlers modified without openapi.yaml update
    - _Requirements: 14.5, 14.7, 15.6, 15.9, 16.7, 16.9_

- [x] 21. Checkpoint - Full system integration verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 22. Background jobs and data lifecycle
  - [x] 22.1 Implement soft-delete purge job and background tasks
    - Create BullMQ scheduled job to permanently purge soft-deleted items after 24 hours
    - Create Stripe payment retry scheduled job (day 1, day 3, day 7)
    - Implement user notification on payment failure
    - Revert subscription to Free after 3 failed retries
    - _Requirements: 12.4, 18.11_

- [x] 23. Final integration and wiring
  - [x] 23.1 Wire all middleware chains and route registration
    - Ensure all routes pass through: auth → entitlement → rate limit → handler
    - Verify admin routes pass through: auth → admin role → MFA → handler
    - Verify webhook routes (Stripe, Twilio) bypass user auth but verify signatures
    - Register all feature modules with @RegisterFeature decorators
    - Verify TLS configuration documentation for reverse proxy
    - _Requirements: 1.1, 2.2, 3.4, 12.1, 17.1, 17.12, 18.12_

  - [x] 23.2 Write integration tests for full subscription and entitlement flow
    - Test: Free user → attempt SMS → 402 → upgrade to Pro → SMS succeeds
    - Test: Admin toggles feature off → user immediately gets 402
    - Test: User downgrades → features work until period end
    - Test: Payment fails → 3 retries → revert to Free
    - _Requirements: 18.7, 18.8, 18.12, 18.14_

  - [x] 23.3 Write integration tests for admin content isolation end-to-end
    - Test: Admin lists users → response has no card content
    - Test: Admin attempts content access → denied and audit logged
    - Test: Admin manages plans → entitlements propagate to users
    - _Requirements: 17.3, 17.4, 17.8_

- [x] 24. Final checkpoint - All tests pass, full system verified
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at logical breakpoints
- Property tests validate universal correctness properties using fast-check with 100+ iterations each
- Unit tests validate specific examples and edge cases
- All 34 correctness properties from the design document are covered as property test sub-tasks
- The Feature Registry auto-registers features at startup via @RegisterFeature decorators
- Admin content isolation is enforced structurally at the data access layer
- Entitlement changes propagate immediately via Redis cache invalidation

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "1.5", "1.7"] },
    { "id": 3, "tasks": ["1.6", "1.8", "2.1"] },
    { "id": 4, "tasks": ["2.2", "2.3", "2.4", "2.6"] },
    { "id": 5, "tasks": ["2.5", "2.7", "2.10"] },
    { "id": 6, "tasks": ["2.8", "2.9", "4.1"] },
    { "id": 7, "tasks": ["4.2", "4.3", "5.1"] },
    { "id": 8, "tasks": ["4.4", "5.2", "5.3", "6.1"] },
    { "id": 9, "tasks": ["6.2", "7.1"] },
    { "id": 10, "tasks": ["7.2", "7.3", "7.4"] },
    { "id": 11, "tasks": ["9.1", "10.1"] },
    { "id": 12, "tasks": ["9.2", "9.3", "9.4", "9.5", "9.6", "9.7", "10.2", "10.3"] },
    { "id": 13, "tasks": ["9.8", "9.9", "11.1"] },
    { "id": 14, "tasks": ["11.2", "11.3"] },
    { "id": 15, "tasks": ["11.4", "11.5", "12.1"] },
    { "id": 16, "tasks": ["12.2"] },
    { "id": 17, "tasks": ["12.3", "12.4", "12.5", "12.6", "12.7"] },
    { "id": 18, "tasks": ["14.1"] },
    { "id": 19, "tasks": ["14.2", "14.3", "14.4"] },
    { "id": 20, "tasks": ["14.5", "14.6", "14.7"] },
    { "id": 21, "tasks": ["16.1"] },
    { "id": 22, "tasks": ["16.2", "16.4", "16.6"] },
    { "id": 23, "tasks": ["16.3", "16.5", "17.1", "17.2"] },
    { "id": 24, "tasks": ["18.1", "18.2", "18.3"] },
    { "id": 25, "tasks": ["18.4", "19.1"] },
    { "id": 26, "tasks": ["20.1", "20.2"] },
    { "id": 27, "tasks": ["22.1"] },
    { "id": 28, "tasks": ["23.1"] },
    { "id": 29, "tasks": ["23.2", "23.3"] }
  ]
}
```
