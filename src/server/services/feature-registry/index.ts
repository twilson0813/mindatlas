import { queryOne, queryMany } from '../../db/db.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger({ module: 'feature-registry' });

// ─── Types ───────────────────────────────────────────────────────────────────

/** Valid feature categories */
export type FeatureCategory =
  | 'input_channels'
  | 'ai_capabilities'
  | 'integrations'
  | 'export_formats'
  | 'advanced';

/** Definition provided when registering a feature */
export interface FeatureDefinition {
  key: string;
  name: string;
  description: string;
  category: FeatureCategory;
}

/** Entry stored in the registry (includes registration metadata) */
export interface FeatureRegistryEntry extends FeatureDefinition {
  id?: string;
  registeredAt: string;
}

// ─── In-Memory Registry ──────────────────────────────────────────────────────

/**
 * In-memory registry of all features. Populated at module initialization
 * via `register()` calls or the `@RegisterFeature` decorator.
 * The in-memory registry is the source of truth at runtime; database
 * persistence provides durability across restarts.
 */
const registry: Map<string, FeatureRegistryEntry> = new Map();

// ─── Core Methods ────────────────────────────────────────────────────────────

/**
 * Registers a feature with a unique key. Called at module initialization.
 * If a feature with the same key is already registered, it is skipped (idempotent).
 *
 * Requirements: 17.8, 18.15
 */
export function register(feature: FeatureDefinition): void {
  if (!feature.key || typeof feature.key !== 'string') {
    throw new Error('Feature key is required and must be a non-empty string');
  }

  if (!feature.name || typeof feature.name !== 'string') {
    throw new Error('Feature name is required and must be a non-empty string');
  }

  if (!feature.description || typeof feature.description !== 'string') {
    throw new Error('Feature description is required and must be a non-empty string');
  }

  const validCategories: FeatureCategory[] = [
    'input_channels',
    'ai_capabilities',
    'integrations',
    'export_formats',
    'advanced',
  ];

  if (!validCategories.includes(feature.category)) {
    throw new Error(
      `Invalid category '${feature.category}'. Must be one of: ${validCategories.join(', ')}`,
    );
  }

  if (registry.has(feature.key)) {
    log.debug({ key: feature.key }, 'Feature already registered, skipping');
    return;
  }

  const entry: FeatureRegistryEntry = {
    ...feature,
    registeredAt: new Date().toISOString(),
  };

  registry.set(feature.key, entry);
  log.info({ key: feature.key, category: feature.category }, 'Feature registered');
}

/**
 * Returns all registered features.
 * Used by the admin UI to display the feature entitlement list.
 */
export function getAll(): FeatureRegistryEntry[] {
  return Array.from(registry.values());
}

/**
 * Looks up a feature by its unique key.
 * Returns null if not found.
 */
export function getByKey(key: string): FeatureRegistryEntry | null {
  return registry.get(key) ?? null;
}

/**
 * Returns all features in a given category.
 */
export function getByCategory(category: FeatureCategory): FeatureRegistryEntry[] {
  return Array.from(registry.values()).filter((entry) => entry.category === category);
}

/**
 * Checks if a feature key is registered.
 */
export function isRegistered(key: string): boolean {
  return registry.has(key);
}

/**
 * Returns the count of registered features.
 */
export function getCount(): number {
  return registry.size;
}

/**
 * Clears the in-memory registry. Used for testing.
 */
export function clearRegistry(): void {
  registry.clear();
}

// ─── Decorator Pattern ───────────────────────────────────────────────────────

/**
 * Decorator factory for auto-registering features on class declaration.
 * Usage:
 * ```
 * @RegisterFeature({
 *   key: 'input.sms',
 *   name: 'SMS Input Channel',
 *   description: 'Receive items via SMS messages',
 *   category: 'input_channels'
 * })
 * class SmsGateway { ... }
 * ```
 */
export function RegisterFeature(definition: FeatureDefinition) {
  return function <T extends new (...args: unknown[]) => unknown>(target: T): T {
    register(definition);
    return target;
  };
}

// ─── Database Persistence ────────────────────────────────────────────────────

interface FeatureRegistryRow {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  created_at: Date;
}

/**
 * Syncs the in-memory registry to the database.
 * Inserts any features not yet persisted (upsert by key).
 */
export async function syncToDatabase(): Promise<void> {
  const features = getAll();

  for (const feature of features) {
    await queryOne<FeatureRegistryRow>(
      `INSERT INTO feature_registry (key, name, description, category)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         category = EXCLUDED.category
       RETURNING id, key, name, description, category, created_at`,
      [feature.key, feature.name, feature.description, feature.category],
    );
  }

  log.info({ count: features.length }, 'Feature registry synced to database');
}

/**
 * Loads features from the database into the in-memory registry.
 * Used on application startup to restore persisted features.
 */
export async function loadFromDatabase(): Promise<void> {
  const rows = await queryMany<FeatureRegistryRow>(
    `SELECT id, key, name, description, category, created_at FROM feature_registry ORDER BY key`,
  );

  for (const row of rows) {
    if (!registry.has(row.key)) {
      registry.set(row.key, {
        id: row.id,
        key: row.key,
        name: row.name,
        description: row.description,
        category: row.category as FeatureCategory,
        registeredAt: row.created_at.toISOString(),
      });
    }
  }

  log.info({ count: rows.length }, 'Feature registry loaded from database');
}

// ─── Default Feature Registration ───────────────────────────────────────────

/**
 * Registers all built-in application features.
 * Called at module initialization to ensure all features are available
 * immediately when the application starts.
 *
 * Requirements: 17.8 — new features automatically appear in entitlement list
 * Requirements: 18.15 — feature registry maps each feature to a unique key
 */
export function registerDefaultFeatures(): void {
  // Input Channels
  register({
    key: 'input.sms',
    name: 'SMS Input Channel',
    description: 'Receive items via SMS messages from registered phone numbers',
    category: 'input_channels',
  });

  register({
    key: 'input.api',
    name: 'REST API Input',
    description: 'Create items programmatically via the REST API',
    category: 'input_channels',
  });

  register({
    key: 'input.csv',
    name: 'CSV Import',
    description: 'Bulk import items from CSV files',
    category: 'input_channels',
  });

  // AI Capabilities
  register({
    key: 'ai.categorization',
    name: 'AI Categorization',
    description: 'Automatic AI-powered categorization and tagging of items',
    category: 'ai_capabilities',
  });

  register({
    key: 'ai.relationship_mapping',
    name: 'AI Relationship Mapping',
    description: 'AI-powered identification of relationships between items',
    category: 'ai_capabilities',
  });

  register({
    key: 'ai.natural_language',
    name: 'Natural Language Queries',
    description: 'Ask questions about your items using natural language',
    category: 'ai_capabilities',
  });

  register({
    key: 'ai.cluster_summaries',
    name: 'Cluster Summaries',
    description: 'AI-generated summaries of item clusters within maps',
    category: 'ai_capabilities',
  });

  register({
    key: 'ai.suggestions',
    name: 'AI Suggestions',
    description: 'AI-powered suggestions for related items and recommended actions',
    category: 'ai_capabilities',
  });

  register({
    key: 'ai.priority_processing',
    name: 'Priority AI Processing',
    description: 'Priority queue for AI processing jobs',
    category: 'ai_capabilities',
  });

  // Integrations
  register({
    key: 'integration.notion',
    name: 'Notion Integration',
    description: 'Sync items to and from Notion pages and databases',
    category: 'integrations',
  });

  register({
    key: 'integration.n8n',
    name: 'n8n Workflow Integration',
    description: 'Accept items from n8n workflow automations via webhooks',
    category: 'integrations',
  });

  // Export Formats
  register({
    key: 'export.csv',
    name: 'CSV Export',
    description: 'Export items and maps to CSV format',
    category: 'export_formats',
  });

  // Advanced Features
  register({
    key: 'advanced.custom_categories',
    name: 'Custom Categories',
    description: 'Create and manage custom category taxonomies',
    category: 'advanced',
  });
}

// Auto-register default features on module load
registerDefaultFeatures();
