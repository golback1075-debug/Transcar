import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

export const CLOUD_SQL_PROJECT_ID = firebaseConfig.projectId;

export interface CloudSqlPoolConfig {
  projectId: string;
  host: string | undefined;
  user: string | undefined;
  password: string | undefined;
  database: string | undefined;
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  ssl: boolean;
}

export interface CloudSqlMigrationConfig {
  projectId: string;
  host: string;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
}

/**
 * Runtime application connection pool configuration (Object Method).
 * Uses least-privilege SQL_USER credentials injected by the runtime environment.
 */
export function getRuntimeDbConfig(): CloudSqlPoolConfig {
  return {
    projectId: CLOUD_SQL_PROJECT_ID,
    host: process.env.SQL_HOST,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    max: 10,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
    ssl: false,
  };
}

/**
 * Administrative migration configuration for Drizzle Kit.
 * Uses SQL_ADMIN_USER credentials with DDL privileges.
 */
export function getMigrationDbConfig(): CloudSqlMigrationConfig {
  const host = process.env.SQL_HOST;
  const database = process.env.SQL_DB_NAME;
  const user = process.env.SQL_ADMIN_USER;
  const password = process.env.SQL_ADMIN_PASSWORD;

  if (!host) {
    throw new Error(`SQL_HOST must be set for Cloud SQL project ${CLOUD_SQL_PROJECT_ID}.`);
  }
  if (!database) {
    throw new Error(`SQL_DB_NAME must be set for Cloud SQL project ${CLOUD_SQL_PROJECT_ID}.`);
  }
  if (!user) {
    throw new Error(`SQL_ADMIN_USER must be set for Cloud SQL project ${CLOUD_SQL_PROJECT_ID}.`);
  }
  if (!password) {
    throw new Error(
      `SQL_ADMIN_PASSWORD must be set for Cloud SQL project ${CLOUD_SQL_PROJECT_ID}.`,
    );
  }

  return {
    projectId: CLOUD_SQL_PROJECT_ID,
    host,
    user,
    password,
    database,
    ssl: false,
  };
}
