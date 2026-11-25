import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { CLOUD_SQL_PROJECT_ID, getRuntimeDbConfig } from './config.ts';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

/**
 * Creates or retrieves the cached PostgreSQL Pool using the Object Method.
 * Connections are established lazily on demand without startup probes.
 */
export const createPool = (): Pool => {
  if (!global._postgresPool) {
    const cfg = getRuntimeDbConfig();
    global._postgresPool = new Pool({
      host: cfg.host,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      max: cfg.max,
      connectionTimeoutMillis: cfg.connectionTimeoutMillis,
      idleTimeoutMillis: cfg.idleTimeoutMillis,
    });

    global._postgresPool.on('error', (err) => {
      console.error(
        `Unexpected error on idle Cloud SQL pool client (${CLOUD_SQL_PROJECT_ID}):`,
        err,
      );
    });
  }
  return global._postgresPool;
};

export const pool = createPool();
export const db = drizzle(pool, { schema });
export { CLOUD_SQL_PROJECT_ID };

/**
 * Two-layer query error sanitization helper.
 * Prevents raw SQL schema or connection metadata from leaking to API callers.
 */
export async function executeDbQuery<T>(
  operation: () => Promise<T>,
  publicMessage = 'Database operation failed. Please try again later.',
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.error(`[Cloud SQL ${CLOUD_SQL_PROJECT_ID}] Query failed:`, error);
    throw new Error(publicMessage, { cause: error });
  }
}
