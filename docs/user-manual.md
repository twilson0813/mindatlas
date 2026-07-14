# MindAtlas User Manual

## Table of Contents

- [1. Getting Started](#1-getting-started)
  - [1.1 Registration](#11-registration)
  - [1.2 Creating Your First Item](#12-creating-your-first-item)
  - [1.3 Dashboard Orientation](#13-dashboard-orientation)
- [2. Input Channels](#2-input-channels)
  - [2.1 REST API](#21-rest-api)
  - [2.2 SMS](#22-sms)
  - [2.3 Web Upload](#23-web-upload)
  - [2.4 CSV Import](#24-csv-import)
- [3. Dashboard Navigation](#3-dashboard-navigation)
  - [3.1 Layout Overview](#31-layout-overview)
  - [3.2 Item Card Grid](#32-item-card-grid)
  - [3.3 Search and Filters](#33-search-and-filters)
  - [3.4 Item Details](#34-item-details)
- [4. Maps and Relationships](#4-maps-and-relationships)
  - [4.1 Viewing Maps](#41-viewing-maps)
  - [4.2 Regenerating Maps](#42-regenerating-maps)
- [5. AI Tools](#5-ai-tools)
  - [5.1 Automatic Categorization](#51-automatic-categorization)
  - [5.2 Natural Language Queries](#52-natural-language-queries)
  - [5.3 Suggestions](#53-suggestions)
- [6. Integrations](#6-integrations)
  - [6.1 Notion Integration](#61-notion-integration)
  - [6.2 n8n and Webhooks](#62-n8n-and-webhooks)
  - [6.3 API Key Management](#63-api-key-management)
- [7. Data Export](#7-data-export)
  - [7.1 Export Items as CSV](#71-export-items-as-csv)
  - [7.2 Export Maps as CSV](#72-export-maps-as-csv)
  - [7.3 CSV Template](#73-csv-template)
- [8. Billing and Subscription](#8-billing-and-subscription)
  - [8.1 Plans Overview](#81-plans-overview)
  - [8.2 Upgrading or Downgrading](#82-upgrading-or-downgrading)
  - [8.3 Usage and Limits](#83-usage-and-limits)
  - [8.4 Managing Payment Methods](#84-managing-payment-methods)
- [9. Troubleshooting](#9-troubleshooting)
  - [9.1 Authentication Errors](#91-authentication-errors)
  - [9.2 Upload Errors](#92-upload-errors)
  - [9.3 CSV Import Errors](#93-csv-import-errors)
  - [9.4 API Errors](#94-api-errors)
  - [9.5 Billing Errors](#95-billing-errors)

---

## 1. Getting Started

### 1.1 Registration

To create a MindAtlas account:

1. Navigate to the MindAtlas web app.
2. Click **Sign Up** and enter your email address and a password.
3. Your password must meet the following requirements:
   - Minimum 8 characters
   - At least one uppercase letter
   - At least one lowercase letter
   - At least one digit
   - At least one special character (e.g., `!@#$%^&*`)
4. Submit the form. You will be logged in and taken to your dashboard.

After registration, you can optionally add a phone number in your profile settings to enable the SMS input channel.

### 1.2 Creating Your First Item

Items are the core content units in MindAtlas. An item can be a note, link, task, idea, code snippet, or file.

The quickest way to create your first item:

1. From the dashboard, click the **+ New Item** button (or use the upload form).
2. Enter some text content (e.g., a quick note or idea).
3. Optionally select a content type and add metadata tags.
4. Click **Submit**.

Your item will be saved and automatically queued for AI categorization. Within moments, it will appear in your dashboard with AI-assigned category tags.

### 1.3 Dashboard Orientation

Once logged in, your dashboard displays:

- **Recent Items**: Your most recently created items shown as cards in a masonry grid.
- **Active Maps**: Visual graphs showing relationships between your items.
- **Summary Statistics**: Quick counts of your total items, maps, and categories.
- **Sidebar Navigation**: Access to Items, Maps, AI Tools, Integrations, Export, and Settings.

The dashboard is fully responsive and works on screens from 320px to 2560px wide.

---

## 2. Input Channels

MindAtlas supports multiple ways to send content into the system.

### 2.1 REST API

Send items programmatically via the REST API. All API requests require authentication using either a JWT bearer token or an API key.

**Endpoint:** `POST /api/items`

**Headers:**
```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "content": "Interesting article about distributed systems",
  "contentType": "link",
  "metadata": {
    "url": "https://example.com/article",
    "tags": ["engineering", "distributed-systems"]
  }
}
```

**Response (201 Created):**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "content": "Interesting article about distributed systems",
  "contentType": "link",
  "metadata": {
    "url": "https://example.com/article",
    "tags": ["engineering", "distributed-systems"]
  },
  "sourceChannel": "api",
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

**Supported content types:** `plain_text`, `link`, `code_snippet`, `note`, `task`, `idea`, `file`, `custom`

**Rate limit:** 100 requests per minute per user. Exceeding this returns a `429 Too Many Requests` response.

**Using an API key instead of JWT:**
```
X-API-Key: mk_live_abc123def456
```

### 2.2 SMS

Send items via text message for quick capture on the go.

**Setup:**
1. Go to **Settings > Phone Number** and register your phone number.
2. Send a text message to the MindAtlas SMS number provided in settings.

**How it works:**
- The message body becomes the item content.
- Items created via SMS are assigned `contentType: "note"` by default.
- You will receive a confirmation reply when your item is created.
- Messages from unregistered phone numbers are discarded.

**Retry behavior:** If processing fails, the system retries up to 3 times automatically.

### 2.3 Web Upload

Upload content directly from the dashboard interface.

**To upload:**
1. Click **+ New Item** or navigate to the upload form.
2. Choose one of:
   - **Text entry**: Type or paste plain text content directly.
   - **File upload**: Drag and drop or browse to select a file.
3. Add optional metadata tags.
4. Click **Submit**.

**File upload limits:**
- Maximum file size: 25 MB
- Supported file types: PDF, PNG, JPG, GIF, TXT, MD, CSV, JSON, and code files (.py, .js, .ts, .html, .css)

Files exceeding 25 MB will be rejected with an error message.

### 2.4 CSV Import

Import items in bulk by uploading a CSV file.

**Requirements:**
- The CSV must include a header row.
- Required column: `content`
- Optional columns: `content_type`, `tags`, `metadata`
- Maximum file size: 10 MB
- Maximum rows: 5,000

**Example CSV:**
```csv
content,content_type,tags,metadata
"My first note about project planning",note,"planning,projects","{""priority"": ""high""}"
"https://example.com/resource",link,"resources,reading",""
"def hello(): print('world')",code_snippet,"python,snippets",""
```

**To import:**
1. Navigate to **Items > Import CSV** or use the upload form.
2. Select your CSV file.
3. The system validates the file structure and creates one item per row.
4. After import, you receive a summary showing items created and any skipped rows.

Rows with missing `content` values are skipped and reported. You can download a CSV template from the import page to get started (see [7.3 CSV Template](#73-csv-template)).

---

## 3. Dashboard Navigation

### 3.1 Layout Overview

The dashboard uses a sidebar + content area layout:

- **Left Sidebar**: Navigation links to Items, Maps, AI Tools, Integrations, Export, Billing, and Settings.
- **Main Content Area**: Displays the active view (items grid, map viewer, etc.).
- **Top Bar**: Search interface and user account menu.

The initial dashboard view loads within 3 seconds on a standard broadband connection.

### 3.2 Item Card Grid

Items are displayed as cards in a responsive masonry-style grid. Each card shows:

- **Thumbnail preview** (for images and files, when available)
- **Title** (derived from content or metadata)
- **Content snippet** (first few lines of text)
- **Source domain** (for link items)
- **Timestamp** (creation date)
- **Category/tag badges** (colored labels with hashtag notation, e.g., `#engineering`)

The grid adapts its column count based on your screen width, fitting more columns on wider displays.

### 3.3 Search and Filters

Use the search bar at the top of the dashboard to find items. You can filter by:

- **Keywords**: Free-text search across item content
- **Category**: Filter by AI-assigned categories
- **Tags**: Filter by specific tags
- **Date range**: Show items from a specific time period
- **Content type**: Filter by type (note, link, code_snippet, etc.)

Combine multiple filters to narrow results. Filters are applied immediately and the grid updates in real time.

### 3.4 Item Details

Click any item card to view its full details:

- Complete content (text, rendered markdown, or file preview)
- All assigned categories and tags with confidence scores
- Related items (other items the AI identified as connected)
- Metadata and source information
- Creation and modification timestamps

From the detail view, you can edit metadata, delete the item, or navigate to related items.

---

## 4. Maps and Relationships

### 4.1 Viewing Maps

Maps are visual graphs that show how your items relate to each other. They are generated automatically by the AI as you add items.

To view your maps:
1. Click **Maps** in the sidebar.
2. Select a map to open the interactive graph viewer.

The map viewer displays:
- **Nodes**: Each node represents one of your items.
- **Edges**: Lines connecting nodes represent relationships (e.g., similar topic, shared tags, contextual relevance).
- **Relationship strength**: Edge thickness or color indicates how strong the AI-detected relationship is.

You can zoom, pan, and click nodes to see item details.

### 4.2 Regenerating Maps

As you add more items, you can regenerate maps to incorporate new content and relationships:

1. Open the Maps section.
2. Click **Regenerate Map**.
3. The AI re-analyzes all your items and rebuilds the relationship graph.

Regeneration may take a moment depending on how many items you have. The map updates once processing completes.

**API endpoint:** `POST /api/maps/regenerate`

---

## 5. AI Tools

MindAtlas uses AI to automatically organize your content and answer questions about it.

### 5.1 Automatic Categorization

When you create an item (through any input channel), the AI automatically:

- Assigns relevant **category tags** (e.g., "engineering", "personal", "research")
- Identifies **relationships** with your existing items
- Provides a **confidence score** (0 to 1) for each assigned tag

You can view confidence scores in the item detail view. Higher scores indicate stronger relevance.

### 5.2 Natural Language Queries

Ask questions about your content in plain English:

1. Navigate to **AI Tools > Query** (or use the search bar in AI mode).
2. Type your question, e.g., "What are my notes about machine learning?"
3. The AI returns:
   - Relevant items matching your query
   - A generated summary synthesizing the matched content

**API endpoint:** `POST /api/ai/query`

**Request:**
```json
{
  "query": "What are my notes about machine learning?"
}
```

**Response:**
```json
{
  "summary": "You have 5 items related to machine learning, covering topics including neural networks, training data preparation, and model deployment...",
  "items": [
    { "id": "...", "title": "ML Training Pipeline Notes", "relevance": 0.92 },
    { "id": "...", "title": "Neural Network Architecture Comparison", "relevance": 0.87 }
  ]
}
```

### 5.3 Suggestions

Get AI-powered suggestions for any item:

1. Open an item's detail view.
2. Click **Get Suggestions**.
3. The AI returns:
   - **Related items** you might want to review together
   - **Recommended actions** (e.g., "Consider linking this to your project planning notes")

**API endpoint:** `GET /api/ai/suggestions/:itemId`

If the AI encounters an error processing your request, it will return a message explaining the failure and suggest you retry.

---

## 6. Integrations

### 6.1 Notion Integration

Connect MindAtlas to your Notion workspace to sync content between both platforms.

**Connecting Notion:**
1. Go to **Settings > Integrations > Notion**.
2. Click **Connect Notion**.
3. Authorize MindAtlas in the Notion OAuth prompt.
4. Select which Notion pages or databases to sync.

**Importing from Notion:**
- After connecting, choose pages to import as MindAtlas items.
- Imported pages become items with `contentType: "note"` and preserve their text content.

**Exporting to Notion:**
- Select items or maps in MindAtlas and choose **Export to Notion**.
- Items are created as pages in your connected Notion workspace.

### 6.2 n8n and Webhooks

Integrate MindAtlas with n8n workflow automations or any webhook-capable tool.

**Webhook endpoint:** `POST /api/webhooks/n8n`

**Authentication:** Use an API key in the request header:
```
X-API-Key: mk_live_abc123def456
```

**Example n8n webhook payload:**
```json
{
  "content": "New lead from website form: John Doe, john@example.com",
  "contentType": "note",
  "metadata": {
    "source": "n8n",
    "workflow": "lead-capture",
    "tags": ["leads", "website"]
  }
}
```

**Response (201 Created):**
```json
{
  "id": "b2c3d4e5-f6a7-8901-bcde-f23456789012",
  "content": "New lead from website form: John Doe, john@example.com",
  "contentType": "note",
  "sourceChannel": "webhook",
  "createdAt": "2024-01-15T14:22:00.000Z"
}
```

Use this webhook in n8n to automatically capture data from emails, form submissions, RSS feeds, or any other n8n-supported trigger.

### 6.3 API Key Management

API keys allow third-party tools to authenticate with MindAtlas on your behalf.

**To manage API keys:**
1. Go to **Settings > API Keys**.
2. Click **Generate New Key** and give it a label (e.g., "n8n Production").
3. Copy the key immediately — it will not be shown again.
4. To revoke a key, click the **Revoke** button next to it.

**API endpoints:**
- `GET /api/keys` — List your active API keys
- `POST /api/keys` — Generate a new key
- `DELETE /api/keys/:id` — Revoke a key

API keys grant the same access level as your session token. Keep them secure and revoke any keys you no longer use.

---

## 7. Data Export

### 7.1 Export Items as CSV

Export all your items to a CSV file for backup or external use.

1. Navigate to **Export > Items CSV**.
2. Click **Download**.
3. The generated file includes columns: `content`, `content_type`, `tags`, `creation_date`, `metadata`.

**API endpoint:** `GET /api/csv/export/items`

**Response:** Returns a CSV file download with a header row followed by one row per item.

### 7.2 Export Maps as CSV

Export your relationship map data as CSV.

1. Navigate to **Export > Maps CSV**.
2. Click **Download**.
3. The generated file includes columns: `source_item_id`, `target_item_id`, `relationship_type`, `confidence_score`.

**API endpoint:** `GET /api/csv/export/maps`

### 7.3 CSV Template

Download a pre-formatted CSV template to use for bulk imports.

1. Navigate to **Import > Download Template**.
2. The template includes:
   - A header row with all supported columns: `content`, `content_type`, `tags`, `metadata`
   - Two example rows demonstrating valid data formats
   - Inline comments explaining expected format for each column

**API endpoint:** `GET /api/csv/template`

**Template contents:**
```csv
content,content_type,tags,metadata
"Example: A note about your project idea",note,"project,idea","{""priority"": ""medium""}"
"Example: https://useful-resource.com",link,"resources,bookmarks",""
```

---

## 8. Billing and Subscription

### 8.1 Plans Overview

MindAtlas offers three subscription tiers:

| Feature | Free | Pro | Enterprise |
|---------|------|-----|-----------|
| Cards | Unlimited | Unlimited | Unlimited |
| File Storage | 500 MB | 5 GB | 50 GB |
| AI Queries/Day | 10 | 100 | Unlimited |
| AI Categorization | Basic | Full | Full Suite |
| Relationship Mapping | — | ✓ | ✓ |
| Natural Language Queries | — | ✓ | ✓ |
| Cluster Summaries | — | — | ✓ |
| Input Channels | Web Upload | All (API, SMS, Web, CSV) | All |
| Notion Integration | — | ✓ | ✓ |
| All Integrations | — | — | ✓ |
| Priority AI Processing | — | — | ✓ |
| Custom Categories | — | — | ✓ |

All plans include unlimited card creation — your items are never count-limited.

### 8.2 Upgrading or Downgrading

**To upgrade:**
1. Go to **Settings > Billing**.
2. Click **Change Plan** and select a higher tier.
3. Complete payment through Stripe.
4. New plan features activate immediately upon successful payment.

**To downgrade:**
1. Go to **Settings > Billing**.
2. Click **Change Plan** and select a lower tier.
3. You retain access to your current plan until the end of your billing period.
4. At the next billing cycle, the lower plan takes effect.

**To cancel:**
1. Go to **Settings > Billing**.
2. Click **Cancel Subscription**.
3. Access continues until the end of the current billing period.

### 8.3 Usage and Limits

View your current usage on the Billing page:

- **Storage used** vs. your plan limit (e.g., 1.2 GB / 5 GB)
- **AI queries today** vs. daily limit (e.g., 42 / 100)

When you exceed a limit:
- You are notified and prompted to upgrade.
- Existing data is never deleted or restricted.
- You cannot use the exceeded feature until the limit resets (AI queries reset daily) or you upgrade.

Attempting to use a feature not included in your plan returns a `402 Payment Required` response via the API.

### 8.4 Managing Payment Methods

1. Go to **Settings > Billing > Payment Method**.
2. Update your credit card details through the secure Stripe form.
3. View your payment history including past invoices and charges.

If a payment fails, MindAtlas retries the charge up to 3 times over 7 days and notifies you of the issue.

---

## 9. Troubleshooting

### 9.1 Authentication Errors

| Error | Cause | Resolution |
|-------|-------|-----------|
| "Invalid credentials" | Wrong email or password | Double-check your email and password. Passwords are case-sensitive. |
| "Account locked" | 5 consecutive failed login attempts | Wait 15 minutes for the automatic unlock, then try again with the correct password. |
| "Session expired" | JWT token expired | Log in again. Sessions expire after periods of inactivity. |
| "401 Unauthorized" | Missing or invalid auth token | Ensure your API request includes a valid `Authorization` header or `X-API-Key`. |

### 9.2 Upload Errors

| Error | Cause | Resolution |
|-------|-------|-----------|
| "File too large" | File exceeds 25 MB | Reduce the file size or split into smaller files. |
| "Unsupported file type" | File extension not in allowed list | Convert to a supported format (PDF, PNG, JPG, GIF, TXT, MD, CSV, JSON, or code files). |
| "Upload failed" | Network or server issue | Check your connection and retry. If the problem persists, try a smaller file. |

### 9.3 CSV Import Errors

| Error | Cause | Resolution |
|-------|-------|-----------|
| "Missing 'content' column" | CSV header lacks required column | Ensure your CSV has a `content` column in the header row. Download the template for reference. |
| "File exceeds 10 MB" | CSV file too large | Split your data into multiple files under 10 MB each. |
| "Exceeds 5000 row limit" | Too many rows | Split into multiple files with 5,000 rows or fewer each. |
| "Malformed CSV at line X" | Parsing error | Check line X for unescaped commas, mismatched quotes, or encoding issues. |
| "Rows skipped: [3, 7, 15]" | Rows missing content value | Add content to the listed rows or remove them. |

### 9.4 API Errors

| Status Code | Meaning | Resolution |
|-------------|---------|-----------|
| 400 Bad Request | Invalid or missing required fields | Check the request body matches the expected schema. Review the error message for specifics. |
| 401 Unauthorized | Not authenticated | Include a valid bearer token or API key. |
| 402 Payment Required | Feature not in your plan | Upgrade your subscription to access this feature. |
| 403 Forbidden | Accessing another user's resource | You can only access your own items and maps. |
| 429 Too Many Requests | Rate limit exceeded (100 req/min) | Wait and retry. Spread requests over time or implement backoff. |
| 500 Internal Server Error | Server-side issue | Retry after a moment. If persistent, contact support. |

### 9.5 Billing Errors

| Error | Cause | Resolution |
|-------|-------|-----------|
| "Payment failed" | Card declined or expired | Update your payment method in Settings > Billing. |
| "Subscription expired" | Payment not received after retries | Update payment info. The system retries up to 3 times over 7 days. |
| "Plan limit reached" | Storage or AI queries exhausted | Upgrade to a higher plan or wait for daily limit reset (AI queries). |

---

*This manual is kept in sync with the application. When features are added or modified, this document is updated in the same pull request.*
