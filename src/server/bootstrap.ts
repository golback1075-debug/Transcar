import crypto from 'node:crypto';
import { count, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { agencyRoles, rentalConditionsVersions, systemSettings } from '../db/schema.ts';
import { OFFICIAL_CONDITIONS_V1 } from '../shared/officialConditions.ts';
import { setSessionSecret } from './auth.ts';
import { ensureStorageDirectories } from './storage.ts';

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(plain: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derived = crypto.scryptSync(plain, salt, 64);
  if (keyBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuf, derived);
}

export const DEFAULT_DELETE_PERMISSIONS = {
  employeeCanDeleteVehicles: false,
  employeeCanDeleteCustomers: false,
  employeeCanDeleteReservations: true,
  employeeCanDeleteContracts: false,
  employeeCanDeleteDocuments: false,
  employeeCanDeleteMaintenance: false,
  employeeCanClearNotifications: false,
};

let initPromise: Promise<void> | null = null;

/**
 * Lazily initializes ONLY system configuration, initial access credential hashes,
 * non-destructive additive schema migrations, and the official 10-article rental conditions v1.0.
 * Zero business data is ever created or deleted here.
 */
export async function ensureSystemInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      ensureStorageDirectories();

      // Safe, additive, non-destructive schema check (only runs ALTER TABLE if columns are missing and user owns table)
      const colCheck = await db.execute(sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'rental_contracts'
      `);
      const existingCols = new Set(
        (colCheck.rows as Array<{ column_name?: string }>).map((r) => r.column_name),
      );
      const requiredCols = [
        'confirmed_at',
        'completed_at',
        'extension_from_date',
        'extension_until_date',
        'extension_exit_time',
        'extension_entry_time',
        'early_return_date',
        'early_return_time',
        'early_return_location',
        'max_mileage_limit',
      ];
      if (requiredCols.some((c) => !existingCols.has(c))) {
        await db.execute(sql`
          ALTER TABLE rental_contracts
            ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS extension_from_date TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS extension_until_date TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS extension_exit_time TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS extension_entry_time TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS early_return_date TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS early_return_time TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS early_return_location TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS max_mileage_limit INTEGER
        `);
      }

      const [{ value: roleCount }] = await db.select({ value: count() }).from(agencyRoles);
      if (Number(roleCount) === 0) {
        const managerInitial = process.env.TRANSCAR_MANAGER_INIT_CODE || '2026';
        const employeeInitial = process.env.TRANSCAR_EMPLOYEE_INIT_CODE || '0000';
        await db
          .insert(agencyRoles)
          .values([
            { role: 'manager', passwordHash: hashPassword(managerInitial) },
            { role: 'employee', passwordHash: hashPassword(employeeInitial) },
          ])
          .onConflictDoNothing();
      }

      const [{ value: condCount }] = await db
        .select({ value: count() })
        .from(rentalConditionsVersions);
      if (Number(condCount) === 0) {
        await db
          .insert(rentalConditionsVersions)
          .values({
            versionNumber: '1.0',
            isPublished: true,
            articlesJson: OFFICIAL_CONDITIONS_V1,
            createdByRole: 'manager',
          })
          .onConflictDoNothing();
      }

      const [{ value: settingsCount }] = await db.select({ value: count() }).from(systemSettings);
      if (Number(settingsCount) === 0) {
        await db
          .insert(systemSettings)
          .values({
            key: 'agency_config',
            valueJson: {
              defaultLanguage: 'fr',
              agencyName: 'TRANSCAR',
              city: 'Blida, Algérie',
              address: 'العربي تيسي 09000 البليدة الجزائر',
              rc: '4038527A04',
              nis: '197809010548427',
              phones: '0560 97 05 36 / 0550 49 57 83',
              email: 'trans.car@hotmail.fr',
            },
          })
          .onConflictDoNothing();
      }

      await db
        .insert(systemSettings)
        .values({
          key: 'delete_permissions',
          valueJson: DEFAULT_DELETE_PERMISSIONS,
        })
        .onConflictDoNothing();

      // Load or create a persistent HMAC session secret so logins survive server restarts
      const [existingSecretRow] = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, 'session_secret'));
      let secret =
        typeof existingSecretRow?.valueJson?.secret === 'string'
          ? existingSecretRow.valueJson.secret
          : '';
      if (!secret) {
        secret = crypto.randomBytes(32).toString('hex');
        await db
          .insert(systemSettings)
          .values({
            key: 'session_secret',
            valueJson: { secret },
          })
          .onConflictDoNothing();
        const [reloaded] = await db
          .select()
          .from(systemSettings)
          .where(eq(systemSettings.key, 'session_secret'));
        if (typeof reloaded?.valueJson?.secret === 'string') {
          secret = reloaded.valueJson.secret;
        }
      }
      if (secret) {
        setSessionSecret(secret);
      }
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}
