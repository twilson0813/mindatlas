# Requirements Document

## Introduction

This document defines the requirements for an AI-powered mapping and organization web application (MindAtlas). The application allows users to send items (notes, links, tasks, ideas) via multiple input channels (API, SMS, web upload), which are then automatically categorized, mapped, and organized using AI tools. The system features a personal dashboard-style web interface, includes authentication and security, runs as a Docker container, and is deployed via GitHub Actions CI/CD pipelines.

## Glossary

- **Web_App**: The AI mapping web application that serves as the primary user interface and backend system
- **Dashboard**: The authenticated web interface presenting a personal overview of Items, Maps, and activity
- **User**: An authenticated individual who interacts with the Web_App
- **Item**: A piece of content (plain text, link, code snippet, note, task, idea, file, or any other content type) submitted to the Web_App for processing
- **AI_Mapper**: The AI subsystem responsible for categorizing, tagging, and mapping Items into logical groupings
- **Map**: A visual or structured representation of the relationships between Items
- **Auth_System**: The authentication and authorization subsystem that manages user identity and access control
- **API_Gateway**: The REST/HTTP interface that accepts Items programmatically
- **SMS_Gateway**: The subsystem that receives Items sent via SMS messages
- **Upload_Interface**: The web-based interface for manually uploading or entering Items
- **Container**: The Docker container that packages and runs the Web_App
- **CI_CD_Pipeline**: The GitHub Actions workflow that builds, tests, and deploys the Container
- **CSV_Importer**: The subsystem responsible for parsing uploaded CSV files and creating Items in bulk
- **CSV_Exporter**: The subsystem responsible for generating CSV files from a User's Items, Maps, and relationships
- **Data_Dictionary**: A living reference document that defines all data entities, fields, data types, constraints, relationships, and valid values used across the Web_App
- **User_Manual**: A maintained end-user documentation set that explains how to use all features of the Web_App, kept in sync with the application as it evolves
- **API_Docs_Interface**: An interactive API documentation interface (e.g., Swagger/OpenAPI) that allows developers to explore, test, and integrate with the Web_App's endpoints
- **Admin_Console**: A restricted administrative interface for managing users, subscriptions, system metrics, and platform configuration — with no access to user Card content
- **Card**: A user-owned content entry (text, URL, code snippet, note, task, idea, file, or any content type) stored in the system; also referred to as an Item
- **Subscription_System**: The subsystem responsible for managing subscription plans, billing, and feature access based on plan tier

## Requirements

### Requirement 1: User Authentication

**User Story:** As a user, I want to securely authenticate with the Web_App, so that my Items and Maps are protected from unauthorized access.

#### Acceptance Criteria

1. WHEN a User submits valid credentials, THE Auth_System SHALL authenticate the User and issue a session token
2. WHEN a User submits invalid credentials, THE Auth_System SHALL reject the authentication attempt and return an error message
3. THE Auth_System SHALL enforce password complexity rules requiring a minimum of 8 characters, one uppercase letter, one lowercase letter, one digit, and one special character
4. WHEN a session token expires, THE Auth_System SHALL require the User to re-authenticate
5. IF five consecutive failed authentication attempts occur for a single account, THEN THE Auth_System SHALL lock the account for 15 minutes

### Requirement 2: Authorization and Access Control

**User Story:** As a user, I want my Items and Maps to be private to my account, so that other users cannot view or modify my data.

#### Acceptance Criteria

1. THE Auth_System SHALL restrict access to Items and Maps to the authenticated User who owns them
2. WHEN an unauthenticated request is received, THE API_Gateway SHALL reject the request with a 401 Unauthorized response
3. WHEN an authenticated User attempts to access another User's Items, THE Web_App SHALL reject the request with a 403 Forbidden response

### Requirement 3: API Input Channel

**User Story:** As a developer, I want to send Items to the Web_App via a REST API, so that I can integrate the mapping system with other tools and automations.

#### Acceptance Criteria

1. WHEN a valid authenticated API request containing an Item is received, THE API_Gateway SHALL accept the Item and return a confirmation with the Item identifier
2. THE API_Gateway SHALL accept Items in JSON format with fields for content, content type (plain text, link, code snippet, note, task, idea, file, or custom), and optional metadata
3. WHEN an API request with invalid or missing required fields is received, THE API_Gateway SHALL return a 400 Bad Request response with a description of the validation error
4. THE API_Gateway SHALL enforce rate limiting of 100 requests per minute per User

### Requirement 4: SMS Input Channel

**User Story:** As a user, I want to send Items to the Web_App via SMS, so that I can quickly capture ideas on the go without opening the application.

#### Acceptance Criteria

1. WHEN an SMS message is received from a registered phone number, THE SMS_Gateway SHALL create a new Item with the message body as content
2. WHEN an SMS message is received from an unregistered phone number, THE SMS_Gateway SHALL discard the message and take no further action
3. WHEN an Item is successfully created from an SMS, THE SMS_Gateway SHALL send a confirmation reply to the sender
4. IF the SMS_Gateway fails to process a message, THEN THE SMS_Gateway SHALL log the failure and retry processing up to 3 times

### Requirement 5: Web Upload Input Channel

**User Story:** As a user, I want to upload Items directly through the web interface, so that I can add content using a rich editing experience.

#### Acceptance Criteria

1. THE Upload_Interface SHALL provide a form for entering text content, uploading files, and adding metadata tags
2. WHEN a User submits an Item through the Upload_Interface, THE Web_App SHALL validate the submission and store the Item
3. THE Upload_Interface SHALL support file uploads up to 25 MB in size
4. WHEN a file exceeding 25 MB is submitted, THE Upload_Interface SHALL reject the upload and display an error message to the User
5. THE Upload_Interface SHALL support the following file types: PDF, PNG, JPG, GIF, TXT, MD, CSV, JSON, and common code file extensions (e.g., .py, .js, .ts, .html, .css)
6. THE Upload_Interface SHALL allow Users to submit plain text content directly without requiring a file upload

### Requirement 6: AI Categorization and Mapping

**User Story:** As a user, I want AI to automatically categorize and map my Items, so that I can discover relationships and organize my content without manual effort.

#### Acceptance Criteria

1. WHEN a new Item is created, THE AI_Mapper SHALL analyze the Item content and assign relevant category tags
2. WHEN a new Item is created, THE AI_Mapper SHALL identify relationships between the new Item and existing Items owned by the same User
3. THE AI_Mapper SHALL generate a Map representing the relationships between a User's Items
4. WHEN a User requests a Map update, THE AI_Mapper SHALL regenerate the Map incorporating all current Items and relationships
5. THE AI_Mapper SHALL provide a confidence score between 0 and 1 for each assigned category tag

### Requirement 7: AI Integration Tools

**User Story:** As a user, I want to interact with AI tools within the application, so that I can ask questions about my mapped content and get intelligent summaries.

#### Acceptance Criteria

1. WHEN a User submits a natural language query about their Items, THE AI_Mapper SHALL return relevant Items and a generated summary
2. THE AI_Mapper SHALL support generating summaries of Item clusters within a Map
3. WHEN a User requests suggestions for a specific Item, THE AI_Mapper SHALL return related Items and recommended actions
4. IF the AI_Mapper fails to process a request, THEN THE AI_Mapper SHALL return an error message indicating the failure reason and suggest the User retry

### Requirement 8: Web Dashboard Interface

**User Story:** As a user, I want a personal dashboard-style web interface, so that I can view, search, and interact with my Items and Maps in an organized layout.

#### Acceptance Criteria

1. WHEN a User logs in, THE Dashboard SHALL display a personalized overview showing recent Items, active Maps, and summary statistics
2. THE Dashboard SHALL display Items as a card-based grid layout where each card shows a thumbnail preview (if available), title, content snippet, source domain, timestamp, and assigned category/tag badges
3. THE Dashboard SHALL arrange Item cards in a responsive masonry-style grid that adapts column count based on viewport width
4. THE Dashboard SHALL display category and tag badges on each Item card using a visually distinct style (e.g., colored labels with hashtag notation)
5. THE Dashboard SHALL provide a search interface that allows Users to filter Items by category, tag, date, or content keywords
6. THE Dashboard SHALL display Maps as interactive visual graphs showing Item relationships
7. WHEN a User selects an Item card in the Dashboard, THE Dashboard SHALL display the full Item details, assigned categories, and related Items
8. THE Dashboard SHALL be responsive and render correctly on screen widths from 320px to 2560px
9. THE Dashboard SHALL load the initial view within 3 seconds on a standard broadband connection

### Requirement 9: Third-Party Integrations

**User Story:** As a user, I want to connect the Web_App with n8n workflows and Notion, so that I can automate item capture and sync my mapped content with external tools.

#### Acceptance Criteria

1. THE API_Gateway SHALL provide webhook endpoints that accept incoming payloads from n8n workflow automations
2. WHEN a webhook payload is received from an authenticated n8n workflow, THE API_Gateway SHALL create an Item from the payload content
3. THE Web_App SHALL provide an OAuth-based integration with Notion that allows syncing Items to and from Notion pages and databases
4. WHEN a User connects a Notion workspace, THE Web_App SHALL import selected Notion pages as Items
5. THE Web_App SHALL support exporting Items and Maps to a connected Notion workspace
6. THE API_Gateway SHALL provide API key management allowing Users to generate and revoke API keys for third-party integrations
7. WHEN an API key is used for authentication, THE API_Gateway SHALL grant the same access as the owning User's session token

### Requirement 10: Docker Containerization

**User Story:** As a DevOps engineer, I want the Web_App packaged as a Docker container, so that deployment is consistent and reproducible across environments.

#### Acceptance Criteria

1. THE Container SHALL include all runtime dependencies required to run the Web_App
2. THE Container SHALL expose a single HTTP port for serving the Web_App
3. THE Container SHALL accept configuration through environment variables for database connection, API keys, and SMS gateway credentials
4. WHEN the Container starts, THE Web_App SHALL perform a health check and report readiness within 30 seconds
5. THE Container SHALL produce structured JSON log output to standard output

### Requirement 11: GitHub Actions CI/CD Pipeline

**User Story:** As a DevOps engineer, I want automated build and deployment via GitHub Actions, so that code changes are tested and deployed reliably.

#### Acceptance Criteria

1. WHEN code is pushed to the main branch, THE CI_CD_Pipeline SHALL build the Container image and run all automated tests
2. WHEN all tests pass on the main branch, THE CI_CD_Pipeline SHALL push the Container image to a container registry
3. WHEN a new Container image is pushed to the registry, THE CI_CD_Pipeline SHALL deploy the Container to the target environment
4. IF the build or tests fail, THEN THE CI_CD_Pipeline SHALL notify the developer via GitHub commit status and halt deployment
5. THE CI_CD_Pipeline SHALL complete the build-test-deploy cycle within 10 minutes for a standard change

### Requirement 12: Data Security

**User Story:** As a user, I want my data encrypted and securely stored, so that my personal content is protected from breaches.

#### Acceptance Criteria

1. THE Web_App SHALL encrypt all data in transit using TLS 1.2 or higher
2. THE Web_App SHALL encrypt all stored Items and User data at rest using AES-256 encryption
3. THE Auth_System SHALL store password hashes using bcrypt with a minimum cost factor of 12
4. WHEN a User deletes an Item, THE Web_App SHALL permanently remove the Item data within 24 hours
5. THE Web_App SHALL sanitize all user input to prevent cross-site scripting and SQL injection attacks

### Requirement 13: CSV Import and Export

**User Story:** As a user, I want to import Items in bulk via CSV file upload and export my Items and Maps to CSV format, so that I can migrate data into the system efficiently and create backups or use my data in external tools.

#### Acceptance Criteria

1. WHEN a User uploads a valid CSV file through the Upload_Interface, THE CSV_Importer SHALL parse the file and create one Item per row
2. THE CSV_Importer SHALL require the CSV file to contain a header row with at minimum a "content" column and an optional "content_type" column, "tags" column, and "metadata" column
3. WHEN a CSV file contains rows with missing required "content" values, THE CSV_Importer SHALL skip those rows and report the skipped row numbers to the User
4. WHEN a CSV file fails to parse due to malformed formatting, THE CSV_Importer SHALL reject the file and return a descriptive error indicating the line number and nature of the issue
5. THE CSV_Importer SHALL enforce a maximum file size of 10 MB and a maximum of 5000 rows per import
6. WHEN a CSV import exceeds 5000 rows or 10 MB, THE CSV_Importer SHALL reject the file and inform the User of the limit
7. WHEN a User requests an Items export, THE CSV_Exporter SHALL generate a CSV file containing all of the User's Items with columns for content, content_type, tags, creation_date, and metadata
8. WHEN a User requests a Maps export, THE CSV_Exporter SHALL generate a CSV file containing relationship data with columns for source_item_id, target_item_id, relationship_type, and confidence_score
9. THE CSV_Exporter SHALL include a header row in all generated CSV files
10. WHEN a CSV import completes successfully, THE CSV_Importer SHALL return a summary indicating the number of Items created and the number of rows skipped
11. FOR ALL valid CSV files, importing then exporting then importing SHALL produce an equivalent set of Items (round-trip property)
12. THE Upload_Interface SHALL provide a downloadable CSV template file that includes the header row with all supported columns (content, content_type, tags, metadata) and two example rows demonstrating valid data formats
13. WHEN a User requests the CSV template, THE Web_App SHALL return the template file with appropriate column headers and inline comments or example data explaining the expected format for each column

### Requirement 14: Data Dictionary

**User Story:** As a developer, I want a maintained data dictionary that documents all entities, fields, types, and constraints, so that the team has a single source of truth for the data model and can onboard new contributors efficiently.

#### Acceptance Criteria

1. THE Web_App project SHALL include a data dictionary document that defines every database entity, its fields, data types, constraints, and relationships
2. THE Data_Dictionary SHALL specify for each field: name, data type, nullable status, default value, constraints (e.g., max length, enum values, foreign key references), and a human-readable description
3. THE Data_Dictionary SHALL document all enum values and their meanings (e.g., content_type values: plain_text, link, code_snippet, note, task, idea, file, custom)
4. THE Data_Dictionary SHALL document all entity relationships including cardinality (one-to-one, one-to-many, many-to-many) and cascade behavior on delete
5. WHEN a database migration is created that adds, modifies, or removes a field or entity, THE Data_Dictionary SHALL be updated in the same pull request to reflect the change
6. THE Data_Dictionary SHALL be stored in the repository as a markdown file accessible to all team members
7. THE CI_CD_Pipeline SHALL include a validation step that warns when migration files are modified without a corresponding update to the Data_Dictionary

### Requirement 15: User Manual

**User Story:** As a user, I want a comprehensive and up-to-date user manual, so that I can learn how to use all features of MindAtlas without needing external support.

#### Acceptance Criteria

1. THE Web_App project SHALL include a user manual document that covers all user-facing features: authentication, item creation (API, SMS, web upload, CSV import), dashboard navigation, search and filtering, map visualization, AI tools, integrations, and data export
2. THE User_Manual SHALL include a getting started guide that walks a new User through registration, first item creation, and dashboard orientation
3. THE User_Manual SHALL document each input channel with step-by-step instructions and example payloads or screenshots where applicable
4. THE User_Manual SHALL include an API reference section documenting all public endpoints with request/response examples, authentication requirements, and error codes
5. THE User_Manual SHALL include a troubleshooting section covering common errors, their causes, and resolution steps
6. WHEN a new user-facing feature is added or an existing feature is modified, THE User_Manual SHALL be updated in the same pull request to reflect the change
7. THE User_Manual SHALL be stored in the repository as markdown files and accessible via a /docs route in the Web_App
8. THE User_Manual SHALL include a table of contents with links to each section for quick navigation
9. THE CI_CD_Pipeline SHALL include a validation step that warns when user-facing route handlers or UI components are modified without a corresponding update to the User_Manual

### Requirement 16: API Documentation Interface

**User Story:** As a developer, I want an interactive API documentation interface, so that I can explore available endpoints, understand request/response schemas, and test API calls directly from the browser.

#### Acceptance Criteria

1. THE Web_App SHALL serve an interactive API documentation interface at a `/api-docs` route using the OpenAPI 3.0 specification
2. THE API_Docs_Interface SHALL document every public API endpoint including method, path, description, request parameters, request body schema, response schema, and example values
3. THE API_Docs_Interface SHALL group endpoints by domain (auth, items, maps, AI, integrations, webhooks, CSV, keys) with clear section headings
4. THE API_Docs_Interface SHALL provide a "Try it out" feature that allows authenticated developers to execute API calls directly from the documentation page
5. THE API_Docs_Interface SHALL display all possible error response codes and their meanings for each endpoint
6. THE API_Docs_Interface SHALL document authentication requirements (JWT bearer token or API key) and include instructions for obtaining credentials
7. WHEN a new API endpoint is added or an existing endpoint is modified, THE OpenAPI specification SHALL be updated in the same pull request to reflect the change
8. THE OpenAPI specification SHALL be stored in the repository as a YAML file and auto-generated where possible from route definitions and validation schemas
9. THE CI_CD_Pipeline SHALL include a validation step that verifies the OpenAPI specification is syntactically valid and warns when route handlers are modified without a corresponding spec update

### Requirement 17: Admin Console

**User Story:** As an administrator, I want a dedicated admin console, so that I can manage users, monitor system health, configure subscription plans, and moderate the platform without accessing user Card content.

#### Acceptance Criteria

1. THE Admin_Console SHALL be accessible only to Users with an administrator role, protected by role-based access control
2. THE Admin_Console SHALL provide a user management interface that allows administrators to view user accounts (email, registration date, subscription tier, account status), disable accounts, delete accounts, and unlock locked accounts
3. THE Admin_Console SHALL NOT display, access, or expose any Card content (text, URLs, code snippets, files, or any stored Item data) belonging to Users
4. WHEN an administrator attempts to access a user's Card content through any interface, THE Web_App SHALL deny the request and log the attempt
5. THE Admin_Console SHALL display system metrics and analytics including: total registered users, active users (daily/weekly/monthly), total Cards stored, API request volume, AI processing queue depth, and error rates
6. THE Admin_Console SHALL provide a subscription plan management interface that allows administrators to create, modify, and deactivate subscription plans
7. THE Admin_Console SHALL provide a feature entitlement configuration interface within each subscription plan where administrators can toggle which features are included in that plan (e.g., input channels, AI capabilities, integrations, export formats)
8. WHEN a new feature is added to the Web_App, THE Admin_Console SHALL automatically register it in the feature entitlement list so administrators can assign it to subscription plans without requiring a code deployment
9. THE Admin_Console SHALL provide a moderation interface that allows administrators to flag or disable user accounts based on policy violations, without viewing Card content
10. THE Admin_Console SHALL display system logs and audit trail for administrative actions (account changes, plan modifications, moderation actions)
11. THE Admin_Console SHALL be served at a `/admin` route, separate from the main Dashboard interface
12. THE Admin_Console SHALL require multi-factor authentication or elevated session verification before granting access

### Requirement 18: Subscription Plans and Billing

**User Story:** As a user, I want to choose a subscription plan that fits my needs, so that I can access premium features like higher storage limits, more AI queries, and additional integrations.

#### Acceptance Criteria

1. THE Subscription_System SHALL support tiered subscription plans: Free, Pro, and Enterprise
2. THE Free plan SHALL include: unlimited Cards, 500 MB file storage, 10 AI queries per day, basic AI categorization only, web upload input channel only
3. THE Pro plan SHALL include: unlimited Cards, 5 GB file storage, 100 AI queries per day, full AI categorization and relationship mapping, all input channels (API, SMS, web upload, CSV), Notion integration, and natural language AI queries
4. THE Enterprise plan SHALL include: unlimited Cards, 50 GB file storage, unlimited AI queries, full AI suite (categorization, relationship mapping, natural language queries, cluster summaries, suggestions), all input channels, all integrations, priority AI processing, and custom categories
5. WHEN a User exceeds a plan limit (AI queries or storage), THE Web_App SHALL notify the User and prompt an upgrade, but SHALL NOT delete existing data or restrict access to existing Cards
6. THE Subscription_System SHALL integrate with Stripe for payment processing, supporting credit card and billing management
7. WHEN a User subscribes to or upgrades a plan, THE Subscription_System SHALL activate the new plan features immediately upon successful payment confirmation
8. WHEN a User downgrades or cancels a plan, THE Subscription_System SHALL maintain access to the current plan until the end of the billing period
9. THE Subscription_System SHALL provide a billing management page where Users can view their current plan, payment history, update payment method, and cancel their subscription
10. THE Admin_Console SHALL display subscription metrics including: subscribers per plan tier, monthly recurring revenue, churn rate, and upgrade/downgrade counts
11. WHEN a payment fails, THE Subscription_System SHALL retry the charge up to 3 times over 7 days and notify the User of the payment issue
12. THE Subscription_System SHALL enforce plan limits at the API layer, returning a 402 Payment Required response when a User attempts to use a feature not included in their plan
13. ALL subscription tiers SHALL provide unlimited Card creation — Cards SHALL never be count-limited regardless of plan
14. THE Subscription_System SHALL read feature entitlements from the admin-configured plan definitions at runtime, so that changes to plan features take effect immediately without code deployment
15. THE Subscription_System SHALL maintain a feature registry that maps each application feature to a unique feature key, enabling granular entitlement control per plan
