# Data Dictionary

> Reference document for all database entities, fields, types, constraints, and relationships in MindAtlas.

## Table of Contents

- [Entities](#entities)
  - [users](#users)
  - [categories](#categories)
  - [tags](#tags)
  - [items](#items)
  - [item_tags](#item_tags)
  - [relationships](#relationships)
  - [maps](#maps)
  - [map_nodes](#map_nodes)
  - [map_edges](#map_edges)
  - [api_keys](#api_keys)
  - [notion_connections](#notion_connections)
  - [feature_registry](#feature_registry)
  - [subscription_plans](#subscription_plans)
  - [plan_entitlements](#plan_entitlements)
  - [subscriptions](#subscriptions)
  - [payment_history](#payment_history)
  - [admin_roles](#admin_roles)
  - [admin_users](#admin_users)
  - [audit_log](#audit_log)
- [Views](#views)
  - [admin_user_summary](#admin_user_summary)
- [Enum Values](#enum-values)
- [Relationships](#relationships-1)

---

## Entities

### users

Registered user accounts with authentication and lockout state.

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique user identifier |
| email | varchar(255) | NO | — | UNIQUE, indexed | User's email address (login identifier) |
| password_hash | varchar(255) | NO | — | — | Bcrypt-hashed password (cost factor ≥ 12) |
| phone_number | varchar(20) | YES | NULL | UNIQUE, indexed | SMS-registered phone number |
| is_locked | boolean | NO | `false` | — | Whether the account is currently locked |
| locked_until | timestamptz | YES | NULL | — | Timestamp when lockout expires |
| failed_attempts | integer | NO | `0` | — | Consecutive failed login attempts |
| role | varchar(20) | NO | `'user'` | CHECK: `role IN ('user', 'admin')` | Application-level role |
| created_at | timestamptz | NO | `now()` | — | Account creation timestamp |
| updated_at | timestamptz | NO | `now()` | — | Last update timestamp |

---

### categories

Top-level groupings for organizing tags.

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique category identifier |
| name | varchar(100) | NO | — | UNIQUE | Category display name |
| color | varchar(7) | NO | `'#6B7280'` | — | Hex color code for UI display |

---

### tags

Labels belonging to a category, assigned to items for classification.

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique tag identifier |
| category_id | uuid | NO | — | FK → categories(id) ON DELETE CASCADE, indexed | Parent category |
| name | varchar(100) | NO | — | UNIQUE(name, category_id) | Tag display name (unique within category) |
| color | varchar(7) | NO | `'#6B7280'` | — | Hex color code for UI display |

---

### items

User-owned content entries (cards). Content is stored encrypted at rest.

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique item identifier |
| user_id | uuid | NO | — | FK → users(id) ON DELETE CASCADE, indexed | Owning user |
| title | varchar(500) | YES | NULL | — | Optional item title |
| content_encrypted | text | NO | — | — | AES-256 encrypted item content |
| content_type | varchar(50) | NO | `'plain_text'` | indexed | Content format (see [Enum: content_type](#content_type)) |
| metadata | jsonb | YES | `'{}'` | — | Arbitrary key-value metadata |
| source_channel | varchar(50) | YES | NULL | — | Input channel origin (api, sms, web_upload, csv, webhook) |
| source_domain | varchar(255) | YES | NULL | — | Domain of link-type content |
| file_path | varchar(1024) | YES | NULL | — | Storage path for file uploads |
| file_size | integer | YES | NULL | — | File size in bytes |
| is_deleted | boolean | NO | `false` | indexed (composite with user_id) | Soft-delete flag |
| deleted_at | timestamptz | YES | NULL | — | When item was soft-deleted |
| created_at | timestamptz | NO | `now()` | indexed | Item creation timestamp |
| updated_at | timestamptz | NO | `now()` | — | Last update timestamp |

---

### item_tags

Junction table linking items to tags (many-to-many) with AI confidence scores.

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| item_id | uuid | NO | — | PK (composite), FK → items(id) ON DELETE CASCADE | Tagged item |
| tag_id | uuid | NO | — | PK (composite), FK → tags(id) ON DELETE CASCADE, indexed | Assigned tag |
| confidence_score | real | NO | `1.0` | — | AI confidence for this tag assignment (0.0–1.0) |

---

### relationships

AI-discovered connections between two items owned by the same user.

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique relationship identifier |
| source_item_id | uuid | NO | — | FK → items(id) ON DELETE CASCADE, indexed | Source item |
| target_item_id | uuid | NO | — | FK → items(id) ON DELETE CASCADE, indexed | Target item |
| relationship_type | varchar(100) | NO | — | — | Type of relationship (e.g., "related_to", "similar", "depends_on") |
| strength | real | NO | `0.5` | — | Relationship strength (0.0–1.0) |
| created_at | timestamptz | NO | `now()` | — | Creation timestamp |

**Check constraint:** `source_item_id != target_item_id` (no self-references)

---

### maps

Visual map representations of item relationships for a user.

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique map identifier |
| user_id | uuid | NO | — | FK → users(id) ON DELETE CASCADE, indexed | Owning user |
| title | varchar(500) | NO | — | — | Map title |
| layout_data | jsonb | YES | `'{}'` | — | Serialized layout/positioning metadata |
| generated_at | timestamptz | YES | NULL | — | When AI last generated/updated this map |
| created_at | timestamptz | NO | `now()` | — | Map creation timestamp |

---

### map_nodes

Items placed on a map with position coordinates.

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique node identifier |
| map_id | uuid | NO | — | FK → maps(id) ON DELETE CASCADE, indexed, UNIQUE(map_id, item_id) | Parent map |
| item_id | uuid | NO | — | FK → items(id) ON DELETE CASCADE, indexed, UNIQUE(map_id, item_id) | Referenced item |
| x_position | real | NO | `0` | — | Horizontal position on map canvas |
| y_position | real | NO | `0` | — | Vertical position on map canvas |

---

### map_edges

Relationships rendered on a map.

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique edge identifier |
| map_id | uuid | NO | — | FK → maps(id) ON DELETE CASCADE, indexed, UNIQUE(map_id, relationship_id) | Parent map |
| relationship_id | uuid | NO | — | FK → relationships(id) ON DELETE CASCADE, indexed, UNIQUE(map_id, relationship_id) | Rendered relationship |

---

### api_keys

User-generated API keys for programmatic and third-party access.

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique key record identifier |
| user_id | uuid | NO | — | FK → users(id) ON DELETE CASCADE, indexed | Owning user |
| key_hash | varchar(255) | NO | — | UNIQUE, indexed | Hashed API key value |
| label | varchar(255) | NO | — | — | User-defined label for the key |
| is_active | boolean | NO | `true` | — | Whether the key is currently active |
| last_used_at | timestamptz | YES | NULL | — | Last time key was used for authentication |
| created_at | timestamptz | NO | `now()` | — | Key creation timestamp |

---

### notion_connections

OAuth connections to user Notion workspaces (one per user).

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique connection identifier |
| user_id | uuid | NO | — | FK → users(id) ON DELETE CASCADE, UNIQUE, indexed | Owning user (one connection per user) |
| access_token_encrypted | text | NO | — | — | Encrypted Notion OAuth access token |
| workspace_id | varchar(255) | NO | — | — | Notion workspace identifier |
| workspace_name | varchar(255) | YES | NULL | — | Notion workspace display name |
| connected_at | timestamptz | NO | `now()` | — | When the connection was established |

---

### feature_registry

Registry of all application features available for entitlement assignment.

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique feature identifier |
| key | varchar(255) | NO | — | UNIQUE, indexed | Unique feature key (e.g., "ai.categorization") |
| name | varchar(255) | NO | — | — | Human-readable feature name |
| description | text | NO | — | — | Feature description |
| category | varchar(50) | NO | — | CHECK (see [Enum: feature_category](#feature_category)), indexed | Feature grouping category |
| created_at | timestamptz | NO | `now()` | — | Registration timestamp |

---

### subscription_plans

Defines available subscription tiers with limits and pricing.

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique plan identifier |
| name | varchar(50) | NO | — | UNIQUE, indexed | Internal plan name (e.g., "free", "pro", "enterprise") |
| display_name | varchar(100) | NO | — | — | User-facing plan name |
| stripe_price_id | varchar(255) | YES | NULL | — | Stripe Price object ID for billing |
| price_monthly_cents | integer | NO | `0` | — | Monthly price in cents (0 = free) |
| storage_limit_mb | integer | NO | — | — | File storage limit in MB |
| ai_queries_per_day | integer | NO | — | — | Daily AI query limit (-1 = unlimited) |
| is_active | boolean | NO | `true` | indexed | Whether plan is available for new subscriptions |
| created_at | timestamptz | NO | `now()` | — | Plan creation timestamp |
| updated_at | timestamptz | NO | `now()` | — | Last modification timestamp |

---

### plan_entitlements

Maps features to subscription plans (which features each plan includes).

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique entitlement identifier |
| plan_id | uuid | NO | — | FK → subscription_plans(id) ON DELETE CASCADE, indexed, UNIQUE(plan_id, feature_key) | Parent plan |
| feature_key | varchar(255) | NO | — | indexed, UNIQUE(plan_id, feature_key) | Feature key (references feature_registry.key) |
| enabled | boolean | NO | `true` | — | Whether feature is enabled for this plan |
| created_at | timestamptz | NO | `now()` | — | Entitlement creation timestamp |

---

### subscriptions

Active user subscription state (one subscription per user).

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique subscription identifier |
| user_id | uuid | NO | — | FK → users(id) ON DELETE CASCADE, UNIQUE, indexed | Subscribing user (one active subscription per user) |
| plan_id | uuid | NO | — | FK → subscription_plans(id) ON DELETE RESTRICT, indexed | Current subscription plan |
| status | varchar(20) | NO | `'active'` | CHECK (see [Enum: subscription_status](#subscription_status)), indexed | Current subscription status |
| stripe_subscription_id | varchar(255) | YES | NULL | indexed | Stripe Subscription object ID |
| stripe_customer_id | varchar(255) | YES | NULL | — | Stripe Customer object ID |
| current_period_start | timestamptz | YES | NULL | — | Current billing period start |
| current_period_end | timestamptz | YES | NULL | — | Current billing period end |
| pending_plan_id | uuid | YES | NULL | FK → subscription_plans(id) ON DELETE SET NULL | Plan to switch to at period end (downgrade) |
| canceled_at | timestamptz | YES | NULL | — | When user requested cancellation |
| created_at | timestamptz | NO | `now()` | — | Subscription creation timestamp |
| updated_at | timestamptz | NO | `now()` | — | Last state change timestamp |

---

### payment_history

Record of all payment attempts and outcomes.

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique payment record identifier |
| user_id | uuid | NO | — | FK → users(id) ON DELETE CASCADE, indexed | Paying user |
| subscription_id | uuid | NO | — | FK → subscriptions(id) ON DELETE CASCADE, indexed | Related subscription |
| amount_cents | integer | NO | — | — | Charge amount in cents |
| currency | varchar(3) | NO | `'usd'` | — | ISO 4217 currency code |
| stripe_payment_intent_id | varchar(255) | YES | NULL | indexed | Stripe PaymentIntent ID |
| status | varchar(20) | NO | — | CHECK (see [Enum: payment_status](#payment_status)), indexed | Payment outcome |
| retry_count | integer | NO | `0` | — | Number of retry attempts |
| next_retry_at | timestamptz | YES | NULL | — | Scheduled next retry timestamp |
| created_at | timestamptz | NO | `now()` | — | Payment record creation timestamp |

---

### admin_roles

Predefined administrative role definitions with permission sets.

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique role identifier |
| name | varchar(50) | NO | — | UNIQUE, indexed | Role name (see [Enum: admin_role_name](#admin_role_name)) |
| permissions | jsonb | NO | `'[]'` | — | Array of permission strings |
| created_at | timestamptz | NO | `now()` | — | Role creation timestamp |

---

### admin_users

Maps users to admin roles with MFA configuration.

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique admin user identifier |
| user_id | uuid | NO | — | FK → users(id) ON DELETE CASCADE, UNIQUE, indexed | Associated user account |
| role_id | uuid | NO | — | FK → admin_roles(id) ON DELETE RESTRICT, indexed | Assigned admin role |
| mfa_enabled | boolean | NO | `false` | — | Whether MFA is active |
| mfa_secret | varchar(255) | YES | NULL | — | Encrypted TOTP secret |
| created_at | timestamptz | NO | `now()` | — | Admin promotion timestamp |

---

### audit_log

Immutable log of all administrative actions.

| Field | Type | Nullable | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| id | uuid | NO | `uuid_generate_v4()` | PK | Unique log entry identifier |
| admin_user_id | uuid | NO | — | FK → admin_users(id) ON DELETE RESTRICT, indexed | Admin who performed action |
| action | varchar(100) | NO | — | indexed | Action performed (e.g., "user.disable", "plan.modify") |
| target_type | varchar(50) | NO | — | indexed | Entity type affected (e.g., "user", "plan", "subscription") |
| target_id | varchar(255) | YES | NULL | — | Identifier of affected entity |
| details | jsonb | YES | `'{}'` | — | Additional action context/metadata |
| created_at | timestamptz | NO | `now()` | indexed | When action occurred |

---

## Views

### admin_user_summary

Read-only view for admin dashboards. Joins user data with subscription info and storage metrics. **Does not expose content_encrypted or file_path fields.**

| Column | Source | Description |
|--------|--------|-------------|
| user_id | users.id | User identifier |
| email | users.email | User email |
| role | users.role | Application role |
| is_locked | users.is_locked | Lock status |
| locked_until | users.locked_until | Lock expiry |
| registration_date | users.created_at | Account creation date |
| updated_at | users.updated_at | Last user update |
| subscription_id | subscriptions.id | Active subscription ID |
| plan_name | subscription_plans.name | Plan internal name |
| plan_display_name | subscription_plans.display_name | Plan display name |
| subscription_status | subscriptions.status | Subscription state |
| current_period_end | subscriptions.current_period_end | Billing period end |
| card_count | COUNT(items) | Total non-deleted items |
| total_storage_used_bytes | SUM(items.file_size) | Total file storage in bytes |

---

## Enum Values

### content_type

Used in: `items.content_type`

| Value | Description |
|-------|-------------|
| `plain_text` | Plain text content (default) |
| `link` | URL/hyperlink |
| `code_snippet` | Source code |
| `note` | Personal note |
| `task` | Actionable task |
| `idea` | Brainstorm/idea |
| `file` | Uploaded file |
| `custom` | User-defined type |

### user_role

Used in: `users.role`

| Value | Description |
|-------|-------------|
| `user` | Standard user (default) |
| `admin` | Application administrator |

### subscription_status

Used in: `subscriptions.status`

| Value | Description |
|-------|-------------|
| `active` | Subscription is active and in good standing (default) |
| `cancelled` | User cancelled; access continues until period end |
| `past_due` | Payment failed; in retry/grace period |
| `trialing` | In trial period |

### payment_status

Used in: `payment_history.status`

| Value | Description |
|-------|-------------|
| `succeeded` | Payment processed successfully |
| `failed` | Payment attempt failed |
| `pending` | Payment is processing |
| `refunded` | Payment was refunded |

### feature_category

Used in: `feature_registry.category`

| Value | Description |
|-------|-------------|
| `input_channels` | Data input methods (web upload, SMS, API, CSV) |
| `ai_capabilities` | AI features (categorization, mapping, NLP, etc.) |
| `integrations` | Third-party integrations (Notion, n8n) |
| `export_formats` | Data export capabilities (CSV) |
| `advanced` | Premium features (custom categories, etc.) |

### admin_role_name

Used in: `admin_roles.name` (seeded values)

| Value | Permissions | Description |
|-------|-------------|-------------|
| `super_admin` | users.view, users.disable, users.delete, users.unlock, plans.create, plans.modify, plans.deactivate, entitlements.manage, moderation.flag, moderation.disable, audit.view, metrics.view, roles.manage | Full system access including role management |
| `admin` | users.view, users.disable, users.delete, users.unlock, plans.create, plans.modify, plans.deactivate, entitlements.manage, audit.view, metrics.view | User and plan management (no role management) |
| `moderator` | users.view, moderation.flag, moderation.disable, audit.view | Content moderation and user flagging only |

### feature_keys

Used in: `plan_entitlements.feature_key`, `feature_registry.key`

| Key | Category | Description |
|-----|----------|-------------|
| `ai.categorization` | ai_capabilities | Automatic content categorization |
| `ai.relationship_mapping` | ai_capabilities | AI relationship discovery between items |
| `ai.natural_language` | ai_capabilities | Natural language queries over items |
| `ai.cluster_summaries` | ai_capabilities | AI-generated summaries of item clusters |
| `ai.suggestions` | ai_capabilities | AI-powered item recommendations |
| `ai.priority_processing` | ai_capabilities | Priority queue for AI processing |
| `input.web_upload` | input_channels | Web interface file/text upload |
| `input.sms` | input_channels | SMS message input |
| `input.api` | input_channels | REST API input |
| `input.csv` | input_channels | CSV bulk import |
| `integration.notion` | integrations | Notion workspace sync |
| `integration.n8n` | integrations | n8n workflow automation |
| `export.csv` | export_formats | CSV data export |
| `advanced.custom_categories` | advanced | Custom user-defined categories |

---

## Relationships

### One-to-Many

| Parent | Child | FK Column | On Delete | Description |
|--------|-------|-----------|-----------|-------------|
| users | items | items.user_id | CASCADE | User owns many items |
| users | maps | maps.user_id | CASCADE | User owns many maps |
| users | api_keys | api_keys.user_id | CASCADE | User has many API keys |
| users | payment_history | payment_history.user_id | CASCADE | User has many payments |
| categories | tags | tags.category_id | CASCADE | Category contains many tags |
| items | relationships (source) | relationships.source_item_id | CASCADE | Item can be source of many relationships |
| items | relationships (target) | relationships.target_item_id | CASCADE | Item can be target of many relationships |
| maps | map_nodes | map_nodes.map_id | CASCADE | Map contains many nodes |
| maps | map_edges | map_edges.map_id | CASCADE | Map contains many edges |
| subscription_plans | plan_entitlements | plan_entitlements.plan_id | CASCADE | Plan has many feature entitlements |
| subscription_plans | subscriptions | subscriptions.plan_id | RESTRICT | Plan is referenced by subscriptions (cannot delete active plan) |
| subscriptions | payment_history | payment_history.subscription_id | CASCADE | Subscription has payment history |
| admin_roles | admin_users | admin_users.role_id | RESTRICT | Role assigned to many admins (cannot delete role in use) |
| admin_users | audit_log | audit_log.admin_user_id | RESTRICT | Admin has many audit entries (cannot delete admin with history) |

### One-to-One

| Parent | Child | FK Column | On Delete | Description |
|--------|-------|-----------|-----------|-------------|
| users | notion_connections | notion_connections.user_id | CASCADE | User has one Notion connection |
| users | subscriptions | subscriptions.user_id | CASCADE | User has one active subscription |
| users | admin_users | admin_users.user_id | CASCADE | User has one admin profile |

### Many-to-Many

| Table A | Table B | Junction Table | Description |
|---------|---------|---------------|-------------|
| items | tags | item_tags | Items can have many tags; tags can be on many items |
| maps | items | map_nodes | Maps contain many items; items can appear on many maps |
| maps | relationships | map_edges | Maps render many relationships; relationships can appear on many maps |

### Self-Referential

| Table | FK Column | Constraint | Description |
|-------|-----------|------------|-------------|
| subscription_plans | subscriptions.pending_plan_id | ON DELETE SET NULL | Subscription can reference a pending plan for future downgrade |

---

## Notes

- All primary keys use UUID v4 generated by PostgreSQL's `uuid-ossp` extension.
- All timestamps use `timestamp with time zone` (timestamptz) and default to `now()`.
- Encrypted fields (`content_encrypted`, `access_token_encrypted`) use AES-256 application-level encryption.
- Soft deletes on `items` use the `is_deleted` flag; hard deletion occurs within 24 hours per data policy.
- The `ai_queries_per_day` value of `-1` represents unlimited queries (Enterprise tier).
