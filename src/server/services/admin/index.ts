import { query, queryOne, queryMany, withTransaction } from '../../db/db.js';
import { createChildLogger } from '../../logger.js';
import { invalidateCache } from '../../middleware/entitlement.js';
import * as featureRegistry from '../feature-registry/index.js';

const log = createChildLogger({ module: 'admin' });

// ─── Content-Isolated Fields ─────────────────────────────────────────────────
// These fields MUST NEVER appear in admin queries or responses.
const FORBIDDEN_CONTENT_FIELDS = [
  'content_encrypted',
  'file_path',
  'content',
  'file_data',
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlanInput {
  name: string;
  displayName: string;
  stripePriceId?: string | null;
  priceMonthyCents: number;
  storageLimitMb: number;
  aiQueriesPerDay: number;
}

export interface PlanUpdate {
  displayName?: string;
  stripePriceId?: string | null;
  priceMonthyCents?: number;
  storageLimitMb?: number;
  aiQueriesPerDay?: number;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  displayName: string;
  stripePriceId: string | null;
  priceMonthyCents: number;
  storageLimitMb: number;
  aiQueriesPerDay: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeatureToggle {
  featureKey: string;
  enabled: boolean;
}

export interface SubscriptionMetrics {
  freeCount: number;
  proCount: number;
  enterpriseCount: number;
  mrr: number;
  churnRate: number;
  upgradeCount30d: number;
  downgradeCount30d: number;
}

// ─── DB Row Types ────────────────────────────────────────────────────────────

interface PlanRow {
  id: string;
  name: string;
  display_name: string;
  stripe_price_id: string | null;
  price_monthly_cents: number;
  storage_limit_mb: number;
  ai_queries_per_day: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapPlanRow(row: PlanRow): SubscriptionPlan {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    stripePriceId: row.stripe_price_id,
    priceMonthyCents: row.price_monthly_cents,
    storageLimitMb: row.storage_limit_mb,
    aiQueriesPerDay: row.ai_queries_per_day,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Records an admin action in the audit log.
 */
async function logAuditEntry(
  adminId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  details?: Record<string, unknown>
): Promise<void> {
  await queryOne(
    `INSERT INTO audit_log (admin_user_id, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [adminId, action, targetType, targetId, JSON.stringify(details ?? {})]
  );
}

// ─── User Detail ─────────────────────────────────────────────────────────────

/**
 * Returns a single user's summary data (no card content).
 * Uses admin_user_summary view which excludes content_encrypted.
 *
 * Requirements: 17.2
 */
export async function getUserById(userId: string): Promise<AdminUserSummary | null> {
  const listSql = `
    SELECT user_id, email, role, is_locked, locked_until, registration_date,
           updated_at, subscription_id, plan_name, plan_display_name,
           subscription_status, current_period_end, card_count, total_storage_used_bytes
    FROM admin_user_summary
    WHERE user_id = $1
  `;
  AdminDataAccess.validateQuerySafety(listSql);

  const row = await queryOne<{
    user_id: string;
    email: string;
    role: string;
    is_locked: boolean;
    locked_until: Date | null;
    registration_date: Date;
    updated_at: Date;
    subscription_id: string | null;
    plan_name: string | null;
    plan_display_name: string | null;
    subscription_status: string | null;
    current_period_end: Date | null;
    card_count: number;
    total_storage_used_bytes: number;
  }>(listSql, [userId]);

  if (!row) return null;

  return {
    userId: row.user_id,
    email: row.email,
    role: row.role,
    isLocked: row.is_locked,
    lockedUntil: row.locked_until,
    registrationDate: row.registration_date,
    updatedAt: row.updated_at,
    subscriptionId: row.subscription_id,
    planName: row.plan_name,
    planDisplayName: row.plan_display_name,
    subscriptionStatus: row.subscription_status,
    currentPeriodEnd: row.current_period_end,
    cardCount: row.card_count,
    totalStorageUsedBytes: row.total_storage_used_bytes,
  };
}

// ─── Plan Management ─────────────────────────────────────────────────────────

/**
 * Lists all subscription plans (active and inactive).
 * Requirements: 17.6
 */
export async function listPlans(): Promise<SubscriptionPlan[]> {
  const rows = await queryMany<PlanRow>(
    `SELECT * FROM subscription_plans ORDER BY created_at ASC`
  );
  return rows.map(mapPlanRow);
}

/**
 * Gets a single plan by ID.
 * Requirements: 17.6
 */
export async function getPlan(planId: string): Promise<SubscriptionPlan | null> {
  const row = await queryOne<PlanRow>(
    `SELECT * FROM subscription_plans WHERE id = $1`,
    [planId]
  );
  return row ? mapPlanRow(row) : null;
}

/**
 * Gets feature entitlements for a specific plan.
 * Returns an array of feature key + enabled status for the plan.
 * Requirements: 17.7
 */
export async function getFeatureEntitlements(
  planId: string
): Promise<FeatureToggle[]> {
  const plan = await queryOne<{ id: string }>(
    `SELECT id FROM subscription_plans WHERE id = $1`,
    [planId]
  );
  if (!plan) {
    throw new Error('Plan not found');
  }

  const rows = await queryMany<{ feature_key: string; enabled: boolean }>(
    `SELECT feature_key, enabled FROM plan_entitlements WHERE plan_id = $1 ORDER BY feature_key`,
    [planId]
  );

  return rows.map((row) => ({
    featureKey: row.feature_key,
    enabled: row.enabled,
  }));
}

/**
 * Creates a new subscription plan definition.
 * Requirements: 17.6
 */
export async function createPlan(adminId: string, plan: PlanInput): Promise<SubscriptionPlan> {
  if (!plan.name || typeof plan.name !== 'string' || plan.name.trim().length === 0) {
    throw new Error('Plan name is required');
  }

  if (!plan.displayName || typeof plan.displayName !== 'string' || plan.displayName.trim().length === 0) {
    throw new Error('Plan display name is required');
  }

  if (typeof plan.priceMonthyCents !== 'number' || plan.priceMonthyCents < 0) {
    throw new Error('Price must be a non-negative number');
  }

  if (typeof plan.storageLimitMb !== 'number' || plan.storageLimitMb <= 0) {
    throw new Error('Storage limit must be a positive number');
  }

  if (typeof plan.aiQueriesPerDay !== 'number' || (plan.aiQueriesPerDay < -1 || plan.aiQueriesPerDay === 0)) {
    throw new Error('AI queries per day must be a positive number or -1 for unlimited');
  }

  // Check for name uniqueness
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM subscription_plans WHERE name = $1`,
    [plan.name.trim().toLowerCase()]
  );
  if (existing) {
    throw new Error(`A plan with name '${plan.name}' already exists`);
  }

  const row = await queryOne<PlanRow>(
    `INSERT INTO subscription_plans (name, display_name, stripe_price_id, price_monthly_cents, storage_limit_mb, ai_queries_per_day, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     RETURNING *`,
    [
      plan.name.trim().toLowerCase(),
      plan.displayName.trim(),
      plan.stripePriceId ?? null,
      plan.priceMonthyCents,
      plan.storageLimitMb,
      plan.aiQueriesPerDay,
    ]
  );

  if (!row) {
    throw new Error('Failed to create plan');
  }

  await logAuditEntry(adminId, 'plan.create', 'subscription_plan', row.id, {
    name: plan.name,
    displayName: plan.displayName,
    priceMonthyCents: plan.priceMonthyCents,
  });

  log.info({ adminId, planId: row.id, planName: plan.name }, 'Subscription plan created');
  return mapPlanRow(row);
}

/**
 * Updates an existing subscription plan's attributes (limits, pricing).
 * Does not change the plan name.
 * Requirements: 17.6
 */
export async function updatePlan(
  adminId: string,
  planId: string,
  changes: PlanUpdate
): Promise<SubscriptionPlan> {
  // Verify plan exists
  const existing = await queryOne<PlanRow>(
    `SELECT * FROM subscription_plans WHERE id = $1`,
    [planId]
  );
  if (!existing) {
    throw new Error('Plan not found');
  }

  // Build dynamic SET clause from non-undefined changes
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (changes.displayName !== undefined) {
    if (!changes.displayName || changes.displayName.trim().length === 0) {
      throw new Error('Display name cannot be empty');
    }
    setClauses.push(`display_name = $${paramIndex++}`);
    params.push(changes.displayName.trim());
  }

  if (changes.stripePriceId !== undefined) {
    setClauses.push(`stripe_price_id = $${paramIndex++}`);
    params.push(changes.stripePriceId);
  }

  if (changes.priceMonthyCents !== undefined) {
    if (typeof changes.priceMonthyCents !== 'number' || changes.priceMonthyCents < 0) {
      throw new Error('Price must be a non-negative number');
    }
    setClauses.push(`price_monthly_cents = $${paramIndex++}`);
    params.push(changes.priceMonthyCents);
  }

  if (changes.storageLimitMb !== undefined) {
    if (typeof changes.storageLimitMb !== 'number' || changes.storageLimitMb <= 0) {
      throw new Error('Storage limit must be a positive number');
    }
    setClauses.push(`storage_limit_mb = $${paramIndex++}`);
    params.push(changes.storageLimitMb);
  }

  if (changes.aiQueriesPerDay !== undefined) {
    if (typeof changes.aiQueriesPerDay !== 'number' || (changes.aiQueriesPerDay < -1 || changes.aiQueriesPerDay === 0)) {
      throw new Error('AI queries per day must be a positive number or -1 for unlimited');
    }
    setClauses.push(`ai_queries_per_day = $${paramIndex++}`);
    params.push(changes.aiQueriesPerDay);
  }

  if (setClauses.length === 0) {
    throw new Error('No changes provided');
  }

  setClauses.push(`updated_at = NOW()`);
  params.push(planId);

  const row = await queryOne<PlanRow>(
    `UPDATE subscription_plans SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    params
  );

  if (!row) {
    throw new Error('Failed to update plan');
  }

  await logAuditEntry(adminId, 'plan.update', 'subscription_plan', planId, { changes });

  log.info({ adminId, planId, changes }, 'Subscription plan updated');
  return mapPlanRow(row);
}

/**
 * Deactivates a plan so no new subscriptions can be created for it.
 * Existing subscribers remain on the plan until they change.
 * Requirements: 17.6
 */
export async function deactivatePlan(adminId: string, planId: string): Promise<void> {
  const existing = await queryOne<PlanRow>(
    `SELECT * FROM subscription_plans WHERE id = $1`,
    [planId]
  );
  if (!existing) {
    throw new Error('Plan not found');
  }

  if (!existing.is_active) {
    throw new Error('Plan is already inactive');
  }

  await queryOne(
    `UPDATE subscription_plans SET is_active = false, updated_at = NOW() WHERE id = $1`,
    [planId]
  );

  await logAuditEntry(adminId, 'plan.deactivate', 'subscription_plan', planId, {
    planName: existing.name,
  });

  log.info({ adminId, planId, planName: existing.name }, 'Subscription plan deactivated');
}

// ─── Feature Entitlement Management ─────────────────────────────────────────

/**
 * Toggles features on/off for a plan. Updates the plan_entitlements table
 * and immediately invalidates the Redis cache so changes take effect
 * on the next request without code deployment.
 *
 * Requirements: 17.7, 18.14
 */
export async function setFeatureEntitlements(
  adminId: string,
  planId: string,
  features: FeatureToggle[]
): Promise<void> {
  // Verify plan exists
  const plan = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM subscription_plans WHERE id = $1`,
    [planId]
  );
  if (!plan) {
    throw new Error('Plan not found');
  }

  if (!features || features.length === 0) {
    throw new Error('At least one feature toggle is required');
  }

  // Validate all feature keys exist in the registry
  for (const toggle of features) {
    if (!toggle.featureKey || typeof toggle.featureKey !== 'string') {
      throw new Error('Each feature toggle must have a valid featureKey');
    }
    if (typeof toggle.enabled !== 'boolean') {
      throw new Error(`Feature '${toggle.featureKey}' must have a boolean 'enabled' field`);
    }
    if (!featureRegistry.isRegistered(toggle.featureKey)) {
      throw new Error(`Feature '${toggle.featureKey}' is not registered in the feature registry`);
    }
  }

  // Upsert each feature entitlement
  for (const toggle of features) {
    await queryOne(
      `INSERT INTO plan_entitlements (plan_id, feature_key, enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT ON CONSTRAINT plan_entitlements_plan_feature_unique
       DO UPDATE SET enabled = EXCLUDED.enabled`,
      [planId, toggle.featureKey, toggle.enabled]
    );
  }

  // Invalidate Redis cache so changes propagate immediately
  await invalidateCache(planId);

  await logAuditEntry(adminId, 'entitlements.update', 'subscription_plan', planId, {
    planName: plan.name,
    featureToggles: features,
  });

  log.info(
    { adminId, planId, planName: plan.name, featureCount: features.length },
    'Feature entitlements updated and cache invalidated'
  );
}

// ─── Feature Registry Access ─────────────────────────────────────────────────

/**
 * Returns all registered features with keys and descriptions for the admin UI.
 * This allows admins to see which features can be toggled per plan.
 *
 * Requirements: 17.8
 */
export function getFeatureRegistry(): featureRegistry.FeatureRegistryEntry[] {
  return featureRegistry.getAll();
}

// ─── Subscription Metrics ────────────────────────────────────────────────────

/**
 * Returns subscription-specific metrics: subscribers per tier, MRR, churn rate,
 * and upgrade/downgrade counts for the last 30 days.
 *
 * Requirements: 18.10
 */
export async function getSubscriptionMetrics(): Promise<SubscriptionMetrics> {
  // Count active subscribers per tier
  const tierCounts = await queryMany<{ plan_name: string; count: string }>(
    `SELECT sp.name AS plan_name, COUNT(s.id)::text AS count
     FROM subscriptions s
     JOIN subscription_plans sp ON sp.id = s.plan_id
     WHERE s.status = 'active'
     GROUP BY sp.name`
  );

  const counts: Record<string, number> = {};
  for (const row of tierCounts) {
    counts[row.plan_name] = parseInt(row.count, 10);
  }

  // Calculate MRR (Monthly Recurring Revenue) from active subscriptions
  const mrrRow = await queryOne<{ mrr: string }>(
    `SELECT COALESCE(SUM(sp.price_monthly_cents), 0)::text AS mrr
     FROM subscriptions s
     JOIN subscription_plans sp ON sp.id = s.plan_id
     WHERE s.status = 'active'`
  );
  const mrr = parseInt(mrrRow?.mrr ?? '0', 10);

  // Churn rate: subscriptions cancelled in last 30 days / active subscriptions at start of period
  const churnRow = await queryOne<{ cancelled_count: string; total_active: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM subscriptions WHERE canceled_at >= NOW() - INTERVAL '30 days') AS cancelled_count,
       (SELECT COUNT(*)::text FROM subscriptions WHERE status = 'active' OR canceled_at >= NOW() - INTERVAL '30 days') AS total_active`
  );
  const cancelledCount = parseInt(churnRow?.cancelled_count ?? '0', 10);
  const totalActive = parseInt(churnRow?.total_active ?? '1', 10);
  const churnRate = totalActive > 0 ? Math.round((cancelledCount / totalActive) * 10000) / 10000 : 0;

  // Upgrade count in last 30 days (audit log entries for plan upgrades)
  const upgradeRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM audit_log
     WHERE action = 'plan.upgrade' AND created_at >= NOW() - INTERVAL '30 days'`
  );
  const upgradeCount30d = parseInt(upgradeRow?.count ?? '0', 10);

  // Downgrade count in last 30 days
  const downgradeRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM audit_log
     WHERE action = 'plan.downgrade' AND created_at >= NOW() - INTERVAL '30 days'`
  );
  const downgradeCount30d = parseInt(downgradeRow?.count ?? '0', 10);

  return {
    freeCount: counts['free'] ?? 0,
    proCount: counts['pro'] ?? 0,
    enterpriseCount: counts['enterprise'] ?? 0,
    mrr,
    churnRate,
    upgradeCount30d,
    downgradeCount30d,
  };
}


// ─── Admin Data Access Layer (Content Isolation) ─────────────────────────────

/**
 * AdminDataAccess wraps database queries and enforces that no content-bearing
 * fields are ever queried or returned. Any attempt to include forbidden fields
 * is logged and rejected.
 *
 * Requirements: 17.3, 17.4
 */
export class AdminDataAccess {
  /**
   * Validates that a SQL query does not reference forbidden content fields.
   * Throws and logs a security warning if content fields are detected.
   */
  static validateQuerySafety(sql: string): void {
    const lowerSql = sql.toLowerCase();
    for (const field of FORBIDDEN_CONTENT_FIELDS) {
      const regex = new RegExp(`\\b${field}\\b`, 'i');
      if (regex.test(lowerSql)) {
        const msg = `SECURITY VIOLATION: Attempted to access forbidden content field "${field}" in admin query`;
        log.error({ field, sql: sql.substring(0, 200) }, msg);
        throw new ContentAccessViolationError(field);
      }
    }
  }

  /**
   * Validates that a response object does not contain forbidden content fields.
   * Strips any detected fields and logs a warning.
   */
  static sanitizeResponse<T extends Record<string, unknown>>(obj: T): T {
    const sanitized = { ...obj };
    for (const field of FORBIDDEN_CONTENT_FIELDS) {
      if (field in sanitized) {
        log.error(
          { field },
          `SECURITY VIOLATION: Content field "${field}" found in admin response — stripping`
        );
        delete sanitized[field];
      }
    }
    return sanitized;
  }
}

export class ContentAccessViolationError extends Error {
  public readonly field: string;

  constructor(field: string) {
    super(
      `Admin content isolation violation: attempted to access "${field}". Admin service must never access user content.`
    );
    this.name = 'ContentAccessViolationError';
    this.field = field;
  }
}

// ─── User Management Types ───────────────────────────────────────────────────

export interface AdminUserFilters {
  page?: number;
  pageSize?: number;
  email?: string;
  status?: 'active' | 'locked' | 'disabled';
  plan?: string;
  sortBy?: 'registration_date' | 'email' | 'plan_name';
  sortOrder?: 'asc' | 'desc';
}

export interface AdminUserSummary {
  userId: string;
  email: string;
  role: string;
  isLocked: boolean;
  lockedUntil: Date | null;
  registrationDate: Date;
  updatedAt: Date;
  subscriptionId: string | null;
  planName: string | null;
  planDisplayName: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: Date | null;
  cardCount: number;
  totalStorageUsedBytes: number;
}

export interface PaginatedAdminUsers {
  users: AdminUserSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SystemMetrics {
  totalUsers: number;
  activeUsersDaily: number;
  activeUsersWeekly: number;
  activeUsersMonthly: number;
  totalCards: number;
  apiRequestVolume: { last24h: number; last7d: number };
  aiQueueDepth: number;
  errorRates: { last24h: number; last7d: number };
}

export type ModerationAction = 'flag' | 'disable' | 'unflag';

export interface AuditFilters {
  page?: number;
  pageSize?: number;
  adminUserId?: string;
  action?: string;
  targetType?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface AuditEntry {
  id: string;
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown>;
  createdAt: Date;
}

export interface PaginatedAuditEntries {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── User Management Functions ───────────────────────────────────────────────

/**
 * Lists users with pagination, using the admin_user_summary view
 * which structurally excludes content fields.
 *
 * Requirements: 17.2
 */
export async function listUsers(
  filters: AdminUserFilters = {}
): Promise<PaginatedAdminUsers> {
  const {
    page = 1,
    pageSize = 25,
    email,
    status,
    plan,
    sortBy = 'registration_date',
    sortOrder = 'desc',
  } = filters;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (email) {
    conditions.push(`email ILIKE $${paramIndex}`);
    params.push(`%${email}%`);
    paramIndex++;
  }

  if (status === 'locked') {
    conditions.push(`is_locked = true`);
  } else if (status === 'active') {
    conditions.push(`is_locked = false`);
  }

  if (plan) {
    conditions.push(`plan_name = $${paramIndex}`);
    params.push(plan);
    paramIndex++;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Validate sort column to prevent SQL injection
  const validSortColumns: Record<string, string> = {
    registration_date: 'registration_date',
    email: 'email',
    plan_name: 'plan_name',
  };
  const sortColumn = validSortColumns[sortBy] || 'registration_date';
  const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

  // Count total
  const countSql = `SELECT COUNT(*)::integer AS total FROM admin_user_summary ${whereClause}`;
  AdminDataAccess.validateQuerySafety(countSql);
  const countResult = await queryOne<{ total: number }>(countSql, params);
  const total = countResult?.total ?? 0;

  // Fetch page
  const offset = (page - 1) * pageSize;
  const listSql = `
    SELECT user_id, email, role, is_locked, locked_until, registration_date,
           updated_at, subscription_id, plan_name, plan_display_name,
           subscription_status, current_period_end, card_count, total_storage_used_bytes
    FROM admin_user_summary
    ${whereClause}
    ORDER BY ${sortColumn} ${order}
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;
  AdminDataAccess.validateQuerySafety(listSql);

  const rows = await queryMany<{
    user_id: string;
    email: string;
    role: string;
    is_locked: boolean;
    locked_until: Date | null;
    registration_date: Date;
    updated_at: Date;
    subscription_id: string | null;
    plan_name: string | null;
    plan_display_name: string | null;
    subscription_status: string | null;
    current_period_end: Date | null;
    card_count: number;
    total_storage_used_bytes: number;
  }>(listSql, [...params, pageSize, offset]);

  const users: AdminUserSummary[] = rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    role: row.role,
    isLocked: row.is_locked,
    lockedUntil: row.locked_until,
    registrationDate: row.registration_date,
    updatedAt: row.updated_at,
    subscriptionId: row.subscription_id,
    planName: row.plan_name,
    planDisplayName: row.plan_display_name,
    subscriptionStatus: row.subscription_status,
    currentPeriodEnd: row.current_period_end,
    cardCount: row.card_count,
    totalStorageUsedBytes: row.total_storage_used_bytes,
  }));

  return {
    users,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Disables a user account and logs the action to the audit trail.
 *
 * Requirements: 17.2
 */
export async function disableAccount(
  adminId: string,
  userId: string,
  reason: string
): Promise<void> {
  log.info({ adminId, userId, reason }, 'Disabling user account');

  const sql = `UPDATE users SET is_locked = true, locked_until = NULL, updated_at = NOW() WHERE id = $1`;
  AdminDataAccess.validateQuerySafety(sql);
  await query(sql, [userId]);

  await logAuditEntry(adminId, 'disable_account', 'user', userId, { reason });
}

/**
 * Marks a user account for deletion and logs the action to the audit trail.
 *
 * Requirements: 17.2
 */
export async function deleteAccount(
  adminId: string,
  userId: string,
  reason: string
): Promise<void> {
  log.info({ adminId, userId, reason }, 'Marking user account for deletion');

  // Soft-delete: mark items as deleted, then disable the account
  const itemSql = `UPDATE items SET is_deleted = true, deleted_at = NOW() WHERE user_id = $1 AND is_deleted = false`;
  AdminDataAccess.validateQuerySafety(itemSql);
  await query(itemSql, [userId]);

  const userSql = `UPDATE users SET is_locked = true, locked_until = NULL, updated_at = NOW() WHERE id = $1`;
  AdminDataAccess.validateQuerySafety(userSql);
  await query(userSql, [userId]);

  await logAuditEntry(adminId, 'delete_account', 'user', userId, { reason });
}

/**
 * Unlocks a previously locked user account.
 *
 * Requirements: 17.2
 */
export async function unlockAccount(
  adminId: string,
  userId: string
): Promise<void> {
  log.info({ adminId, userId }, 'Unlocking user account');

  const sql = `UPDATE users SET is_locked = false, locked_until = NULL, failed_attempts = 0, updated_at = NOW() WHERE id = $1`;
  AdminDataAccess.validateQuerySafety(sql);
  await query(sql, [userId]);

  await logAuditEntry(adminId, 'unlock_account', 'user', userId);
}

/**
 * Returns aggregated system metrics (counts and rates).
 * Uses only aggregate queries — never accesses content fields.
 *
 * Requirements: 17.5
 */
export async function getSystemMetrics(): Promise<SystemMetrics> {
  const totalUsersResult = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::integer AS count FROM users`
  );

  const activeDaily = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::integer AS count FROM users WHERE updated_at >= NOW() - INTERVAL '1 day'`
  );
  const activeWeekly = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::integer AS count FROM users WHERE updated_at >= NOW() - INTERVAL '7 days'`
  );
  const activeMonthly = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::integer AS count FROM users WHERE updated_at >= NOW() - INTERVAL '30 days'`
  );

  const totalCards = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::integer AS count FROM items WHERE is_deleted = false`
  );

  const apiVolume24h = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::integer AS count FROM audit_log WHERE created_at >= NOW() - INTERVAL '1 day'`
  );
  const apiVolume7d = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::integer AS count FROM audit_log WHERE created_at >= NOW() - INTERVAL '7 days'`
  );

  // AI queue depth: default 0, actual value requires Redis query
  const aiQueueDepth = 0;

  const errors24h = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::integer AS count FROM audit_log WHERE action ILIKE '%error%' AND created_at >= NOW() - INTERVAL '1 day'`
  );
  const errors7d = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::integer AS count FROM audit_log WHERE action ILIKE '%error%' AND created_at >= NOW() - INTERVAL '7 days'`
  );

  return {
    totalUsers: totalUsersResult?.count ?? 0,
    activeUsersDaily: activeDaily?.count ?? 0,
    activeUsersWeekly: activeWeekly?.count ?? 0,
    activeUsersMonthly: activeMonthly?.count ?? 0,
    totalCards: totalCards?.count ?? 0,
    apiRequestVolume: {
      last24h: apiVolume24h?.count ?? 0,
      last7d: apiVolume7d?.count ?? 0,
    },
    aiQueueDepth,
    errorRates: {
      last24h: errors24h?.count ?? 0,
      last7d: errors7d?.count ?? 0,
    },
  };
}

/**
 * Moderates a user account (flag/disable/unflag) without accessing any card content.
 *
 * Requirements: 17.9
 */
export async function moderateAccount(
  adminId: string,
  userId: string,
  action: ModerationAction
): Promise<void> {
  log.info({ adminId, userId, action }, 'Moderating user account');

  if (action === 'disable') {
    const sql = `UPDATE users SET is_locked = true, locked_until = NULL, updated_at = NOW() WHERE id = $1`;
    AdminDataAccess.validateQuerySafety(sql);
    await query(sql, [userId]);
  }
  // 'flag' and 'unflag' are tracked purely via audit trail — no content access needed

  await logAuditEntry(adminId, `moderate_${action}`, 'user', userId, {
    moderationAction: action,
  });
}

/**
 * Returns the admin action audit trail with filtering and pagination.
 *
 * Requirements: 17.10
 */
export async function getAuditTrail(
  filters: AuditFilters = {}
): Promise<PaginatedAuditEntries> {
  const {
    page = 1,
    pageSize = 50,
    adminUserId,
    action,
    targetType,
    startDate,
    endDate,
  } = filters;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (adminUserId) {
    conditions.push(`admin_user_id = $${paramIndex}`);
    params.push(adminUserId);
    paramIndex++;
  }

  if (action) {
    conditions.push(`action = $${paramIndex}`);
    params.push(action);
    paramIndex++;
  }

  if (targetType) {
    conditions.push(`target_type = $${paramIndex}`);
    params.push(targetType);
    paramIndex++;
  }

  if (startDate) {
    conditions.push(`created_at >= $${paramIndex}`);
    params.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    conditions.push(`created_at <= $${paramIndex}`);
    params.push(endDate);
    paramIndex++;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countSql = `SELECT COUNT(*)::integer AS total FROM audit_log ${whereClause}`;
  const countResult = await queryOne<{ total: number }>(countSql, params);
  const total = countResult?.total ?? 0;

  const offset = (page - 1) * pageSize;
  const listSql = `
    SELECT id, admin_user_id, action, target_type, target_id, details, created_at
    FROM audit_log
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  const rows = await queryMany<{
    id: string;
    admin_user_id: string;
    action: string;
    target_type: string;
    target_id: string | null;
    details: Record<string, unknown>;
    created_at: Date;
  }>(listSql, [...params, pageSize, offset]);

  const entries: AuditEntry[] = rows.map((row) => ({
    id: row.id,
    adminUserId: row.admin_user_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    details: row.details,
    createdAt: row.created_at,
  }));

  return {
    entries,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
