import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config.js';

/**
 * Database connection pool and typed query helpers.
 * Uses pg Pool for connection management with automatic cleanup.
 */

let pool: Pool | null = null;

export function getPoolConfig(): PoolConfig {
  const poolConfig: PoolConfig = {
    connectionString: config.databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  // Enable SSL for non-localhost database connections (e.g., Lightsail managed DB)
  if (
    config.databaseUrl &&
    !config.databaseUrl.includes('localhost') &&
    !config.databaseUrl.includes('127.0.0.1')
  ) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }

  return poolConfig;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(getPoolConfig());
  }
  return pool;
}

/**
 * Execute a parameterized query and return typed results.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const client = getPool();
  return client.query<T>(text, params);
}

/**
 * Execute a parameterized query and return the first row, or null if no rows.
 */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
}

/**
 * Execute a parameterized query and return all rows.
 */
export async function queryMany<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await query<T>(text, params);
  return result.rows;
}

/**
 * Execute a query within a transaction.
 */
export async function withTransaction<T>(
  fn: (query: typeof transactionQuery) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const transactionQueryFn = async <R extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: unknown[],
    ): Promise<QueryResult<R>> => {
      return client.query<R>(text, params);
    };

    const result = await fn(transactionQueryFn as typeof transactionQuery);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Type helper for the transaction query function
type TransactionQuery = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

const transactionQuery: TransactionQuery = null as unknown as TransactionQuery;

/**
 * Close the connection pool. Call during graceful shutdown.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
