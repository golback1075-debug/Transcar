import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  agencyRoles,
  auditLogs,
  backupRecords,
  customers,
  financialTransactions,
  maintenanceRecords,
  notifications,
  rentalConditionsVersions,
  rentalContracts,
  reservations,
  systemSettings,
  vehicleDocuments,
  vehicleReturns,
  vehicles,
  type RentalConditionArticle,
} from '../db/schema.ts';
import { getOrCreateUser } from '../db/users.ts';
import {
  logAudit,
  parseContractAccessToken,
  requireAuth,
  requireManager,
  signContractAccessToken,
  signSessionToken,
  verifyContractAccessToken,
  verifyFirebaseToken,
} from './auth.ts';
import {
  DEFAULT_DELETE_PERMISSIONS,
  ensureSystemInitialized,
  hashPassword,
  verifyPassword,
} from './bootstrap.ts';
import {
  calculateDistanceCharges,
  calculateDurationDays,
  calculateLateReturnCharges,
  computeDefaultExpiryOneYear,
  computeDocumentStatus,
  datesOverlap,
  getAlgiersTodayIso,
  getMaintenanceAlertsForVehicle,
  MAINTENANCE_INTERVALS,
} from './business.ts';
import { broadcastSyncEvent, registerSseClient } from './events.ts';
import { createFullBackupArchive, runExpiryAndMaintenanceChecks } from './scheduler.ts';
import {
  BACKUPS_DIR,
  deleteStoredFile,
  isAllowedDocFile,
  isAllowedImageFile,
  resolveStoredFile,
  saveUploadedFile,
  UPLOADS_ROOT,
} from './storage.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const uploadIdempotencyCache = new Map<string, { status: number; body: Record<string, unknown>; ts: number }>();

function getCachedUploadResponse(key: string | null) {
  if (!key) return null;
  const hit = uploadIdempotencyCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > 30 * 60 * 1000) {
    uploadIdempotencyCache.delete(key);
    return null;
  }
  return hit;
}

function setCachedUploadResponse(key: string | null, status: number, body: Record<string, unknown>) {
  if (!key) return;
  if (uploadIdempotencyCache.size > 500) {
    const oldest = uploadIdempotencyCache.keys().next().value;
    if (oldest) uploadIdempotencyCache.delete(oldest);
  }
  uploadIdempotencyCache.set(key, { status, body, ts: Date.now() });
}

function sendPgOrUnexpectedError(res: Response, err: unknown, fallbackMessage: string) {
  const pgErr = err as { code?: string; detail?: string; message?: string } | null;
  const code = pgErr?.code || '';
  if (code === '23505') {
    res.status(409).json({ error: 'Un enregistrement identique existe déjà (doublon détecté).' });
    return;
  }
  if (code === '23503') {
    res.status(400).json({ error: 'Élément associé introuvable ou supprimé (référence invalide).' });
    return;
  }
  if (code === '22P02' || code === '22003') {
    res.status(400).json({ error: 'Valeur numérique ou format de donnée invalide.' });
    return;
  }
  console.error('[API Error]', err);
  res.status(500).json({ error: fallbackMessage });
}

function parseOptionalNonNegInt(raw: unknown, fallback: number): number | null {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num);
}

function parseNullableNonNegInt(raw: unknown): number | null | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return 'invalid';
  return Math.round(num);
}

function isBlockingContractStatus(status: string): boolean {
  return status === 'confirmed' || status === 'active';
}

function isOpenContractStatus(status: string): boolean {
  return status === 'pending' || status === 'upcoming' || status === 'confirmed' || status === 'active';
}

const CONTRACT_SEQ_KEY = 'contract_number_seq';
const CONTRACT_SEQ_LOCK_ID = 884210;

function formatContractNumber(seq: number): string {
  return `TRANSCAR-${String(Math.max(1, seq)).padStart(4, '0')}`;
}

function extractMaxContractSequence(rows: Array<{ contractNumber: string }>): number {
  let maxSeq = 0;
  for (const row of rows) {
    const m = /^TRANSCAR-(\d+)$/.exec(String(row.contractNumber || '').trim());
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  return maxSeq;
}

async function computeMaxExistingContractSeq(executor: typeof db): Promise<number> {
  const contractNumberRows = await executor
    .select({ contractNumber: rentalContracts.contractNumber })
    .from(rentalContracts)
    .where(sql`${rentalContracts.contractNumber} ~ '^TRANSCAR-[0-9]+$'`);
  return extractMaxContractSequence(contractNumberRows);
}

async function computeCurrentMaxContractSeq(executor: typeof db): Promise<number> {
  const [seqSettingRows, maxExisting] = await Promise.all([
    executor.select().from(systemSettings).where(eq(systemSettings.key, CONTRACT_SEQ_KEY)),
    computeMaxExistingContractSeq(executor),
  ]);
  const storedRaw = (seqSettingRows[0]?.valueJson as { lastSeq?: unknown } | undefined)?.lastSeq;
  const storedSeq = Number.isFinite(Number(storedRaw)) && Number(storedRaw) > 0 ? Math.floor(Number(storedRaw)) : 0;
  return Math.max(storedSeq, maxExisting);
}

async function peekNextContractNumber(): Promise<string> {
  const currentMax = await computeCurrentMaxContractSeq(db);
  return formatContractNumber(currentMax + 1);
}

async function allocateNextContractNumber(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${CONTRACT_SEQ_LOCK_ID})`);
  let seq = (await computeCurrentMaxContractSeq(tx as unknown as typeof db)) + 1;
  let candidate = formatContractNumber(seq);

  // Double-check uniqueness in case of manual inserts
  while (true) {
    const [existing] = await tx
      .select({ id: rentalContracts.id })
      .from(rentalContracts)
      .where(eq(rentalContracts.contractNumber, candidate));
    if (!existing) break;
    seq += 1;
    candidate = formatContractNumber(seq);
  }

  await tx
    .insert(systemSettings)
    .values({ key: CONTRACT_SEQ_KEY, valueJson: { lastSeq: seq }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { valueJson: { lastSeq: seq }, updatedAt: new Date() },
    });

  return candidate;
}

export type DeletePermissionConfig = typeof DEFAULT_DELETE_PERMISSIONS;

function getIdempotencyKey(req: Request): string | null {
  const headerVal = req.header('x-idempotency-key');
  const bodyVal = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : null;
  const raw = (headerVal || bodyVal || '').trim();
  return raw.length >= 6 && raw.length <= 160 ? raw : null;
}

async function getDeletePermissions(): Promise<DeletePermissionConfig> {
  const [row] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, 'delete_permissions'));
  return {
    ...DEFAULT_DELETE_PERMISSIONS,
    ...((row?.valueJson as Partial<DeletePermissionConfig> | undefined) || {}),
  };
}

type DeleteTarget =
  | 'vehicles'
  | 'customers'
  | 'reservations'
  | 'contracts'
  | 'documents'
  | 'maintenance'
  | 'notifications'
  | 'finance'
  | 'backups';

async function canRoleDelete(
  role: 'manager' | 'employee' | undefined,
  target: DeleteTarget,
): Promise<boolean> {
  if (role === 'manager') return true;
  if (!role || target === 'finance' || target === 'backups') return false;
  const perms = await getDeletePermissions();
  switch (target) {
    case 'vehicles':
      return Boolean(perms.employeeCanDeleteVehicles);
    case 'customers':
      return Boolean(perms.employeeCanDeleteCustomers);
    case 'reservations':
      return Boolean(perms.employeeCanDeleteReservations);
    case 'contracts':
      return Boolean(perms.employeeCanDeleteContracts);
    case 'documents':
      return Boolean(perms.employeeCanDeleteDocuments);
    case 'maintenance':
      return Boolean(perms.employeeCanDeleteMaintenance);
    case 'notifications':
      return Boolean(perms.employeeCanClearNotifications);
    default:
      return false;
  }
}

function computeCashSummary(
  txs: Array<{ txType: string; amountDzd: number; txDate: Date; archivedAt: Date | null }>,
) {
  const todayIso = getAlgiersTodayIso();
  const currentMonth = todayIso.slice(0, 7);

  let totalIncome = 0;
  let totalDepositsIn = 0;
  let totalDepositsRefund = 0;
  let totalExpenses = 0;
  let totalRefunds = 0;
  let totalWithdrawals = 0;
  let dailyTotal = 0;
  let monthlyTotal = 0;
  let cashBalance = 0;

  for (const tx of txs) {
    if (tx.archivedAt) continue;
    const txDay = tx.txDate.toISOString().slice(0, 10);
    const txMonth = tx.txDate.toISOString().slice(0, 7);

    if (tx.txType === 'rental_payment' || tx.txType === 'late_extra_fee') {
      totalIncome += tx.amountDzd;
      cashBalance += tx.amountDzd;
      if (txDay === todayIso) dailyTotal += tx.amountDzd;
      if (txMonth === currentMonth) monthlyTotal += tx.amountDzd;
    } else if (tx.txType === 'deposit_in') {
      totalDepositsIn += tx.amountDzd;
      cashBalance += tx.amountDzd;
    } else if (tx.txType === 'deposit_refund') {
      totalDepositsRefund += tx.amountDzd;
      cashBalance -= tx.amountDzd;
    } else if (tx.txType === 'expense') {
      totalExpenses += tx.amountDzd;
      cashBalance -= tx.amountDzd;
    } else if (tx.txType === 'refund') {
      totalRefunds += tx.amountDzd;
      cashBalance -= tx.amountDzd;
    } else if (tx.txType === 'cash_withdrawal') {
      totalWithdrawals += tx.amountDzd;
      cashBalance -= tx.amountDzd;
    }
  }

  return {
    cashBalance,
    totalIncome,
    totalDepositsHeld: totalDepositsIn - totalDepositsRefund,
    totalExpenses,
    totalRefunds,
    totalWithdrawals,
    netProfit: totalIncome - totalExpenses - totalRefunds,
    dailyTotal,
    monthlyTotal,
  };
}

export function createApiRouter() {
  const router = express.Router();

  // Public application version endpoint (no cache) for PWA update verification
  router.get('/version', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const distVer = path.resolve(process.cwd(), 'dist', 'version.json');
    const pubVer = path.resolve(process.cwd(), 'public', 'version.json');
    const candidateFiles =
      process.env.NODE_ENV === 'production' ? [distVer, pubVer] : [pubVer, distVer];
    for (const filePath of candidateFiles) {
      try {
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          res.json(parsed);
          return;
        }
      } catch {
        // continue fallback
      }
    }

    try {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as {
        version?: string;
      };
      res.json({
        version: pkg.version || '1.0.0',
        buildDate: new Date().toISOString(),
        minSupportedVersion: '1.0.0',
        releaseNotes: { fr: [], ar: [], en: [] },
      });
    } catch {
      res.json({
        version: '1.0.0',
        buildDate: new Date().toISOString(),
        minSupportedVersion: '1.0.0',
        releaseNotes: { fr: [], ar: [], en: [] },
      });
    }
  });

  // Ensure DB config/roles/official conditions are initialized lazily on API access
  router.use(async (_req, res, next) => {
    try {
      await ensureSystemInitialized();
      next();
    } catch (err) {
      console.error('[Bootstrap error]', err);
      res.status(500).json({ error: 'Erreur de connexion à la base de données' });
    }
  });

  // ==========================================
  // AUTHENTICATION
  // ==========================================

  router.post('/auth/login', async (req: Request, res: Response) => {
    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (!password) {
      res.status(400).json({ error: 'Mot de passe requis' });
      return;
    }

    const roles = await db.select().from(agencyRoles);
    const matched = roles.find((r) => verifyPassword(password, r.passwordHash));
    if (!matched) {
      res.status(401).json({ error: "Code d'accès invalide" });
      return;
    }

    const role = matched.role === 'manager' ? 'manager' : 'employee';
    const token = signSessionToken({
      role,
      uid: `agency-${role}`,
      email: `${role}@transcar.dz`,
    });

    await logAudit({ role, uid: `agency-${role}`, email: '' }, 'LOGIN', 'session', role);
    res.json({
      token,
      role,
      email: `${role}@transcar.dz`,
    });
  });

  router.post('/auth/firebase', async (req: Request, res: Response) => {
    const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken : '';
    if (!idToken) {
      res.status(400).json({ error: 'Token Firebase manquant' });
      return;
    }
    try {
      const decoded = await verifyFirebaseToken(idToken);
      const email = decoded.email || '';
      const dbUser = await getOrCreateUser(decoded.uid, email);
      const role: 'manager' | 'employee' =
        dbUser?.role === 'manager' ? 'manager' : 'employee';
      const token = signSessionToken({ role, uid: decoded.uid, email });
      res.json({ token, role, email });
    } catch {
      res.status(401).json({ error: 'Authentification Firebase invalide' });
    }
  });

  router.get('/auth/me', requireAuth, (req: Request, res: Response) => {
    res.json({ user: req.auth });
  });

  router.post('/auth/change-password', requireAuth, requireManager, async (req: Request, res: Response) => {
    const targetRole = req.body?.targetRole === 'manager' ? 'manager' : 'employee';
    const newPassword =
      typeof req.body?.newPassword === 'string' ? req.body.newPassword.trim() : '';

    if (newPassword.length < 4) {
      res.status(400).json({ error: 'Le code doit contenir au moins 4 caractères' });
      return;
    }

    await db
      .update(agencyRoles)
      .set({
        passwordHash: hashPassword(newPassword),
        updatedAt: new Date(),
      })
      .where(eq(agencyRoles.role, targetRole));

    await logAudit(req.auth, 'CHANGE_PASSWORD', 'agency_roles', targetRole);
    res.json({ ok: true, targetRole });
  });

  // ==========================================
  // PUBLIC CUSTOMER BOOKING WEBSITE API
  // ==========================================

  router.get('/public/vehicle-photo/:id', async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).end();
      return;
    }
    const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, id));
    if (!vehicle) {
      res.status(404).end();
      return;
    }
    const resolved = resolveStoredFile(vehicle.photoPath);
    if (!resolved) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', resolved.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(resolved.absPath).pipe(res);
  });

  router.get('/public/vehicles', async (req: Request, res: Response) => {
    const startStr = typeof req.query.startDate === 'string' ? req.query.startDate : '';
    const endStr = typeof req.query.endDate === 'string' ? req.query.endDate : '';

    const startDate = startStr ? new Date(`${startStr}T08:00:00Z`) : null;
    const endDate = endStr ? new Date(`${endStr}T18:00:00Z`) : null;

    const allVehicles = await db
      .select()
      .from(vehicles)
      .where(isNull(vehicles.archivedAt))
      .orderBy(vehicles.brand, vehicles.model);
    const activeMaint = await db
      .select()
      .from(maintenanceRecords)
      .where(and(eq(maintenanceRecords.status, 'in_progress'), isNull(maintenanceRecords.archivedAt)));
    const allRes = await db
      .select()
      .from(reservations)
      .where(and(ne(reservations.status, 'cancelled'), isNull(reservations.archivedAt)));
    const allContracts = await db
      .select()
      .from(rentalContracts)
      .where(and(ne(rentalContracts.status, 'cancelled'), isNull(rentalContracts.archivedAt)));

    const available = allVehicles
      .filter((v) => {
        if (v.manualStatus === 'maintenance') return false;
        if (activeMaint.some((m) => m.vehicleId === v.id)) return false;

        if (startDate && endDate && !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
          const hasResOverlap = allRes.some(
            (r) =>
              r.vehicleId === v.id &&
              (r.status === 'pending' || r.status === 'confirmed') &&
              datesOverlap(r.startDate, r.endDate, startDate, endDate),
          );
          if (hasResOverlap) return false;

          const hasContractOverlap = allContracts.some(
            (c) =>
              c.vehicleId === v.id &&
              isBlockingContractStatus(c.status) &&
              datesOverlap(c.startAt, c.endAt, startDate, endDate),
          );
          if (hasContractOverlap) return false;
        } else {
          // Without date range, show vehicles not currently in confirmed/active rental or maintenance
          const activeNow = allContracts.some(
            (c) => c.vehicleId === v.id && isBlockingContractStatus(c.status),
          );
          if (activeNow) return false;
        }
        return true;
      })
      .map((v) => ({
        id: v.id,
        brand: v.brand,
        model: v.model,
        year: v.year,
        color: v.color,
        dailyPriceDzd: v.dailyPriceDzd,
        fuelType: v.fuelType,
        transmission: v.transmission,
        seats: v.seats,
        photoUrl: `/api/public/vehicle-photo/${v.id}`,
      }));

    res.json({ vehicles: available });
  });

  router.get('/public/conditions', async (_req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(rentalConditionsVersions)
      .where(eq(rentalConditionsVersions.isPublished, true))
      .orderBy(desc(rentalConditionsVersions.id));

    const current = rows[0];
    if (!current) {
      res.status(404).json({ error: 'Conditions non trouvées' });
      return;
    }
    res.json({
      id: current.id,
      versionNumber: current.versionNumber,
      articles: current.articlesJson,
      createdAt: current.createdAt,
    });
  });

  router.get('/public/contract-access/:token', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    const rawToken = String(req.params.token || '').trim();
    const parsed = parseContractAccessToken(rawToken);
    if (!parsed) {
      res.status(404).json({ error: 'Contrat numérique introuvable ou lien invalide' });
      return;
    }

    const [ct] = await db
      .select()
      .from(rentalContracts)
      .where(and(eq(rentalContracts.id, parsed.contractId), isNull(rentalContracts.archivedAt)));

    if (!ct || !verifyContractAccessToken(rawToken, { id: ct.id, contractNumber: ct.contractNumber })) {
      res.status(404).json({ error: 'Contrat numérique introuvable ou lien invalide' });
      return;
    }

    const [[veh], [cust], drvCustRows, [ret], condRows] = await Promise.all([
      db.select().from(vehicles).where(eq(vehicles.id, ct.vehicleId)),
      db.select().from(customers).where(eq(customers.id, ct.customerId)),
      ct.driverCustomerId
        ? db.select().from(customers).where(eq(customers.id, ct.driverCustomerId))
        : Promise.resolve([]),
      db
        .select()
        .from(vehicleReturns)
        .where(and(eq(vehicleReturns.contractId, ct.id), isNull(vehicleReturns.archivedAt))),
      ct.conditionsVersionId
        ? db
            .select()
            .from(rentalConditionsVersions)
            .where(eq(rentalConditionsVersions.id, ct.conditionsVersionId))
        : db
            .select()
            .from(rentalConditionsVersions)
            .where(eq(rentalConditionsVersions.isPublished, true))
            .orderBy(desc(rentalConditionsVersions.id)),
    ]);

    const drvCust = drvCustRows[0] || null;
    const condVersion = condRows[0] || null;
    const conditionsArticles: RentalConditionArticle[] =
      Array.isArray(ct.conditionsSnapshotJson) && ct.conditionsSnapshotJson.length > 0
        ? ct.conditionsSnapshotJson
        : condVersion?.articlesJson || [];

    const serializePublicCustomer = (c: typeof cust | undefined | null) =>
      c
        ? {
            id: c.id,
            fullName: c.fullName,
            dateOfBirth: c.dateOfBirth,
            birthPlace: c.birthPlace,
            phone: c.phone,
            address: c.address,
            email: c.email,
            idType: c.idType,
            idNumber: c.idNumber,
            idIssuedBy: c.idIssuedBy,
            country: c.country,
            licenceNumber: c.licenceNumber,
            licenceFrontUrl: null,
            licenceBackUrl: null,
            contractsCount: 0,
            reservationsCount: 0,
            rentalHistory: [],
          }
        : null;

    res.json({
      contract: {
        id: ct.id,
        contractNumber: ct.contractNumber,
        reservationId: ct.reservationId,
        vehicleId: ct.vehicleId,
        customerId: ct.customerId,
        driverCustomerId: ct.driverCustomerId,
        driverName: ct.driverName,
        driverDob: ct.driverDob,
        driverIdNumber: ct.driverIdNumber,
        driverLicenceNumber: ct.driverLicenceNumber,
        driverCountry: ct.driverCountry,
        driverAddress: ct.driverAddress,
        driverPhone: ct.driverPhone,
        startAt: ct.startAt,
        endAt: ct.endAt,
        durationDays: ct.durationDays,
        dailyPriceDzd: ct.dailyPriceDzd,
        totalAmountDzd: ct.totalAmountDzd,
        depositDzd: ct.depositDzd,
        amountPaidDzd: ct.amountPaidDzd,
        departureMileage: ct.departureMileage,
        departureFuelLevel: ct.departureFuelLevel,
        departureNotes: ct.departureNotes,
        departureDamageJson: ct.departureDamageJson,
        status: ct.status,
        confirmedAt: ct.confirmedAt,
        completedAt: ct.completedAt,
        pickupLocation: ct.pickupLocation,
        returnLocation: ct.returnLocation,
        extensionNumber: ct.extensionNumber,
        extensionStartAt: ct.extensionStartAt,
        extensionEndAt: ct.extensionEndAt,
        extensionDays: ct.extensionDays,
        extensionFromDate: ct.extensionFromDate,
        extensionUntilDate: ct.extensionUntilDate,
        extensionExitTime: ct.extensionExitTime,
        extensionEntryTime: ct.extensionEntryTime,
        earlyReturnDate: ct.earlyReturnDate,
        earlyReturnTime: ct.earlyReturnTime,
        earlyReturnLocation: ct.earlyReturnLocation,
        maxMileageLimit: ct.maxMileageLimit,
        version: ct.version,
        createdAt: ct.createdAt,
        digitalAccessToken: rawToken,
        vehicle: veh
          ? {
              id: veh.id,
              brand: veh.brand,
              model: veh.model,
              year: veh.year,
              color: veh.color,
              registrationNumber: veh.registrationNumber,
              dailyPriceDzd: veh.dailyPriceDzd,
              currentMileage: veh.currentMileage,
              photoPath: '',
              photoUrl: `/api/public/vehicle-photo/${veh.id}`,
              fuelType: veh.fuelType,
              transmission: veh.transmission,
              seats: veh.seats,
              chassisNumber: veh.chassisNumber,
              engineSeries: veh.engineSeries,
              manualStatus: veh.manualStatus,
              computedStatus: isBlockingContractStatus(ct.status) ? 'rented' : 'available',
              availableForRange: true,
              docAlertCount: 0,
              maintAlerts: [],
            }
          : null,
        customer: serializePublicCustomer(cust),
        driverCustomer: serializePublicCustomer(drvCust),
        returnRecord: ret
          ? {
              id: ret.id,
              contractId: ret.contractId,
              vehicleId: ret.vehicleId,
              returnedAt: ret.returnedAt,
              returnMileage: ret.returnMileage,
              fuelLevel: ret.fuelLevel,
              conditionNotes: ret.conditionNotes,
              damageMarkersJson: ret.damageMarkersJson,
              lateHours: ret.lateHours,
              lateFeeDzd: ret.lateFeeDzd,
              allowedKm: ret.allowedKm,
              drivenKm: ret.drivenKm,
              extraKm: ret.extraKm,
              extraKmFeeDzd: ret.extraKmFeeDzd,
              damageFeeDzd: ret.damageFeeDzd,
              fuelCleaningFeeDzd: ret.fuelCleaningFeeDzd,
              totalAdditionalFeeDzd: ret.totalAdditionalFeeDzd,
            }
          : null,
      },
      conditionsVersionNumber: condVersion?.versionNumber || '1.0',
      conditionsArticles,
      agency: {
        name: 'TRANSCAR',
        address: 'Larbi Tébessi 09000 Blida, Algérie',
        phones: ['0560 97 05 36', '0550 49 57 83'],
        email: 'trans.car@hotmail.fr',
        commerceRegister: '4038527A04',
        nis: '197809010548427',
      },
    });
  });

  router.post(
    '/public/reservations',
    upload.fields([
      { name: 'licenceFront', maxCount: 1 },
      { name: 'licenceBack', maxCount: 1 },
    ]),
    async (req: Request, res: Response) => {
      const vehicleId = Number(req.body?.vehicleId);
      const startDateStr = String(req.body?.startDate || '');
      const endDateStr = String(req.body?.endDate || '');
      const fullName = String(req.body?.fullName || '').trim();
      const phone = String(req.body?.phone || '').trim();
      const email = String(req.body?.email || '').trim();
      const dateOfBirth = String(req.body?.dateOfBirth || '').trim();
      const address = String(req.body?.address || '').trim();
      const idNumber = String(req.body?.idNumber || '').trim();
      const licenceNumber = String(req.body?.licenceNumber || '').trim();
      const conditionsAccepted =
        req.body?.conditionsAccepted === 'true' || req.body?.conditionsAccepted === true;
      const conditionsVersionId = Number(req.body?.conditionsVersionId);

      if (!vehicleId || !startDateStr || !endDateStr || !fullName || !phone) {
        res.status(400).json({ error: 'Veuillez remplir tous les champs obligatoires' });
        return;
      }
      if (!conditionsAccepted) {
        res.status(400).json({ error: 'Vous devez accepter les conditions de location' });
        return;
      }

      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const frontFile = files?.licenceFront?.[0];
      const backFile = files?.licenceBack?.[0];
      if (!frontFile || !backFile) {
        res.status(400).json({ error: 'Le permis de conduire (recto et verso) est obligatoire' });
        return;
      }
      if (!isAllowedDocFile(frontFile) || !isAllowedDocFile(backFile)) {
        res.status(400).json({ error: 'Format de permis non supporté (PDF, JPG, JPEG, PNG, WEBP)' });
        return;
      }

      const startDate = new Date(`${startDateStr}T09:00:00Z`);
      const endDate = new Date(`${endDateStr}T18:00:00Z`);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
        res.status(400).json({ error: 'Dates de location invalides' });
        return;
      }

      try {
        const result = await db.transaction(async (tx) => {
          // Lock the vehicle row to serialize concurrent reservations
          const lockedRows = await tx.execute(
            sql`SELECT * FROM vehicles WHERE id = ${vehicleId} FOR UPDATE`,
          );
          if (lockedRows.rows.length === 0) {
            throw new Error('VEHICLE_NOT_FOUND');
          }
          const [vehicle] = await tx
            .select()
            .from(vehicles)
            .where(and(eq(vehicles.id, vehicleId), isNull(vehicles.archivedAt)));
          if (!vehicle || vehicle.manualStatus === 'maintenance') {
            throw new Error('VEHICLE_UNAVAILABLE');
          }

          const activeMaint = await tx
            .select()
            .from(maintenanceRecords)
            .where(
              and(
                eq(maintenanceRecords.vehicleId, vehicleId),
                eq(maintenanceRecords.status, 'in_progress'),
                isNull(maintenanceRecords.archivedAt),
              ),
            );
          if (activeMaint.length > 0) {
            throw new Error('VEHICLE_UNAVAILABLE');
          }

          const existingRes = await tx
            .select()
            .from(reservations)
            .where(and(eq(reservations.vehicleId, vehicleId), isNull(reservations.archivedAt)));
          if (
            existingRes.some(
              (r) =>
                (r.status === 'pending' || r.status === 'confirmed') &&
                datesOverlap(r.startDate, r.endDate, startDate, endDate),
            )
          ) {
            throw new Error('DATE_CONFLICT');
          }

          const existingContracts = await tx
            .select()
            .from(rentalContracts)
            .where(and(eq(rentalContracts.vehicleId, vehicleId), isNull(rentalContracts.archivedAt)));
          if (
            existingContracts.some(
              (c) =>
                isBlockingContractStatus(c.status) &&
                datesOverlap(c.startAt, c.endAt, startDate, endDate),
            )
          ) {
            throw new Error('DATE_CONFLICT');
          }

          const publishedCond = await tx
            .select()
            .from(rentalConditionsVersions)
            .where(
              conditionsVersionId
                ? eq(rentalConditionsVersions.id, conditionsVersionId)
                : eq(rentalConditionsVersions.isPublished, true),
            );
          const condRow = publishedCond[0];

          const frontPath = saveUploadedFile(
            'licences',
            frontFile.buffer,
            frontFile.originalname,
            frontFile.mimetype,
          );
          const backPath = saveUploadedFile(
            'licences',
            backFile.buffer,
            backFile.originalname,
            backFile.mimetype,
          );

          const [customer] = await tx
            .insert(customers)
            .values({
              fullName,
              phone,
              email,
              dateOfBirth,
              address,
              idNumber,
              licenceNumber,
              licenceFrontPath: frontPath,
              licenceBackPath: backPath,
            })
            .returning();

          const days = calculateDurationDays(startDate, endDate);
          const totalAmountDzd = days * vehicle.dailyPriceDzd;
          const reservationCode = `RES-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

          const [createdRes] = await tx
            .insert(reservations)
            .values({
              reservationCode,
              vehicleId: vehicle.id,
              customerId: customer.id,
              startDate,
              endDate,
              dailyPriceDzd: vehicle.dailyPriceDzd,
              totalAmountDzd,
              status: 'confirmed',
              source: 'website',
              conditionsVersionId: condRow?.id ?? null,
              conditionsAcceptedAt: new Date(),
              notes: 'Réservation soumise depuis le portail client en ligne',
            })
            .returning();

          await tx.insert(notifications).values({
            audience: 'all',
            severity: 'normal',
            category: 'reservation',
            title: `Nouvelle réservation web · ${vehicle.registrationNumber}`,
            message: `${customer.fullName} (${customer.phone}) · ${vehicle.brand} ${vehicle.model} (${startDateStr} au ${endDateStr})`,
            metadataJson: {
              reservationId: createdRes.id,
              vehicleId: vehicle.id,
              customerId: customer.id,
            },
          });

          return { createdRes, vehicle, customer };
        });

        broadcastSyncEvent({
          type: 'data_changed',
          entity: 'reservations',
          id: result.createdRes.id,
        });
        broadcastSyncEvent({
          type: 'notification',
          entity: 'notification',
        });

        res.status(201).json({
          reservationCode: result.createdRes.reservationCode,
          totalAmountDzd: result.createdRes.totalAmountDzd,
          vehicle: `${result.vehicle.brand} ${result.vehicle.model}`,
          startDate: result.createdRes.startDate,
          endDate: result.createdRes.endDate,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'VEHICLE_NOT_FOUND') {
          res.status(404).json({ error: 'Véhicule introuvable' });
          return;
        }
        if (msg === 'VEHICLE_UNAVAILABLE' || msg === 'DATE_CONFLICT') {
          res.status(409).json({
            error: "Ce véhicule n'est plus disponible pour les dates sélectionnées",
          });
          return;
        }
        console.error('[Public Reservation error]', err);
        res.status(500).json({ error: 'Impossible de finaliser la réservation' });
      }
    },
  );

  // ==========================================
  // PROTECTED SSE REAL-TIME SYNC
  // ==========================================

  router.get('/events', requireAuth, (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(
      `data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`,
    );
    registerSseClient(res);
  });

  // ==========================================
  // PROTECTED FILE STREAMING
  // ==========================================

  router.get('/files/vehicle/:id', requireAuth, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, id));
    if (!vehicle) {
      res.status(404).end();
      return;
    }
    const resolved = resolveStoredFile(vehicle.photoPath);
    if (!resolved) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', resolved.mimeType);
    fs.createReadStream(resolved.absPath).pipe(res);
  });

  router.get('/files/document/:docId', requireAuth, async (req: Request, res: Response) => {
    const docId = Number(req.params.docId);
    const [doc] = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.id, docId));
    if (!doc) {
      res.status(404).json({ error: 'Document introuvable' });
      return;
    }
    const resolved = resolveStoredFile(doc.filePath);
    if (!resolved) {
      res.status(404).json({ error: 'Fichier introuvable' });
      return;
    }
    res.setHeader('Content-Type', resolved.mimeType);
    fs.createReadStream(resolved.absPath).pipe(res);
  });

  router.get(
    '/files/licence/:customerId/:side',
    requireAuth,
    async (req: Request, res: Response) => {
      const customerId = Number(req.params.customerId);
      const side = req.params.side === 'back' ? 'back' : 'front';
      const [cust] = await db.select().from(customers).where(eq(customers.id, customerId));
      if (!cust) {
        res.status(404).json({ error: 'Client introuvable' });
        return;
      }
      const relPath = side === 'back' ? cust.licenceBackPath : cust.licenceFrontPath;
      if (!relPath) {
        res.status(404).json({ error: 'Permis non téléversé' });
        return;
      }
      const resolved = resolveStoredFile(relPath);
      if (!resolved) {
        res.status(404).json({ error: 'Fichier introuvable' });
        return;
      }
      res.setHeader('Content-Type', resolved.mimeType);
      fs.createReadStream(resolved.absPath).pipe(res);
    },
  );

  // ==========================================
  // DASHBOARD (Role-Aware)
  // ==========================================

  router.get('/dashboard', requireAuth, async (req: Request, res: Response) => {
    const [
      allVehicles,
      allCustomers,
      allRes,
      allContracts,
      allMaint,
      allDocs,
      allNotifs,
    ] = await Promise.all([
      db.select().from(vehicles).where(isNull(vehicles.archivedAt)),
      db.select().from(customers).where(isNull(customers.archivedAt)),
      db.select().from(reservations).where(isNull(reservations.archivedAt)),
      db.select().from(rentalContracts).where(isNull(rentalContracts.archivedAt)),
      db.select().from(maintenanceRecords).where(isNull(maintenanceRecords.archivedAt)),
      db
        .select()
        .from(vehicleDocuments)
        .where(and(eq(vehicleDocuments.isCurrent, true), isNull(vehicleDocuments.archivedAt))),
      db.select().from(notifications).orderBy(desc(notifications.createdAt)),
    ]);

    const todayIso = getAlgiersTodayIso();
    const now = new Date();

    let availableCount = 0;
    let reservedCount = 0;
    let rentedCount = 0;
    let maintenanceCount = 0;

    for (const v of allVehicles) {
      const hasActiveMaint =
        v.manualStatus === 'maintenance' ||
        allMaint.some((m) => m.vehicleId === v.id && m.status === 'in_progress');
      const activeContract = allContracts.find(
        (c) => c.vehicleId === v.id && isBlockingContractStatus(c.status),
      );
      const activeRes = allRes.find(
        (r) =>
          r.vehicleId === v.id &&
          (r.status === 'pending' || r.status === 'confirmed') &&
          r.endDate.getTime() >= now.getTime(),
      );
      if (hasActiveMaint) maintenanceCount++;
      else if (activeContract) rentedCount++;
      else if (activeRes) reservedCount++;
      else availableCount++;
    }

    const activeContracts = allContracts.filter((c) => isBlockingContractStatus(c.status));
    const overdueContracts = activeContracts.filter((c) => c.endAt.getTime() < now.getTime());
    const todayReservations = allRes.filter(
      (r) =>
        (r.status === 'pending' || r.status === 'confirmed') &&
        r.startDate.toISOString().slice(0, 10) === todayIso,
    );
    const todayReturns = activeContracts.filter(
      (c) => c.endAt.toISOString().slice(0, 10) === todayIso,
    );
    const upcomingReturns = activeContracts.filter(
      (c) => c.endAt.getTime() >= now.getTime(),
    );

    const docAlerts = allDocs
      .map((d) => ({ ...d, computed: computeDocumentStatus(d.expiryDate) }))
      .filter((d) => d.computed.color === 'red' || d.computed.color === 'orange');

    const maintAlerts = allVehicles.flatMap((v) =>
      getMaintenanceAlertsForVehicle(
        v.currentMileage,
        allMaint.filter((m) => m.vehicleId === v.id),
      )
        .filter((a) => a.state !== 'ok')
        .map((a) => ({ ...a, vehicleId: v.id, vehicleName: `${v.brand} ${v.model}`, plate: v.registrationNumber })),
    );

    const visibleNotifs =
      req.auth?.role === 'manager'
        ? allNotifs
        : allNotifs.filter((n) => n.audience === 'all');

    let financeSummary: Record<string, number> | null = null;
    if (req.auth?.role === 'manager') {
      const txs = await db
        .select()
        .from(financialTransactions)
        .where(isNull(financialTransactions.archivedAt));
      const computed = computeCashSummary(txs);

      financeSummary = {
        dailyRevenue: computed.dailyTotal,
        monthlyRevenue: computed.monthlyTotal,
        totalRevenue: computed.totalIncome,
        totalExpenses: computed.totalExpenses + computed.totalRefunds,
        totalWithdrawals: computed.totalWithdrawals,
        netProfit: computed.netProfit,
        cashBalance: computed.cashBalance,
      };
    }

    res.json({
      stats: {
        totalVehicles: allVehicles.length,
        availableVehicles: availableCount,
        reservedVehicles: reservedCount,
        rentedVehicles: rentedCount,
        maintenanceVehicles: maintenanceCount,
        totalCustomers: allCustomers.length,
        activeRentals: activeContracts.length,
        overdueReturns: overdueContracts.length,
        todayReservations: todayReservations.length,
        todayReturns: todayReturns.length,
        upcomingReturns: upcomingReturns.length,
        maintenanceAlerts: maintAlerts.length,
        documentExpiryAlerts: docAlerts.length,
        unreadNotifications: visibleNotifs.filter((n) => !n.isRead).length,
      },
      docAlerts,
      maintAlerts,
      recentContracts: allContracts.slice(0, 6),
      financeSummary,
    });
  });

  // ==========================================
  // VEHICLES (PARC AUTOMOBILE)
  // ==========================================

  router.get('/vehicles', requireAuth, async (req: Request, res: Response) => {
    const startStr = typeof req.query.startDate === 'string' ? req.query.startDate : '';
    const endStr = typeof req.query.endDate === 'string' ? req.query.endDate : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

    const startDate = startStr ? new Date(`${startStr}T08:00:00Z`) : null;
    const endDate = endStr ? new Date(`${endStr}T18:00:00Z`) : null;

    const [allVehicles, allRes, allContracts, allMaint, allDocs] = await Promise.all([
      db.select().from(vehicles).where(isNull(vehicles.archivedAt)).orderBy(desc(vehicles.createdAt)),
      db
        .select()
        .from(reservations)
        .where(and(ne(reservations.status, 'cancelled'), isNull(reservations.archivedAt))),
      db
        .select()
        .from(rentalContracts)
        .where(and(ne(rentalContracts.status, 'cancelled'), isNull(rentalContracts.archivedAt))),
      db.select().from(maintenanceRecords).where(isNull(maintenanceRecords.archivedAt)),
      db
        .select()
        .from(vehicleDocuments)
        .where(and(eq(vehicleDocuments.isCurrent, true), isNull(vehicleDocuments.archivedAt))),
    ]);

    const now = new Date();
    const enriched = allVehicles
      .filter((v) => {
        if (!search) return true;
        return (
          v.brand.toLowerCase().includes(search) ||
          v.model.toLowerCase().includes(search) ||
          v.registrationNumber.toLowerCase().includes(search)
        );
      })
      .map((v) => {
        const inProgressMaint = allMaint.find(
          (m) => m.vehicleId === v.id && m.status === 'in_progress',
        );
        const activeContract = allContracts.find(
          (c) => c.vehicleId === v.id && isBlockingContractStatus(c.status),
        );
        const upcomingRes = allRes
          .filter(
            (r) =>
              r.vehicleId === v.id &&
              (r.status === 'pending' || r.status === 'confirmed') &&
              r.endDate.getTime() >= now.getTime(),
          )
          .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];

        let computedStatus: 'available' | 'reserved' | 'rented' | 'maintenance' = 'available';
        if (v.manualStatus === 'maintenance' || inProgressMaint) {
          computedStatus = 'maintenance';
        } else if (activeContract) {
          computedStatus = 'rented';
        } else if (upcomingRes) {
          computedStatus = 'reserved';
        }

        let availableForRange = computedStatus !== 'maintenance';
        if (
          availableForRange &&
          startDate &&
          endDate &&
          !Number.isNaN(startDate.getTime()) &&
          !Number.isNaN(endDate.getTime())
        ) {
          const resOverlap = allRes.some(
            (r) =>
              r.vehicleId === v.id &&
              (r.status === 'pending' || r.status === 'confirmed') &&
              datesOverlap(r.startDate, r.endDate, startDate, endDate),
          );
          const contractOverlap = allContracts.some(
            (c) =>
              c.vehicleId === v.id &&
              isBlockingContractStatus(c.status) &&
              datesOverlap(c.startAt, c.endAt, startDate, endDate),
          );
          availableForRange = !resOverlap && !contractOverlap;
        }

        const vDocs = allDocs
          .filter((d) => d.vehicleId === v.id)
          .map((d) => ({ ...d, computed: computeDocumentStatus(d.expiryDate) }));

        const docAlertCount = vDocs.filter(
          (d) => d.computed.color === 'red' || d.computed.color === 'orange',
        ).length;

        const maintAlerts = getMaintenanceAlertsForVehicle(
          v.currentMileage,
          allMaint.filter((m) => m.vehicleId === v.id),
        );

        return {
          ...v,
          photoUrl: `/api/files/vehicle/${v.id}`,
          computedStatus,
          availableForRange,
          activeReservation: upcomingRes || null,
          activeContract: activeContract || null,
          inProgressMaintenance: inProgressMaint || null,
          docAlertCount,
          maintAlerts,
        };
      });

    res.json({ vehicles: enriched });
  });

  router.post(
    '/vehicles',
    requireAuth,
    upload.single('photo'),
    async (req: Request, res: Response) => {
      const brand = String(req.body?.brand || '').trim();
      const model = String(req.body?.model || '').trim();
      const year = Number(req.body?.year);
      const color = String(req.body?.color || '').trim();
      const registrationNumber = String(req.body?.registrationNumber || '').trim().toUpperCase();
      const dailyPriceDzd = Number(req.body?.dailyPriceDzd);
      const currentMileage = parseOptionalNonNegInt(req.body?.currentMileage, 0);
      const fuelType = String(req.body?.fuelType || 'Essence').trim();
      const transmission = String(req.body?.transmission || 'Manuelle').trim();
      const seats = parseOptionalNonNegInt(req.body?.seats, 5);
      const chassisNumber = String(req.body?.chassisNumber || '').trim();
      const engineSeries = String(req.body?.engineSeries || '').trim();

      if (!req.file) {
        res.status(400).json({ error: 'La photo du véhicule est obligatoire' });
        return;
      }
      if (!isAllowedImageFile(req.file)) {
        res.status(400).json({ error: 'Format photo invalide (JPG, JPEG, PNG ou WEBP requis)' });
        return;
      }
      if (!registrationNumber) {
        res.status(400).json({ error: "Le numéro d'immatriculation est obligatoire" });
        return;
      }
      if (!brand || !model || !color) {
        res.status(400).json({ error: 'Marque, modèle et couleur sont obligatoires' });
        return;
      }
      if (!Number.isFinite(year) || year < 1980 || year > 2100) {
        res.status(400).json({ error: 'Année du véhicule invalide (1980 - 2100)' });
        return;
      }
      if (!Number.isFinite(dailyPriceDzd) || dailyPriceDzd <= 0) {
        res.status(400).json({ error: 'Le prix journalier doit être supérieur à 0 DZD' });
        return;
      }
      if (currentMileage === null || seats === null || seats < 1 || seats > 20) {
        res.status(400).json({ error: 'Kilométrage ou nombre de places invalide' });
        return;
      }

      try {
        const idempotencyKey = getIdempotencyKey(req);
        if (idempotencyKey) {
          const [existingByKey] = await db
            .select()
            .from(vehicles)
            .where(eq(vehicles.idempotencyKey, idempotencyKey));
          if (existingByKey) {
            res.status(200).json({
              vehicle: { ...existingByKey, photoUrl: `/api/files/vehicle/${existingByKey.id}` },
            });
            return;
          }
        }

        const duplicate = await db
          .select()
          .from(vehicles)
          .where(and(eq(vehicles.registrationNumber, registrationNumber), isNull(vehicles.archivedAt)));
        if (duplicate.length > 0) {
          res.status(409).json({
            error: "Ce numéro d'immatriculation existe déjà dans le parc automobile",
          });
          return;
        }

        const photoPath = saveUploadedFile(
          'vehicles',
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype,
        );

        const [created] = await db
          .insert(vehicles)
          .values({
            brand,
            model,
            year: Math.round(year),
            color,
            registrationNumber,
            dailyPriceDzd: Math.round(dailyPriceDzd),
            currentMileage,
            photoPath,
            fuelType,
            transmission,
            seats,
            chassisNumber,
            engineSeries,
            manualStatus: 'available',
            idempotencyKey,
          })
          .returning();

        await logAudit(req.auth, 'CREATE_VEHICLE', 'vehicles', created.id, {
          registrationNumber,
        });
        broadcastSyncEvent({ type: 'data_changed', entity: 'vehicles', id: created.id });

        res.status(201).json({
          vehicle: { ...created, photoUrl: `/api/files/vehicle/${created.id}` },
        });
      } catch (err) {
        sendPgOrUnexpectedError(res, err, 'Impossible d’enregistrer le véhicule');
      }
    },
  );

  router.put(
    '/vehicles/:id',
    requireAuth,
    upload.single('photo'),
    async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        const [existing] = await db
          .select()
          .from(vehicles)
          .where(and(eq(vehicles.id, id), isNull(vehicles.archivedAt)));
        if (!existing) {
          res.status(404).json({ error: 'Véhicule introuvable' });
          return;
        }

        const expectedVersion = req.body?.version ? Number(req.body.version) : null;
        if (expectedVersion !== null && existing.version !== expectedVersion) {
          res.status(409).json({
            error: 'Conflit de synchronisation : ce véhicule a été modifié sur un autre poste',
            conflict: true,
            serverRecord: { ...existing, photoUrl: `/api/files/vehicle/${existing.id}` },
          });
          return;
        }

        const registrationNumber = String(
          req.body?.registrationNumber || existing.registrationNumber,
        )
          .trim()
          .toUpperCase();
        if (!registrationNumber) {
          res.status(400).json({ error: "Le numéro d'immatriculation est obligatoire" });
          return;
        }

        const yearVal = req.body?.year !== undefined && req.body?.year !== '' ? Number(req.body.year) : existing.year;
        const priceVal =
          req.body?.dailyPriceDzd !== undefined && req.body?.dailyPriceDzd !== ''
            ? Number(req.body.dailyPriceDzd)
            : existing.dailyPriceDzd;
        const mileageVal = parseOptionalNonNegInt(req.body?.currentMileage, existing.currentMileage);
        const seatsVal = parseOptionalNonNegInt(req.body?.seats, existing.seats);
        if (
          !Number.isFinite(yearVal) ||
          yearVal < 1980 ||
          yearVal > 2100 ||
          !Number.isFinite(priceVal) ||
          priceVal <= 0 ||
          mileageVal === null ||
          seatsVal === null
        ) {
          res.status(400).json({ error: 'Valeurs numériques du véhicule invalides' });
          return;
        }

        const dup = await db
          .select()
          .from(vehicles)
          .where(
            and(
              eq(vehicles.registrationNumber, registrationNumber),
              ne(vehicles.id, id),
              isNull(vehicles.archivedAt),
            ),
          );
        if (dup.length > 0) {
          res.status(409).json({ error: "Ce numéro d'immatriculation est déjà utilisé" });
          return;
        }

        let photoPath = existing.photoPath;
        if (req.file) {
          if (!isAllowedImageFile(req.file)) {
            res.status(400).json({ error: 'Format photo invalide (JPG, JPEG, PNG ou WEBP requis)' });
            return;
          }
          photoPath = saveUploadedFile(
            'vehicles',
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype,
          );
        }

        const [updated] = await db
          .update(vehicles)
          .set({
            brand: String(req.body?.brand || existing.brand).trim(),
            model: String(req.body?.model || existing.model).trim(),
            year: Math.round(yearVal),
            color: String(req.body?.color || existing.color).trim(),
            registrationNumber,
            dailyPriceDzd: Math.round(priceVal),
            currentMileage: mileageVal,
            fuelType: String(req.body?.fuelType || existing.fuelType).trim(),
            transmission: String(req.body?.transmission || existing.transmission).trim(),
            seats: seatsVal,
            chassisNumber: String(req.body?.chassisNumber ?? existing.chassisNumber ?? '').trim(),
            engineSeries: String(req.body?.engineSeries ?? existing.engineSeries ?? '').trim(),
            photoPath,
            version: existing.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(vehicles.id, id))
          .returning();

        await logAudit(req.auth, 'UPDATE_VEHICLE', 'vehicles', id, { registrationNumber });
        broadcastSyncEvent({ type: 'data_changed', entity: 'vehicles', id });

        res.json({ vehicle: { ...updated, photoUrl: `/api/files/vehicle/${updated.id}` } });
      } catch (err) {
        sendPgOrUnexpectedError(res, err, 'Impossible de modifier le véhicule');
      }
    },
  );

  router.delete('/vehicles/:id', requireAuth, async (req: Request, res: Response) => {
    const allowed = await canRoleDelete(req.auth?.role, 'vehicles');
    if (!allowed) {
      res.status(403).json({ error: 'Permission insuffisante pour supprimer un véhicule' });
      return;
    }

    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, id), isNull(vehicles.archivedAt)));
    if (!existing) {
      res.status(404).json({ error: 'Véhicule introuvable' });
      return;
    }

    const [vContracts, vReservations, vReturns, vFinance, vDocs] = await Promise.all([
      db.select().from(rentalContracts).where(eq(rentalContracts.vehicleId, id)),
      db.select().from(reservations).where(eq(reservations.vehicleId, id)),
      db.select().from(vehicleReturns).where(eq(vehicleReturns.vehicleId, id)),
      db.select().from(financialTransactions).where(eq(financialTransactions.vehicleId, id)),
      db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, id)),
    ]);

    const hasActiveContract = vContracts.some(
      (c) => !c.archivedAt && isOpenContractStatus(c.status),
    );
    if (hasActiveContract) {
      res.status(409).json({
        error: 'Suppression impossible : ce véhicule est lié à un contrat actif ou à venir.',
      });
      return;
    }

    const hasOpenReservation = vReservations.some(
      (r) => !r.archivedAt && (r.status === 'pending' || r.status === 'confirmed'),
    );
    if (hasOpenReservation) {
      res.status(409).json({
        error: 'Suppression impossible : ce véhicule a une réservation confirmée en cours.',
      });
      return;
    }

    const hasHistory =
      vContracts.length > 0 || vReservations.length > 0 || vReturns.length > 0 || vFinance.length > 0;

    if (hasHistory) {
      // Safe archive preserving legal & financial foreign key history
      const archivedPlate = `${existing.registrationNumber}#ARCH${id}`;
      await db
        .update(vehicles)
        .set({
          archivedAt: new Date(),
          archivedByRole: req.auth?.role || 'manager',
          registrationNumber: archivedPlate,
          version: existing.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(vehicles.id, id));
      await logAudit(req.auth, 'ARCHIVE_VEHICLE', 'vehicles', id, {
        registrationNumber: existing.registrationNumber,
      });
      broadcastSyncEvent({ type: 'data_changed', entity: 'vehicles', id });
      res.json({
        ok: true,
        mode: 'archived',
        message: 'Véhicule archivé avec conservation de l’historique financier et des contrats.',
      });
      return;
    }

    // Permanent delete for unused vehicle record + clean up uploaded files
    for (const d of vDocs) {
      deleteStoredFile(d.filePath);
    }
    deleteStoredFile(existing.photoPath);
    await db.delete(vehicles).where(eq(vehicles.id, id));
    await logAudit(req.auth, 'DELETE_VEHICLE', 'vehicles', id, {
      registrationNumber: existing.registrationNumber,
    });
    broadcastSyncEvent({ type: 'data_changed', entity: 'vehicles', id });
    res.json({ ok: true, mode: 'deleted', message: 'Véhicule supprimé définitivement.' });
  });

  // ==========================================
  // VEHICLE DOCUMENTS & EXPIRY
  // ==========================================

  router.get('/vehicles/:id/documents', requireAuth, async (req: Request, res: Response) => {
    const vehicleId = Number(req.params.id);
    const docs = await db
      .select()
      .from(vehicleDocuments)
      .where(and(eq(vehicleDocuments.vehicleId, vehicleId), isNull(vehicleDocuments.archivedAt)))
      .orderBy(desc(vehicleDocuments.uploadedAt));

    const enriched = docs.map((d) => ({
      ...d,
      fileUrl: `/api/files/document/${d.id}`,
      computed: computeDocumentStatus(d.expiryDate),
    }));
    res.json({ documents: enriched });
  });

  router.post(
    '/vehicles/:id/documents',
    requireAuth,
    upload.single('file'),
    async (req: Request, res: Response) => {
      try {
        const idempotencyKey = getIdempotencyKey(req);
        const cached = getCachedUploadResponse(idempotencyKey ? `vdoc:${idempotencyKey}` : null);
        if (cached) {
          res.status(cached.status).json(cached.body);
          return;
        }

        const vehicleId = Number(req.params.id);
        const [vehicle] = await db
          .select()
          .from(vehicles)
          .where(and(eq(vehicles.id, vehicleId), isNull(vehicles.archivedAt)));
        if (!vehicle) {
          res.status(404).json({ error: 'Véhicule introuvable' });
          return;
        }
        if (!req.file) {
          res.status(400).json({ error: 'Le fichier document (PDF ou Image) est obligatoire' });
          return;
        }
        if (!isAllowedDocFile(req.file)) {
          res.status(400).json({ error: 'Format non supporté (PDF, JPG, JPEG, PNG, WEBP)' });
          return;
        }

        const docType = String(req.body?.docType || 'assurance').trim();
        const docName = String(req.body?.docName || docType).trim();
        const issueDate = String(req.body?.issueDate || getAlgiersTodayIso()).trim();
        const rawExpiry = String(req.body?.expiryDate || '').trim();
        const noExpiry = req.body?.noExpiry === 'true' || req.body?.noExpiry === true;
        const replaceDocId = req.body?.replaceDocId ? Number(req.body.replaceDocId) : null;

        if (!docName || !issueDate) {
          res.status(400).json({ error: "Le nom et la date d'émission du document sont obligatoires" });
          return;
        }

        let expiryDate = '';
        if (!noExpiry) {
          expiryDate =
            rawExpiry ||
            (docType === 'carte_grise' ? '' : computeDefaultExpiryOneYear(issueDate));
        }

        const filePath = saveUploadedFile(
          'documents',
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype,
        );

        const [created] = await db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(vehicleDocuments)
            .values({
              vehicleId,
              docType,
              docName,
              issueDate,
              expiryDate,
              filePath,
              mimeType: req.file!.mimetype || 'application/octet-stream',
              isCurrent: true,
            })
            .returning();

          if (replaceDocId) {
            await tx
              .update(vehicleDocuments)
              .set({ isCurrent: false, replacedById: inserted.id })
              .where(
                and(
                  eq(vehicleDocuments.id, replaceDocId),
                  eq(vehicleDocuments.vehicleId, vehicleId),
                ),
              );
          }
          return [inserted];
        });

        await runExpiryAndMaintenanceChecks();
        await logAudit(req.auth, 'UPLOAD_VEHICLE_DOCUMENT', 'vehicle_documents', created.id, {
          vehicleId,
          docType,
          expiryDate,
        });
        broadcastSyncEvent({ type: 'data_changed', entity: 'vehicle_documents', id: created.id });

        const payloadBody = {
          document: {
            ...created,
            fileUrl: `/api/files/document/${created.id}`,
            computed: computeDocumentStatus(created.expiryDate),
          },
        };
        setCachedUploadResponse(idempotencyKey ? `vdoc:${idempotencyKey}` : null, 201, payloadBody);
        res.status(201).json(payloadBody);
      } catch (err) {
        sendPgOrUnexpectedError(res, err, 'Impossible d’enregistrer le document du véhicule');
      }
    },
  );

  router.delete(
    '/vehicles/:id/documents/:docId',
    requireAuth,
    async (req: Request, res: Response) => {
      const allowed = await canRoleDelete(req.auth?.role, 'documents');
      if (!allowed) {
        res.status(403).json({ error: 'Permission insuffisante pour supprimer un document' });
        return;
      }

      const docId = Number(req.params.docId);
      const vehicleId = Number(req.params.id);
      const [doc] = await db
        .select()
        .from(vehicleDocuments)
        .where(
          and(
            eq(vehicleDocuments.id, docId),
            eq(vehicleDocuments.vehicleId, vehicleId),
            isNull(vehicleDocuments.archivedAt),
          ),
        );
      if (!doc) {
        res.status(404).json({ error: 'Document introuvable' });
        return;
      }

      await db
        .update(vehicleDocuments)
        .set({
          isCurrent: false,
          archivedAt: new Date(),
          archivedByRole: req.auth?.role || 'manager',
        })
        .where(eq(vehicleDocuments.id, docId));
      await logAudit(req.auth, 'ARCHIVE_VEHICLE_DOCUMENT', 'vehicle_documents', docId, {
        vehicleId,
        docName: doc.docName,
      });
      broadcastSyncEvent({ type: 'data_changed', entity: 'vehicle_documents', id: docId });
      res.json({ ok: true, mode: 'archived' });
    },
  );

  // ==========================================
  // CUSTOMERS & DRIVING LICENCES
  // ==========================================

  router.get('/customers', requireAuth, async (req: Request, res: Response) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const [allCust, allContracts, allRes] = await Promise.all([
      db.select().from(customers).where(isNull(customers.archivedAt)).orderBy(desc(customers.createdAt)),
      db.select().from(rentalContracts).where(isNull(rentalContracts.archivedAt)).orderBy(desc(rentalContracts.createdAt)),
      db.select().from(reservations).where(isNull(reservations.archivedAt)).orderBy(desc(reservations.createdAt)),
    ]);

    const filtered = allCust
      .filter((c) => {
        if (!search) return true;
        return (
          c.fullName.toLowerCase().includes(search) ||
          c.phone.toLowerCase().includes(search) ||
          (c.licenceNumber || '').toLowerCase().includes(search)
        );
      })
      .map((c) => ({
        ...c,
        licenceFrontUrl: c.licenceFrontPath ? `/api/files/licence/${c.id}/front` : null,
        licenceBackUrl: c.licenceBackPath ? `/api/files/licence/${c.id}/back` : null,
        contractsCount: allContracts.filter((ct) => ct.customerId === c.id).length,
        reservationsCount: allRes.filter((r) => r.customerId === c.id).length,
        rentalHistory: allContracts.filter((ct) => ct.customerId === c.id),
      }));

    res.json({ customers: filtered });
  });

  router.post('/customers', requireAuth, async (req: Request, res: Response) => {
    try {
      const fullName = String(req.body?.fullName || '').trim();
      const phone = String(req.body?.phone || '').trim();
      if (!fullName || !phone) {
        res.status(400).json({ error: 'Nom complet et téléphone obligatoires' });
        return;
      }

      const idempotencyKey = getIdempotencyKey(req);
      if (idempotencyKey) {
        const [existingByKey] = await db
          .select()
          .from(customers)
          .where(eq(customers.idempotencyKey, idempotencyKey));
        if (existingByKey) {
          res.status(200).json({ customer: existingByKey });
          return;
        }
      }

      const [created] = await db
        .insert(customers)
        .values({
          fullName,
          phone,
          dateOfBirth: String(req.body?.dateOfBirth || '').trim(),
          birthPlace: String(req.body?.birthPlace || '').trim(),
          address: String(req.body?.address || '').trim(),
          email: String(req.body?.email || '').trim(),
          idType: String(req.body?.idType || 'CNI').trim(),
          idNumber: String(req.body?.idNumber || '').trim(),
          idIssuedBy: String(req.body?.idIssuedBy || '').trim(),
          country: String(req.body?.country || 'Algérie').trim(),
          licenceNumber: String(req.body?.licenceNumber || '').trim(),
          idempotencyKey,
        })
        .returning();

      await logAudit(req.auth, 'CREATE_CUSTOMER', 'customers', created.id);
      broadcastSyncEvent({ type: 'data_changed', entity: 'customers', id: created.id });
      res.status(201).json({ customer: created });
    } catch (err) {
      sendPgOrUnexpectedError(res, err, 'Impossible d’enregistrer le client');
    }
  });

  router.put('/customers/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const [existing] = await db
        .select()
        .from(customers)
        .where(and(eq(customers.id, id), isNull(customers.archivedAt)));
      if (!existing) {
        res.status(404).json({ error: 'Client introuvable' });
        return;
      }
      const expectedVersion = req.body?.version ? Number(req.body.version) : null;
      if (expectedVersion !== null && existing.version !== expectedVersion) {
        res.status(409).json({
          error: 'Conflit de synchronisation : ce client a été modifié sur un autre poste',
          conflict: true,
          serverRecord: existing,
        });
        return;
      }

      const nextName = String(req.body?.fullName ?? existing.fullName).trim();
      const nextPhone = String(req.body?.phone ?? existing.phone).trim();
      if (!nextName || !nextPhone) {
        res.status(400).json({ error: 'Nom complet et téléphone obligatoires' });
        return;
      }

      const [updated] = await db
        .update(customers)
        .set({
          fullName: nextName,
          phone: nextPhone,
          dateOfBirth: String(req.body?.dateOfBirth ?? existing.dateOfBirth ?? '').trim(),
          birthPlace: String(req.body?.birthPlace ?? existing.birthPlace ?? '').trim(),
          address: String(req.body?.address ?? existing.address ?? '').trim(),
          email: String(req.body?.email ?? existing.email ?? '').trim(),
          idType: String(req.body?.idType ?? existing.idType ?? 'CNI').trim(),
          idNumber: String(req.body?.idNumber ?? existing.idNumber ?? '').trim(),
          idIssuedBy: String(req.body?.idIssuedBy ?? existing.idIssuedBy ?? '').trim(),
          country: String(req.body?.country ?? existing.country ?? 'Algérie').trim(),
          licenceNumber: String(req.body?.licenceNumber ?? existing.licenceNumber ?? '').trim(),
          version: existing.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, id))
        .returning();

      await logAudit(req.auth, 'UPDATE_CUSTOMER', 'customers', id);
      broadcastSyncEvent({ type: 'data_changed', entity: 'customers', id });
      res.json({ customer: updated });
    } catch (err) {
      sendPgOrUnexpectedError(res, err, 'Impossible de modifier le client');
    }
  });

  router.delete('/customers/:id', requireAuth, async (req: Request, res: Response) => {
    const allowed = await canRoleDelete(req.auth?.role, 'customers');
    if (!allowed) {
      res.status(403).json({ error: 'Permission insuffisante pour supprimer un client' });
      return;
    }

    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), isNull(customers.archivedAt)));
    if (!existing) {
      res.status(404).json({ error: 'Client introuvable' });
      return;
    }

    const [cContracts, cReservations] = await Promise.all([
      db.select().from(rentalContracts).where(eq(rentalContracts.customerId, id)),
      db.select().from(reservations).where(eq(reservations.customerId, id)),
    ]);

    const hasActiveContract = cContracts.some(
      (c) => !c.archivedAt && isOpenContractStatus(c.status),
    );
    if (hasActiveContract) {
      res.status(409).json({
        error: 'Suppression impossible : ce client possède un contrat actif ou à venir.',
      });
      return;
    }

    const hasOpenRes = cReservations.some(
      (r) => !r.archivedAt && (r.status === 'pending' || r.status === 'confirmed'),
    );
    if (hasOpenRes) {
      res.status(409).json({
        error: 'Suppression impossible : ce client possède une réservation en cours.',
      });
      return;
    }

    if (cContracts.length > 0 || cReservations.length > 0) {
      await db
        .update(customers)
        .set({
          archivedAt: new Date(),
          archivedByRole: req.auth?.role || 'manager',
          version: existing.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, id));
      await logAudit(req.auth, 'ARCHIVE_CUSTOMER', 'customers', id, { fullName: existing.fullName });
      broadcastSyncEvent({ type: 'data_changed', entity: 'customers', id });
      res.json({
        ok: true,
        mode: 'archived',
        message: 'Client archivé avec conservation de son historique de contrats.',
      });
      return;
    }

    deleteStoredFile(existing.licenceFrontPath);
    deleteStoredFile(existing.licenceBackPath);
    await db.delete(customers).where(eq(customers.id, id));
    await logAudit(req.auth, 'DELETE_CUSTOMER', 'customers', id, { fullName: existing.fullName });
    broadcastSyncEvent({ type: 'data_changed', entity: 'customers', id });
    res.json({ ok: true, mode: 'deleted', message: 'Client supprimé définitivement.' });
  });

  router.delete('/customers/:id/licence/:side', requireAuth, async (req: Request, res: Response) => {
    const canDelCust = await canRoleDelete(req.auth?.role, 'customers');
    const canDelDoc = await canRoleDelete(req.auth?.role, 'documents');
    if (!canDelCust && !canDelDoc) {
      res.status(403).json({ error: 'Permission insuffisante pour supprimer le permis de conduire' });
      return;
    }

    const id = Number(req.params.id);
    const side = req.params.side === 'back' ? 'back' : 'front';
    const [existing] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), isNull(customers.archivedAt)));
    if (!existing) {
      res.status(404).json({ error: 'Client introuvable' });
      return;
    }

    if (side === 'front') {
      deleteStoredFile(existing.licenceFrontPath);
    } else {
      deleteStoredFile(existing.licenceBackPath);
    }

    const [updated] = await db
      .update(customers)
      .set({
        ...(side === 'front' ? { licenceFrontPath: '' } : { licenceBackPath: '' }),
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, id))
      .returning();

    await logAudit(req.auth, 'DELETE_CUSTOMER_LICENCE', 'customers', id, { side });
    broadcastSyncEvent({ type: 'data_changed', entity: 'customers', id });
    res.json({ ok: true, customer: updated });
  });

  router.post(
    '/customers/:id/licence',
    requireAuth,
    upload.fields([
      { name: 'front', maxCount: 1 },
      { name: 'back', maxCount: 1 },
    ]),
    async (req: Request, res: Response) => {
      try {
        const idempotencyKey = getIdempotencyKey(req);
        const cached = getCachedUploadResponse(idempotencyKey ? `lic:${idempotencyKey}` : null);
        if (cached) {
          res.status(cached.status).json(cached.body);
          return;
        }

        const id = Number(req.params.id);
        const [existing] = await db
          .select()
          .from(customers)
          .where(and(eq(customers.id, id), isNull(customers.archivedAt)));
        if (!existing) {
          res.status(404).json({ error: 'Client introuvable' });
          return;
        }

        const files = req.files as Record<string, Express.Multer.File[]> | undefined;
        const frontFile = files?.front?.[0];
        const backFile = files?.back?.[0];

        if (!frontFile && !backFile) {
          res.status(400).json({ error: 'Veuillez sélectionner au moins un fichier (recto ou verso)' });
          return;
        }

        if (
          (frontFile && !isAllowedDocFile(frontFile)) ||
          (backFile && !isAllowedDocFile(backFile))
        ) {
          res.status(400).json({ error: 'Format permis invalide (PDF, JPG, JPEG, PNG, WEBP)' });
          return;
        }

        const licenceFrontPath = frontFile
          ? saveUploadedFile('licences', frontFile.buffer, frontFile.originalname, frontFile.mimetype)
          : existing.licenceFrontPath;
        const licenceBackPath = backFile
          ? saveUploadedFile('licences', backFile.buffer, backFile.originalname, backFile.mimetype)
          : existing.licenceBackPath;

        const [updated] = await db
          .update(customers)
          .set({
            licenceFrontPath,
            licenceBackPath,
            licenceNumber: req.body?.licenceNumber
              ? String(req.body.licenceNumber).trim()
              : existing.licenceNumber,
            updatedAt: new Date(),
          })
          .where(eq(customers.id, id))
          .returning();

        await logAudit(req.auth, 'UPLOAD_LICENCE', 'customers', id);
        broadcastSyncEvent({ type: 'data_changed', entity: 'customers', id });
        const payloadBody = {
          customer: {
            ...updated,
            licenceFrontUrl: updated.licenceFrontPath ? `/api/files/licence/${updated.id}/front` : null,
            licenceBackUrl: updated.licenceBackPath ? `/api/files/licence/${updated.id}/back` : null,
          },
        };
        setCachedUploadResponse(idempotencyKey ? `lic:${idempotencyKey}` : null, 200, payloadBody);
        res.json(payloadBody);
      } catch (err) {
        sendPgOrUnexpectedError(res, err, 'Impossible d’enregistrer le permis de conduire');
      }
    },
  );

  // ==========================================
  // RESERVATIONS
  // ==========================================

  router.get('/reservations', requireAuth, async (_req: Request, res: Response) => {
    const [allRes, allVehicles, allCustomers] = await Promise.all([
      db
        .select()
        .from(reservations)
        .where(isNull(reservations.archivedAt))
        .orderBy(desc(reservations.createdAt)),
      db.select().from(vehicles),
      db.select().from(customers),
    ]);
    const vMap = new Map(allVehicles.map((v) => [v.id, v]));
    const cMap = new Map(allCustomers.map((c) => [c.id, c]));

    res.json({
      reservations: allRes.map((r) => ({
        ...r,
        vehicle: vMap.get(r.vehicleId) || null,
        customer: cMap.get(r.customerId) || null,
      })),
    });
  });

  router.post('/reservations', requireAuth, async (req: Request, res: Response) => {
    const idempotencyKey = getIdempotencyKey(req);
    if (idempotencyKey) {
      const [existingByKey] = await db
        .select()
        .from(reservations)
        .where(eq(reservations.idempotencyKey, idempotencyKey));
      if (existingByKey) {
        res.status(200).json({ reservation: existingByKey, deduplicated: true });
        return;
      }
    }

    const vehicleId = Number(req.body?.vehicleId);
    const customerId = Number(req.body?.customerId);
    const startDate = new Date(String(req.body?.startDate || ''));
    const endDate = new Date(String(req.body?.endDate || ''));
    const notes = String(req.body?.notes || '').trim();

    if (!vehicleId || !customerId || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      res.status(400).json({ error: 'Données de réservation invalides' });
      return;
    }

    try {
      const created = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM vehicles WHERE id = ${vehicleId} FOR UPDATE`);
        const [vehicle] = await tx
          .select()
          .from(vehicles)
          .where(and(eq(vehicles.id, vehicleId), isNull(vehicles.archivedAt)));
        if (!vehicle) throw new Error('VEHICLE_NOT_FOUND');
        if (vehicle.manualStatus === 'maintenance') throw new Error('VEHICLE_MAINTENANCE');

        const [customer] = await tx
          .select()
          .from(customers)
          .where(and(eq(customers.id, customerId), isNull(customers.archivedAt)));
        if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

        const activeMaint = await tx
          .select()
          .from(maintenanceRecords)
          .where(
            and(
              eq(maintenanceRecords.vehicleId, vehicleId),
              eq(maintenanceRecords.status, 'in_progress'),
              isNull(maintenanceRecords.archivedAt),
            ),
          );
        if (activeMaint.length > 0) throw new Error('VEHICLE_MAINTENANCE');

        const existingRes = await tx
          .select()
          .from(reservations)
          .where(and(eq(reservations.vehicleId, vehicleId), isNull(reservations.archivedAt)));
        if (
          existingRes.some(
            (r) =>
              (r.status === 'pending' || r.status === 'confirmed') &&
              datesOverlap(r.startDate, r.endDate, startDate, endDate),
          )
        ) {
          throw new Error('DATE_CONFLICT');
        }

        const existingContracts = await tx
          .select()
          .from(rentalContracts)
          .where(and(eq(rentalContracts.vehicleId, vehicleId), isNull(rentalContracts.archivedAt)));
        if (
          existingContracts.some(
            (c) =>
              isBlockingContractStatus(c.status) &&
              datesOverlap(c.startAt, c.endAt, startDate, endDate),
          )
        ) {
          throw new Error('DATE_CONFLICT');
        }

        const [publishedCond] = await tx
          .select()
          .from(rentalConditionsVersions)
          .where(eq(rentalConditionsVersions.isPublished, true))
          .orderBy(desc(rentalConditionsVersions.id));

        const days = calculateDurationDays(startDate, endDate);
        const totalAmountDzd = days * vehicle.dailyPriceDzd;
        const reservationCode = `RES-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

        const [row] = await tx
          .insert(reservations)
          .values({
            reservationCode,
            vehicleId,
            customerId,
            startDate,
            endDate,
            dailyPriceDzd: vehicle.dailyPriceDzd,
            totalAmountDzd,
            status: 'confirmed',
            source: 'admin',
            conditionsVersionId: publishedCond?.id ?? null,
            conditionsAcceptedAt: new Date(),
            notes,
            idempotencyKey,
          })
          .returning();
        return row;
      });

      await logAudit(req.auth, 'CREATE_RESERVATION', 'reservations', created.id);
      broadcastSyncEvent({ type: 'data_changed', entity: 'reservations', id: created.id });
      res.status(201).json({ reservation: created });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'VEHICLE_NOT_FOUND') {
        res.status(404).json({ error: 'Véhicule sélectionné introuvable' });
        return;
      }
      if (msg === 'CUSTOMER_NOT_FOUND') {
        res.status(404).json({ error: 'Client sélectionné introuvable' });
        return;
      }
      if (msg === 'DATE_CONFLICT') {
        res.status(409).json({ error: 'Conflit de dates : véhicule déjà réservé ou loué sur cette période' });
        return;
      }
      if (msg === 'VEHICLE_MAINTENANCE') {
        res.status(409).json({ error: 'Véhicule en maintenance : réservation impossible' });
        return;
      }
      sendPgOrUnexpectedError(res, err, 'Impossible de créer la réservation');
    }
  });

  router.put('/reservations/:id/status', requireAuth, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const status = String(req.body?.status || '');
    const expectedVersion = req.body?.version ? Number(req.body.version) : null;

    if (!['pending', 'confirmed', 'cancelled'].includes(status)) {
      res.status(400).json({ error: 'Statut invalide' });
      return;
    }

    const [existing] = await db
      .select()
      .from(reservations)
      .where(and(eq(reservations.id, id), isNull(reservations.archivedAt)));
    if (!existing) {
      res.status(404).json({ error: 'Réservation introuvable' });
      return;
    }
    if (expectedVersion !== null && existing.version !== expectedVersion) {
      res.status(409).json({
        error: 'Conflit de synchronisation : cette réservation a été modifiée sur un autre poste',
      });
      return;
    }

    const [updated] = await db
      .update(reservations)
      .set({ status, version: existing.version + 1, updatedAt: new Date() })
      .where(eq(reservations.id, id))
      .returning();

    await logAudit(req.auth, 'UPDATE_RESERVATION_STATUS', 'reservations', id, { status });
    broadcastSyncEvent({ type: 'data_changed', entity: 'reservations', id });
    res.json({ reservation: updated });
  });

  router.delete('/reservations/:id', requireAuth, async (req: Request, res: Response) => {
    const allowed = await canRoleDelete(req.auth?.role, 'reservations');
    if (!allowed) {
      res.status(403).json({ error: 'Permission insuffisante pour supprimer une réservation' });
      return;
    }

    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(reservations)
      .where(and(eq(reservations.id, id), isNull(reservations.archivedAt)));
    if (!existing) {
      res.status(404).json({ error: 'Réservation introuvable' });
      return;
    }

    const linkedContracts = await db
      .select()
      .from(rentalContracts)
      .where(eq(rentalContracts.reservationId, id));

    const hasActiveLinkedContract = linkedContracts.some((c) => !c.archivedAt);
    if (existing.status === 'converted' && hasActiveLinkedContract) {
      res.status(409).json({
        error: 'Suppression impossible : cette réservation est liée à un contrat de location.',
      });
      return;
    }

    if (linkedContracts.length > 0) {
      await db
        .update(reservations)
        .set({
          archivedAt: new Date(),
          archivedByRole: req.auth?.role || 'manager',
          version: existing.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, id));
      await logAudit(req.auth, 'ARCHIVE_RESERVATION', 'reservations', id, {
        reservationCode: existing.reservationCode,
      });
      broadcastSyncEvent({ type: 'data_changed', entity: 'reservations', id });
      res.json({ ok: true, mode: 'archived', message: 'Réservation archivée.' });
      return;
    }

    await db.delete(reservations).where(eq(reservations.id, id));
    await logAudit(req.auth, 'DELETE_RESERVATION', 'reservations', id, {
      reservationCode: existing.reservationCode,
    });
    broadcastSyncEvent({ type: 'data_changed', entity: 'reservations', id });
    res.json({ ok: true, mode: 'deleted', message: 'Réservation supprimée définitivement.' });
  });

  // ==========================================
  // RENTAL CONTRACTS (CONTRATS DE LOCATION)
  // ==========================================

  router.get('/contracts', requireAuth, async (_req: Request, res: Response) => {
    const [allContracts, allVehicles, allCustomers, allReturns, nextContractNumber] =
      await Promise.all([
        db
          .select()
          .from(rentalContracts)
          .where(isNull(rentalContracts.archivedAt))
          .orderBy(desc(rentalContracts.createdAt)),
        db.select().from(vehicles),
        db.select().from(customers),
        db.select().from(vehicleReturns).where(isNull(vehicleReturns.archivedAt)),
        peekNextContractNumber(),
      ]);
    const vMap = new Map(allVehicles.map((v) => [v.id, v]));
    const cMap = new Map(allCustomers.map((c) => [c.id, c]));
    const rMap = new Map(allReturns.map((r) => [r.contractId, r]));

    res.json({
      nextContractNumber,
      contracts: allContracts.map((ct) => {
        const cust = cMap.get(ct.customerId) || null;
        const drvCust = ct.driverCustomerId ? cMap.get(ct.driverCustomerId) || null : null;
        return {
          ...ct,
          digitalAccessToken: signContractAccessToken(ct.id, ct.contractNumber),
          vehicle: vMap.get(ct.vehicleId) || null,
          customer: cust
            ? {
                ...cust,
                licenceFrontUrl: cust.licenceFrontPath
                  ? `/api/files/licence/${cust.id}/front`
                  : null,
                licenceBackUrl: cust.licenceBackPath
                  ? `/api/files/licence/${cust.id}/back`
                  : null,
              }
            : null,
          driverCustomer: drvCust
            ? {
                ...drvCust,
                licenceFrontUrl: drvCust.licenceFrontPath
                  ? `/api/files/licence/${drvCust.id}/front`
                  : null,
                licenceBackUrl: drvCust.licenceBackPath
                  ? `/api/files/licence/${drvCust.id}/back`
                  : null,
              }
            : null,
          returnRecord: rMap.get(ct.id) || null,
        };
      }),
    });
  });

  router.get('/contracts/next-number', requireAuth, async (_req: Request, res: Response) => {
    try {
      const nextContractNumber = await peekNextContractNumber();
      res.json({ nextContractNumber });
    } catch (err) {
      sendPgOrUnexpectedError(res, err, 'Impossible de calculer le prochain numéro de contrat');
    }
  });

  router.post('/contracts', requireAuth, async (req: Request, res: Response) => {
    const idempotencyKey = getIdempotencyKey(req);
    if (idempotencyKey) {
      const [existingByKey] = await db
        .select()
        .from(rentalContracts)
        .where(eq(rentalContracts.idempotencyKey, idempotencyKey));
      if (existingByKey) {
        res.status(200).json({
          contract: {
            ...existingByKey,
            digitalAccessToken: signContractAccessToken(
              existingByKey.id,
              existingByKey.contractNumber,
            ),
          },
          deduplicated: true,
        });
        return;
      }
    }

    const vehicleId = Number(req.body?.vehicleId);
    const customerId = Number(req.body?.customerId);
    const driverCustomerId = req.body?.driverCustomerId ? Number(req.body.driverCustomerId) : null;
    const reservationId = req.body?.reservationId ? Number(req.body.reservationId) : null;
    const startAt = new Date(String(req.body?.startAt || ''));
    const endAt = new Date(String(req.body?.endAt || ''));
    const depositDzd = parseOptionalNonNegInt(req.body?.depositDzd, 0);
    const amountPaidDzd = parseOptionalNonNegInt(req.body?.amountPaidDzd, 0);
    const paymentMethod = String(req.body?.paymentMethod || 'cash');
    const departureFuelLevel = String(req.body?.departureFuelLevel || '4/4');
    const departureNotes = String(req.body?.departureNotes || '').trim();
    const pickupLocation = String(req.body?.pickupLocation || 'Blida').trim() || 'Blida';
    const returnLocation = String(req.body?.returnLocation || 'Blida').trim() || 'Blida';
    const maxMileageLimit = parseNullableNonNegInt(req.body?.maxMileageLimit);
    const extensionFromDate = String(req.body?.extensionFromDate || '').trim();
    const extensionUntilDate = String(req.body?.extensionUntilDate || '').trim();
    const extensionExitTime = String(req.body?.extensionExitTime || '').trim();
    const extensionEntryTime = String(req.body?.extensionEntryTime || '').trim();
    const earlyReturnDate = String(req.body?.earlyReturnDate || '').trim();
    const earlyReturnTime = String(req.body?.earlyReturnTime || '').trim();
    const earlyReturnLocation = String(req.body?.earlyReturnLocation || '').trim();
    const manualContractNumber =
      typeof req.body?.contractNumber === 'string' ? req.body.contractNumber.trim() : '';

    if (maxMileageLimit === 'invalid') {
      res.status(400).json({ error: 'Kilométrage maximal autorisé invalide' });
      return;
    }

    if (manualContractNumber.length > 64) {
      res.status(400).json({ error: 'Le numéro de contrat ne doit pas dépasser 64 caractères' });
      return;
    }

    if (
      !vehicleId ||
      !customerId ||
      Number.isNaN(startAt.getTime()) ||
      Number.isNaN(endAt.getTime()) ||
      endAt <= startAt
    ) {
      res.status(400).json({
        error: 'Client, véhicule et dates valides (retour postérieur au départ) obligatoires',
      });
      return;
    }
    if (depositDzd === null || amountPaidDzd === null) {
      res.status(400).json({ error: 'Caution ou montant versé invalide' });
      return;
    }

    try {
      const created = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM vehicles WHERE id = ${vehicleId} FOR UPDATE`);
        const [vehicle] = await tx
          .select()
          .from(vehicles)
          .where(and(eq(vehicles.id, vehicleId), isNull(vehicles.archivedAt)));
        if (!vehicle) throw new Error('VEHICLE_NOT_FOUND');
        if (vehicle.manualStatus === 'maintenance') throw new Error('VEHICLE_MAINTENANCE');

        const [customer] = await tx
          .select()
          .from(customers)
          .where(and(eq(customers.id, customerId), isNull(customers.archivedAt)));
        if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

        let driverCustomer: typeof customer | null = null;
        if (driverCustomerId) {
          const [dc] = await tx
            .select()
            .from(customers)
            .where(and(eq(customers.id, driverCustomerId), isNull(customers.archivedAt)));
          if (!dc) throw new Error('DRIVER_CUSTOMER_NOT_FOUND');
          driverCustomer = dc;
        }

        const activeMaint = await tx
          .select()
          .from(maintenanceRecords)
          .where(
            and(
              eq(maintenanceRecords.vehicleId, vehicleId),
              eq(maintenanceRecords.status, 'in_progress'),
              isNull(maintenanceRecords.archivedAt),
            ),
          );
        if (activeMaint.length > 0) throw new Error('VEHICLE_MAINTENANCE');

        const existingRes = await tx
          .select()
          .from(reservations)
          .where(and(eq(reservations.vehicleId, vehicleId), isNull(reservations.archivedAt)));
        if (
          existingRes.some(
            (r) =>
              r.id !== reservationId &&
              (r.status === 'pending' || r.status === 'confirmed') &&
              datesOverlap(r.startDate, r.endDate, startAt, endAt),
          )
        ) {
          throw new Error('DATE_CONFLICT');
        }

        const existingContracts = await tx
          .select()
          .from(rentalContracts)
          .where(and(eq(rentalContracts.vehicleId, vehicleId), isNull(rentalContracts.archivedAt)));
        if (
          existingContracts.some(
            (c) =>
              isBlockingContractStatus(c.status) &&
              datesOverlap(c.startAt, c.endAt, startAt, endAt),
          )
        ) {
          throw new Error('DATE_CONFLICT');
        }

        const [publishedCond] = await tx
          .select()
          .from(rentalConditionsVersions)
          .where(eq(rentalConditionsVersions.isPublished, true))
          .orderBy(desc(rentalConditionsVersions.id));

        const durationDays = calculateDurationDays(startAt, endAt);
        const dailyPriceDzd =
          req.body?.dailyPriceDzd !== undefined &&
          req.body?.dailyPriceDzd !== '' &&
          Number.isFinite(Number(req.body.dailyPriceDzd))
            ? Math.round(Number(req.body.dailyPriceDzd))
            : vehicle.dailyPriceDzd;
        const totalAmountDzd = durationDays * dailyPriceDzd;
        const departureMileage = parseOptionalNonNegInt(
          req.body?.departureMileage,
          vehicle.currentMileage,
        );
        if (departureMileage === null) {
          throw new Error('INVALID_DEPARTURE_MILEAGE');
        }
        const status = 'pending';
        let contractNumber: string;
        if (manualContractNumber) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${CONTRACT_SEQ_LOCK_ID})`);
          const [dup] = await tx
            .select({ id: rentalContracts.id })
            .from(rentalContracts)
            .where(sql`LOWER(TRIM(${rentalContracts.contractNumber})) = LOWER(${manualContractNumber})`);
          if (dup) throw new Error('DUPLICATE_CONTRACT_NUMBER');
          contractNumber = manualContractNumber;
          const m = /^TRANSCAR-(\d+)$/i.exec(manualContractNumber);
          if (m) {
            const manualSeq = Number(m[1]);
            const currentMax = await computeCurrentMaxContractSeq(tx as unknown as typeof db);
            if (Number.isFinite(manualSeq) && manualSeq > currentMax) {
              await tx
                .insert(systemSettings)
                .values({
                  key: CONTRACT_SEQ_KEY,
                  valueJson: { lastSeq: manualSeq },
                  updatedAt: new Date(),
                })
                .onConflictDoUpdate({
                  target: systemSettings.key,
                  set: { valueJson: { lastSeq: manualSeq }, updatedAt: new Date() },
                });
            }
          }
        } else {
          contractNumber = await allocateNextContractNumber(tx);
        }

        const driverDobFallback = driverCustomer
          ? [driverCustomer.dateOfBirth, driverCustomer.birthPlace].filter(Boolean).join(' · ')
          : '';

        const [ct] = await tx
          .insert(rentalContracts)
          .values({
            contractNumber,
            reservationId,
            vehicleId,
            customerId,
            driverCustomerId: driverCustomer?.id ?? null,
            driverName: String(req.body?.driverName || driverCustomer?.fullName || '').trim(),
            driverDob: String(req.body?.driverDob || driverDobFallback || '').trim(),
            driverIdNumber: String(req.body?.driverIdNumber || driverCustomer?.idNumber || '').trim(),
            driverLicenceNumber: String(
              req.body?.driverLicenceNumber || driverCustomer?.licenceNumber || '',
            ).trim(),
            driverCountry: String(req.body?.driverCountry || driverCustomer?.country || '').trim(),
            driverAddress: String(req.body?.driverAddress || driverCustomer?.address || '').trim(),
            driverPhone: String(req.body?.driverPhone || driverCustomer?.phone || '').trim(),
            startAt,
            endAt,
            durationDays,
            dailyPriceDzd,
            totalAmountDzd,
            depositDzd,
            amountPaidDzd,
            departureMileage,
            maxMileageLimit,
            departureFuelLevel,
            departureNotes,
            departureDamageJson: Array.isArray(req.body?.departureDamageJson)
              ? req.body.departureDamageJson
              : [],
            extensionFromDate,
            extensionUntilDate,
            extensionExitTime,
            extensionEntryTime,
            earlyReturnDate,
            earlyReturnTime,
            earlyReturnLocation,
            conditionsVersionId: publishedCond?.id ?? null,
            conditionsSnapshotJson: publishedCond?.articlesJson ?? null,
            status,
            pickupLocation,
            returnLocation,
            idempotencyKey,
          })
          .returning();

        if (reservationId) {
          await tx
            .update(reservations)
            .set({ status: 'converted', updatedAt: new Date() })
            .where(eq(reservations.id, reservationId));
        }

        if (amountPaidDzd > 0) {
          await tx.insert(financialTransactions).values({
            txType: 'rental_payment',
            paymentMethod,
            amountDzd: amountPaidDzd,
            contractId: ct.id,
            vehicleId,
            category: 'Location',
            description: `Paiement contrat ${ct.contractNumber}`,
            createdByRole: req.auth?.role || 'employee',
          });
        }
        if (depositDzd > 0) {
          await tx.insert(financialTransactions).values({
            txType: 'deposit_in',
            paymentMethod,
            amountDzd: depositDzd,
            contractId: ct.id,
            vehicleId,
            category: 'Caution',
            description: `Caution contrat ${ct.contractNumber}`,
            createdByRole: req.auth?.role || 'employee',
          });
        }

        return ct;
      });

      await logAudit(req.auth, 'CREATE_CONTRACT', 'rental_contracts', created.id, {
        contractNumber: created.contractNumber,
      });
      broadcastSyncEvent({ type: 'data_changed', entity: 'contracts', id: created.id });
      res.status(201).json({
        contract: {
          ...created,
          digitalAccessToken: signContractAccessToken(created.id, created.contractNumber),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'VEHICLE_NOT_FOUND') {
        res.status(404).json({ error: 'Véhicule introuvable' });
        return;
      }
      if (msg === 'CUSTOMER_NOT_FOUND') {
        res.status(404).json({ error: 'Client introuvable' });
        return;
      }
      if (msg === 'DRIVER_CUSTOMER_NOT_FOUND') {
        res.status(404).json({ error: 'Client conducteur introuvable' });
        return;
      }
      if (msg === 'INVALID_DEPARTURE_MILEAGE') {
        res.status(400).json({ error: 'Kilométrage de départ invalide' });
        return;
      }
      if (msg === 'DATE_CONFLICT') {
        res.status(409).json({ error: 'Ce véhicule est déjà réservé ou loué sur cette période' });
        return;
      }
      if (msg === 'VEHICLE_MAINTENANCE') {
        res.status(409).json({ error: 'Véhicule en maintenance : location impossible' });
        return;
      }
      if (msg === 'DUPLICATE_CONTRACT_NUMBER') {
        res.status(409).json({
          error: 'Ce numéro de contrat existe déjà. Veuillez saisir un numéro unique.',
        });
        return;
      }
      sendPgOrUnexpectedError(res, err, 'Erreur lors de la création du contrat');
    }
  });

  router.post('/contracts/:id/confirm', requireAuth, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: 'Identifiant contrat invalide' });
        return;
      }
      const updated = await db.transaction(async (tx) => {
        const [ct] = await tx
          .select()
          .from(rentalContracts)
          .where(and(eq(rentalContracts.id, id), isNull(rentalContracts.archivedAt)));
        if (!ct) throw new Error('CONTRACT_NOT_FOUND');
        if (isBlockingContractStatus(ct.status) || ct.status === 'completed' || ct.status === 'cancelled') {
          throw new Error('ALREADY_CONFIRMED');
        }

        await tx.execute(sql`SELECT id FROM vehicles WHERE id = ${ct.vehicleId} FOR UPDATE`);
        const [vehicle] = await tx
          .select()
          .from(vehicles)
          .where(and(eq(vehicles.id, ct.vehicleId), isNull(vehicles.archivedAt)));
        if (!vehicle) throw new Error('VEHICLE_NOT_FOUND');
        if (vehicle.manualStatus === 'maintenance') throw new Error('VEHICLE_MAINTENANCE');

        const activeMaint = await tx
          .select()
          .from(maintenanceRecords)
          .where(
            and(
              eq(maintenanceRecords.vehicleId, ct.vehicleId),
              eq(maintenanceRecords.status, 'in_progress'),
              isNull(maintenanceRecords.archivedAt),
            ),
          );
        if (activeMaint.length > 0) throw new Error('VEHICLE_MAINTENANCE');

        const existingRes = await tx
          .select()
          .from(reservations)
          .where(and(eq(reservations.vehicleId, ct.vehicleId), isNull(reservations.archivedAt)));
        if (
          existingRes.some(
            (r) =>
              r.id !== ct.reservationId &&
              (r.status === 'pending' || r.status === 'confirmed') &&
              datesOverlap(r.startDate, r.endDate, ct.startAt, ct.endAt),
          )
        ) {
          throw new Error('DATE_CONFLICT');
        }

        const existingContracts = await tx
          .select()
          .from(rentalContracts)
          .where(and(eq(rentalContracts.vehicleId, ct.vehicleId), isNull(rentalContracts.archivedAt)));
        if (
          existingContracts.some(
            (other) =>
              other.id !== ct.id &&
              isBlockingContractStatus(other.status) &&
              datesOverlap(other.startAt, other.endAt, ct.startAt, ct.endAt),
          )
        ) {
          throw new Error('DATE_CONFLICT');
        }

        const now = new Date();
        const [row] = await tx
          .update(rentalContracts)
          .set({
            status: 'confirmed',
            confirmedAt: now,
            version: ct.version + 1,
            updatedAt: now,
          })
          .where(eq(rentalContracts.id, id))
          .returning();
        return row;
      });

      await logAudit(req.auth, 'CONFIRM_CONTRACT', 'rental_contracts', id, {
        contractNumber: updated.contractNumber,
      });
      broadcastSyncEvent({ type: 'data_changed', entity: 'contracts', id });
      res.json({
        contract: {
          ...updated,
          digitalAccessToken: signContractAccessToken(updated.id, updated.contractNumber),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'CONTRACT_NOT_FOUND') {
        res.status(404).json({ error: 'Contrat introuvable' });
        return;
      }
      if (msg === 'ALREADY_CONFIRMED') {
        res.status(409).json({ error: 'Ce contrat est déjà confirmé ou clôturé' });
        return;
      }
      if (msg === 'VEHICLE_NOT_FOUND') {
        res.status(404).json({ error: 'Véhicule associé introuvable' });
        return;
      }
      if (msg === 'VEHICLE_MAINTENANCE') {
        res.status(409).json({ error: 'Véhicule en maintenance : confirmation impossible' });
        return;
      }
      if (msg === 'DATE_CONFLICT') {
        res.status(409).json({ error: 'Ce véhicule est déjà réservé ou loué sur cette période' });
        return;
      }
      sendPgOrUnexpectedError(res, err, 'Impossible de confirmer le contrat');
    }
  });

  router.post('/contracts/:id/activate', requireAuth, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const [ct] = await db
        .select()
        .from(rentalContracts)
        .where(and(eq(rentalContracts.id, id), isNull(rentalContracts.archivedAt)));
      if (!ct) {
        res.status(404).json({ error: 'Contrat introuvable' });
        return;
      }
      if (ct.status !== 'upcoming') {
        res.status(400).json({ error: 'Seul un contrat à venir peut être activé' });
        return;
      }
      const [updated] = await db
        .update(rentalContracts)
        .set({ status: 'active', version: ct.version + 1, updatedAt: new Date() })
        .where(eq(rentalContracts.id, id))
        .returning();
      broadcastSyncEvent({ type: 'data_changed', entity: 'contracts', id });
      res.json({
        contract: {
          ...updated,
          digitalAccessToken: signContractAccessToken(updated.id, updated.contractNumber),
        },
      });
    } catch (err) {
      sendPgOrUnexpectedError(res, err, 'Impossible d’activer le contrat');
    }
  });

  router.post('/contracts/:id/payment', requireAuth, async (req: Request, res: Response) => {
    try {
      const idempotencyKey = getIdempotencyKey(req);
      const id = Number(req.params.id);
      if (idempotencyKey) {
        const [existingTx] = await db
          .select()
          .from(financialTransactions)
          .where(eq(financialTransactions.idempotencyKey, idempotencyKey));
        if (existingTx) {
          const [ct] = await db.select().from(rentalContracts).where(eq(rentalContracts.id, id));
          res.status(200).json({
            contract: ct
              ? {
                  ...ct,
                  digitalAccessToken: signContractAccessToken(ct.id, ct.contractNumber),
                }
              : ct,
            deduplicated: true,
          });
          return;
        }
      }

      const amountDzd = Number(req.body?.amountDzd || 0);
      const paymentMethod = String(req.body?.paymentMethod || 'cash');
      if (!Number.isFinite(amountDzd) || amountDzd <= 0) {
        res.status(400).json({ error: 'Le montant du paiement doit être supérieur à 0 DZD' });
        return;
      }
      const [ct] = await db
        .select()
        .from(rentalContracts)
        .where(and(eq(rentalContracts.id, id), isNull(rentalContracts.archivedAt)));
      if (!ct) {
        res.status(404).json({ error: 'Contrat introuvable' });
        return;
      }
      const [updated] = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(rentalContracts)
          .set({
            amountPaidDzd: ct.amountPaidDzd + Math.round(amountDzd),
            version: ct.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(rentalContracts.id, id))
          .returning();

        await tx.insert(financialTransactions).values({
          txType: 'rental_payment',
          paymentMethod,
          amountDzd: Math.round(amountDzd),
          contractId: ct.id,
          vehicleId: ct.vehicleId,
          category: 'Location',
          description: `Complément paiement ${ct.contractNumber}`,
          createdByRole: req.auth?.role || 'employee',
          idempotencyKey,
        });
        return [row];
      });
      await logAudit(req.auth, 'ADD_CONTRACT_PAYMENT', 'rental_contracts', id, { amountDzd });
      broadcastSyncEvent({ type: 'data_changed', entity: 'contracts', id });
      res.json({
        contract: {
          ...updated,
          digitalAccessToken: signContractAccessToken(updated.id, updated.contractNumber),
        },
      });
    } catch (err) {
      sendPgOrUnexpectedError(res, err, 'Erreur lors de l’enregistrement du paiement');
    }
  });

  router.post('/contracts/:id/extend', requireAuth, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const newEndAt = new Date(String(req.body?.newEndAt || ''));
      if (Number.isNaN(newEndAt.getTime())) {
        res.status(400).json({ error: 'Nouvelle date de fin invalide' });
        return;
      }

      const [ct] = await db
        .select()
        .from(rentalContracts)
        .where(and(eq(rentalContracts.id, id), isNull(rentalContracts.archivedAt)));
      if (!ct || ct.status === 'completed' || ct.status === 'cancelled') {
        res.status(400).json({ error: 'Contrat non extensible' });
        return;
      }
      if (newEndAt <= ct.endAt) {
        res.status(400).json({ error: 'La date de prolongation doit être postérieure au retour prévu' });
        return;
      }

      const extraDays = calculateDurationDays(ct.endAt, newEndAt);
      const extraAmount = extraDays * ct.dailyPriceDzd;

      const [updated] = await db
        .update(rentalContracts)
        .set({
          extensionNumber: `EXT-${ct.contractNumber}`,
          extensionStartAt: ct.endAt,
          extensionEndAt: newEndAt,
          extensionDays: (ct.extensionDays || 0) + extraDays,
          endAt: newEndAt,
          durationDays: ct.durationDays + extraDays,
          totalAmountDzd: ct.totalAmountDzd + extraAmount,
          version: ct.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(rentalContracts.id, id))
        .returning();

      await logAudit(req.auth, 'EXTEND_CONTRACT', 'rental_contracts', id, { extraDays, extraAmount });
      broadcastSyncEvent({ type: 'data_changed', entity: 'contracts', id });
      res.json({
        contract: {
          ...updated,
          digitalAccessToken: signContractAccessToken(updated.id, updated.contractNumber),
        },
      });
    } catch (err) {
      sendPgOrUnexpectedError(res, err, 'Impossible de prolonger le contrat');
    }
  });

  router.put('/contracts/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const [existing] = await db
        .select()
        .from(rentalContracts)
        .where(and(eq(rentalContracts.id, id), isNull(rentalContracts.archivedAt)));
      if (!existing) {
        res.status(404).json({ error: 'Contrat introuvable' });
        return;
      }
      if (existing.status === 'cancelled') {
        res.status(400).json({ error: 'Un contrat annulé ne peut plus être modifié' });
        return;
      }
      if (existing.status === 'completed' && req.auth?.role !== 'manager') {
        res.status(403).json({ error: 'Seul le gérant peut modifier un contrat terminé' });
        return;
      }

      const expectedVersion =
        req.body?.version !== undefined && req.body?.version !== '' ? Number(req.body.version) : null;
      if (expectedVersion !== null && existing.version !== expectedVersion) {
        res.status(409).json({
          error: 'Conflit de synchronisation : ce contrat a été modifié sur un autre poste',
        });
        return;
      }

      const depositDzd =
        req.body?.depositDzd !== undefined
          ? parseOptionalNonNegInt(req.body.depositDzd, existing.depositDzd)
          : existing.depositDzd;
      const departureMileage =
        req.body?.departureMileage !== undefined
          ? parseOptionalNonNegInt(req.body.departureMileage, existing.departureMileage)
          : existing.departureMileage;
      const maxMileageLimitParsed =
        req.body?.maxMileageLimit !== undefined
          ? parseNullableNonNegInt(req.body.maxMileageLimit)
          : existing.maxMileageLimit;
      if (depositDzd === null || departureMileage === null || maxMileageLimitParsed === 'invalid') {
        res.status(400).json({ error: 'Caution ou kilométrage invalide' });
        return;
      }
      const nextMaxMileageLimit = maxMileageLimitParsed;

      const startAt = req.body?.startAt ? new Date(String(req.body.startAt)) : existing.startAt;
      const endAt = req.body?.endAt ? new Date(String(req.body.endAt)) : existing.endAt;
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
        res.status(400).json({ error: 'Dates de contrat invalides (retour postérieur au départ requis)' });
        return;
      }

      const durationDays = calculateDurationDays(startAt, endAt);
      const totalAmountDzd = durationDays * existing.dailyPriceDzd;

      const hasContractNumberField = req.body?.contractNumber !== undefined;
      const nextContractNumber = hasContractNumberField
        ? String(req.body.contractNumber ?? '').trim()
        : existing.contractNumber;
      if (hasContractNumberField && !nextContractNumber) {
        res.status(400).json({ error: 'Le numéro de contrat ne peut pas être vide.' });
        return;
      }
      if (nextContractNumber.length > 64) {
        res.status(400).json({ error: 'Le numéro de contrat ne doit pas dépasser 64 caractères.' });
        return;
      }

      const updated = await db.transaction(async (tx) => {
        if (nextContractNumber.toLowerCase() !== existing.contractNumber.trim().toLowerCase()) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${CONTRACT_SEQ_LOCK_ID})`);
          const [dup] = await tx
            .select({ id: rentalContracts.id })
            .from(rentalContracts)
            .where(
              and(
                ne(rentalContracts.id, id),
                sql`LOWER(TRIM(${rentalContracts.contractNumber})) = LOWER(${nextContractNumber})`,
              ),
            );
          if (dup) throw new Error('DUPLICATE_CONTRACT_NUMBER');
          const m = /^TRANSCAR-(\d+)$/i.exec(nextContractNumber);
          if (m) {
            const manualSeq = Number(m[1]);
            const currentMax = await computeCurrentMaxContractSeq(tx as unknown as typeof db);
            if (Number.isFinite(manualSeq) && manualSeq > currentMax) {
              await tx
                .insert(systemSettings)
                .values({
                  key: CONTRACT_SEQ_KEY,
                  valueJson: { lastSeq: manualSeq },
                  updatedAt: new Date(),
                })
                .onConflictDoUpdate({
                  target: systemSettings.key,
                  set: { valueJson: { lastSeq: manualSeq }, updatedAt: new Date() },
                });
            }
          }
        }

        let nextDriverCustomerId = existing.driverCustomerId ?? null;
        let driverCustomer: typeof customers.$inferSelect | null = null;
        if (req.body?.driverCustomerId !== undefined) {
          nextDriverCustomerId = req.body.driverCustomerId ? Number(req.body.driverCustomerId) : null;
          if (nextDriverCustomerId) {
            const [dc] = await tx
              .select()
              .from(customers)
              .where(and(eq(customers.id, nextDriverCustomerId), isNull(customers.archivedAt)));
            if (!dc) throw new Error('DRIVER_CUSTOMER_NOT_FOUND');
            driverCustomer = dc;
          }
        }
        const driverDobFallback = driverCustomer
          ? [driverCustomer.dateOfBirth, driverCustomer.birthPlace].filter(Boolean).join(' · ')
          : '';

        const [row] = await tx
          .update(rentalContracts)
          .set({
            contractNumber: nextContractNumber,
            driverCustomerId: nextDriverCustomerId,
            driverName:
              req.body?.driverName !== undefined
                ? String(req.body.driverName).trim()
                : driverCustomer
                  ? driverCustomer.fullName
                  : existing.driverName,
            driverDob:
              req.body?.driverDob !== undefined
                ? String(req.body.driverDob).trim()
                : driverCustomer
                  ? driverDobFallback
                  : existing.driverDob,
            driverIdNumber:
              req.body?.driverIdNumber !== undefined
                ? String(req.body.driverIdNumber).trim()
                : driverCustomer
                  ? driverCustomer.idNumber || ''
                  : existing.driverIdNumber,
            driverLicenceNumber:
              req.body?.driverLicenceNumber !== undefined
                ? String(req.body.driverLicenceNumber).trim()
                : driverCustomer
                  ? driverCustomer.licenceNumber || ''
                  : existing.driverLicenceNumber,
            driverCountry:
              req.body?.driverCountry !== undefined
                ? String(req.body.driverCountry).trim()
                : driverCustomer
                  ? driverCustomer.country || ''
                  : existing.driverCountry,
            driverAddress:
              req.body?.driverAddress !== undefined
                ? String(req.body.driverAddress).trim()
                : driverCustomer
                  ? driverCustomer.address || ''
                  : existing.driverAddress,
            driverPhone:
              req.body?.driverPhone !== undefined
                ? String(req.body.driverPhone).trim()
                : driverCustomer
                  ? driverCustomer.phone || ''
                  : existing.driverPhone,
            pickupLocation:
              req.body?.pickupLocation !== undefined
                ? String(req.body.pickupLocation).trim() || 'Blida'
                : existing.pickupLocation,
            returnLocation:
              req.body?.returnLocation !== undefined
                ? String(req.body.returnLocation).trim() || 'Blida'
                : existing.returnLocation,
            departureFuelLevel:
              req.body?.departureFuelLevel !== undefined
                ? String(req.body.departureFuelLevel)
                : existing.departureFuelLevel,
            departureNotes:
              req.body?.departureNotes !== undefined
                ? String(req.body.departureNotes).trim()
                : existing.departureNotes,
            departureMileage,
            maxMileageLimit: nextMaxMileageLimit,
            extensionFromDate:
              req.body?.extensionFromDate !== undefined
                ? String(req.body.extensionFromDate).trim()
                : existing.extensionFromDate,
            extensionUntilDate:
              req.body?.extensionUntilDate !== undefined
                ? String(req.body.extensionUntilDate).trim()
                : existing.extensionUntilDate,
            extensionExitTime:
              req.body?.extensionExitTime !== undefined
                ? String(req.body.extensionExitTime).trim()
                : existing.extensionExitTime,
            extensionEntryTime:
              req.body?.extensionEntryTime !== undefined
                ? String(req.body.extensionEntryTime).trim()
                : existing.extensionEntryTime,
            earlyReturnDate:
              req.body?.earlyReturnDate !== undefined
                ? String(req.body.earlyReturnDate).trim()
                : existing.earlyReturnDate,
            earlyReturnTime:
              req.body?.earlyReturnTime !== undefined
                ? String(req.body.earlyReturnTime).trim()
                : existing.earlyReturnTime,
            earlyReturnLocation:
              req.body?.earlyReturnLocation !== undefined
                ? String(req.body.earlyReturnLocation).trim()
                : existing.earlyReturnLocation,
            depositDzd,
            startAt,
            endAt,
            durationDays,
            totalAmountDzd,
            version: existing.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(rentalContracts.id, id))
          .returning();
        return row;
      });

      await logAudit(req.auth, 'UPDATE_CONTRACT', 'rental_contracts', id, {
        contractNumber: updated.contractNumber,
      });
      broadcastSyncEvent({ type: 'data_changed', entity: 'contracts', id });
      res.json({
        contract: {
          ...updated,
          digitalAccessToken: signContractAccessToken(updated.id, updated.contractNumber),
        },
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'DRIVER_CUSTOMER_NOT_FOUND') {
        res.status(404).json({ error: 'Client conducteur introuvable' });
        return;
      }
      if (err instanceof Error && err.message === 'DUPLICATE_CONTRACT_NUMBER') {
        res.status(409).json({
          error: 'Ce numéro de contrat existe déjà. Veuillez saisir un numéro unique.',
        });
        return;
      }
      sendPgOrUnexpectedError(res, err, 'Impossible de modifier le contrat');
    }
  });

  router.delete('/contracts/:id', requireAuth, requireManager, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(rentalContracts)
      .where(and(eq(rentalContracts.id, id), isNull(rentalContracts.archivedAt)));
    if (!existing) {
      res.status(404).json({ error: 'Contrat introuvable' });
      return;
    }

    if (isBlockingContractStatus(existing.status)) {
      res.status(409).json({
        error: 'Suppression impossible : ce contrat est confirmé en cours de location. Confirmez d’abord le retour véhicule.',
      });
      return;
    }

    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${CONTRACT_SEQ_LOCK_ID})`);
      if (existing.reservationId && existing.status !== 'completed') {
        await tx
          .update(reservations)
          .set({ status: 'confirmed', updatedAt: new Date() })
          .where(eq(reservations.id, existing.reservationId));
      }
      // Preserve shared financial transactions while unlinking contract reference before permanent delete
      await tx
        .update(financialTransactions)
        .set({ contractId: null })
        .where(eq(financialTransactions.contractId, id));
      // vehicleReturns cascades via onDelete: 'cascade'
      await tx.delete(rentalContracts).where(eq(rentalContracts.id, id));

      // Recompute sequence counter from remaining rows so deleted contract numbers can be reused
      const remainingMaxSeq = await computeMaxExistingContractSeq(tx as unknown as typeof db);
      await tx
        .insert(systemSettings)
        .values({
          key: CONTRACT_SEQ_KEY,
          valueJson: { lastSeq: remainingMaxSeq },
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { valueJson: { lastSeq: remainingMaxSeq }, updatedAt: new Date() },
        });
    });

    await logAudit(req.auth, 'DELETE_CONTRACT_PERMANENT', 'rental_contracts', id, {
      contractNumber: existing.contractNumber,
      previousStatus: existing.status,
    });
    broadcastSyncEvent({ type: 'data_changed', entity: 'contracts', id });
    res.json({
      ok: true,
      mode: 'deleted',
      message: 'Contrat supprimé définitivement.',
    });
  });

  // ==========================================
  // VEHICLE RETURNS (RETOURS & CALCULS OFFICIELS)
  // ==========================================

  router.get('/returns', requireAuth, async (_req: Request, res: Response) => {
    const [allReturns, allContracts, allVehicles, allCustomers] = await Promise.all([
      db
        .select()
        .from(vehicleReturns)
        .where(isNull(vehicleReturns.archivedAt))
        .orderBy(desc(vehicleReturns.createdAt)),
      db.select().from(rentalContracts),
      db.select().from(vehicles),
      db.select().from(customers),
    ]);
    const ctMap = new Map(allContracts.map((c) => [c.id, c]));
    const vMap = new Map(allVehicles.map((v) => [v.id, v]));
    const cuMap = new Map(allCustomers.map((c) => [c.id, c]));

    res.json({
      returns: allReturns.map((r) => {
        const ct = ctMap.get(r.contractId) || null;
        return {
          ...r,
          contract: ct,
          vehicle: vMap.get(r.vehicleId) || null,
          customer: ct ? cuMap.get(ct.customerId) || null : null,
        };
      }),
    });
  });

  router.post('/returns', requireAuth, async (req: Request, res: Response) => {
    const idempotencyKey = getIdempotencyKey(req);
    if (idempotencyKey) {
      const [existingByKey] = await db
        .select()
        .from(vehicleReturns)
        .where(eq(vehicleReturns.idempotencyKey, idempotencyKey));
      if (existingByKey) {
        res.status(200).json({ returnRecord: existingByKey, deduplicated: true });
        return;
      }
    }

    const contractId = Number(req.body?.contractId);
    const returnedAt = new Date(String(req.body?.returnedAt || new Date().toISOString()));
    const rawReturnMileage = req.body?.returnMileage;
    const hasExplicitMileage =
      rawReturnMileage !== undefined && rawReturnMileage !== null && rawReturnMileage !== '';
    const parsedReturnMileage = hasExplicitMileage ? Number(rawReturnMileage) : null;
    const conditionNotes = String(req.body?.conditionNotes || '').trim();
    const damageMarkers = Array.isArray(req.body?.damageMarkers) ? req.body.damageMarkers : [];
    const damageFeeDzd = Number(req.body?.damageFeeDzd || 0);
    const fuelCleaningFeeDzd = Number(req.body?.fuelCleaningFeeDzd || 0);
    const collectedAmountDzd = Number(req.body?.collectedAmountDzd || 0);
    const refundDepositDzd = Number(req.body?.refundDepositDzd || 0);
    const paymentMethod = String(req.body?.paymentMethod || 'cash');

    if (
      !contractId ||
      Number.isNaN(returnedAt.getTime()) ||
      (parsedReturnMileage !== null && Number.isNaN(parsedReturnMileage))
    ) {
      res.status(400).json({ error: 'Données de retour invalides' });
      return;
    }

    try {
      const created = await db.transaction(async (tx) => {
        const [ct] = await tx
          .select()
          .from(rentalContracts)
          .where(and(eq(rentalContracts.id, contractId), isNull(rentalContracts.archivedAt)));
        if (!ct) throw new Error('CONTRACT_NOT_FOUND');
        if (ct.status === 'completed') throw new Error('ALREADY_RETURNED');
        if (!isBlockingContractStatus(ct.status)) throw new Error('NOT_CONFIRMED');
        const returnMileage =
          parsedReturnMileage !== null ? Math.round(parsedReturnMileage) : ct.departureMileage;
        if (returnMileage < ct.departureMileage) throw new Error('INVALID_MILEAGE');

        const late = calculateLateReturnCharges(ct.endAt, returnedAt, ct.dailyPriceDzd);
        const distance = calculateDistanceCharges(
          ct.durationDays,
          ct.departureMileage,
          returnMileage,
        );
        const totalAdditionalFeeDzd =
          late.lateFeeDzd + distance.extraKmFeeDzd + damageFeeDzd + fuelCleaningFeeDzd;

        const [ret] = await tx
          .insert(vehicleReturns)
          .values({
            contractId: ct.id,
            vehicleId: ct.vehicleId,
            returnedAt,
            returnMileage,
            fuelLevel: String(req.body?.fuelLevel || ct.departureFuelLevel || '4/4'),
            conditionNotes,
            damageMarkersJson: damageMarkers,
            lateHours: late.lateHours,
            lateFeeDzd: late.lateFeeDzd,
            allowedKm: distance.allowedKm,
            drivenKm: distance.drivenKm,
            extraKm: distance.extraKm,
            extraKmFeeDzd: distance.extraKmFeeDzd,
            damageFeeDzd,
            fuelCleaningFeeDzd,
            totalAdditionalFeeDzd,
            idempotencyKey,
          })
          .returning();

        await tx
          .update(rentalContracts)
          .set({
            status: 'completed',
            completedAt: returnedAt,
            totalAmountDzd: ct.totalAmountDzd + totalAdditionalFeeDzd,
            amountPaidDzd: ct.amountPaidDzd + collectedAmountDzd,
            version: ct.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(rentalContracts.id, ct.id));

        await tx
          .update(vehicles)
          .set({
            currentMileage: returnMileage,
            updatedAt: new Date(),
          })
          .where(eq(vehicles.id, ct.vehicleId));

        if (collectedAmountDzd > 0) {
          await tx.insert(financialTransactions).values({
            txType: totalAdditionalFeeDzd > 0 ? 'late_extra_fee' : 'rental_payment',
            paymentMethod,
            amountDzd: collectedAmountDzd,
            contractId: ct.id,
            vehicleId: ct.vehicleId,
            category: 'Retour véhicule',
            description: `Règlement retour contrat ${ct.contractNumber}`,
            createdByRole: req.auth?.role || 'employee',
          });
        }

        if (refundDepositDzd > 0) {
          await tx.insert(financialTransactions).values({
            txType: 'deposit_refund',
            paymentMethod,
            amountDzd: refundDepositDzd,
            contractId: ct.id,
            vehicleId: ct.vehicleId,
            category: 'Restitution caution',
            description: `Restitution caution ${ct.contractNumber}`,
            createdByRole: req.auth?.role || 'employee',
          });
        }

        return ret;
      });

      await runExpiryAndMaintenanceChecks();
      await logAudit(req.auth, 'RECORD_RETURN', 'vehicle_returns', created.id, { contractId });
      broadcastSyncEvent({ type: 'data_changed', entity: 'returns', id: created.id });
      broadcastSyncEvent({ type: 'data_changed', entity: 'contracts', id: contractId });
      res.status(201).json({ returnRecord: created });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'CONTRACT_NOT_FOUND') {
        res.status(404).json({ error: 'Contrat introuvable' });
        return;
      }
      if (msg === 'INVALID_MILEAGE') {
        res.status(400).json({ error: 'Le kilométrage retour ne peut pas être inférieur au départ' });
        return;
      }
      if (msg === 'ALREADY_RETURNED') {
        res.status(409).json({ error: 'Ce contrat a déjà été clôturé' });
        return;
      }
      if (msg === 'NOT_CONFIRMED') {
        res.status(409).json({ error: 'Seul un contrat confirmé peut faire l’objet d’un retour véhicule' });
        return;
      }
      console.error('[Return error]', err);
      res.status(400).json({ error: 'Impossible d’enregistrer le retour' });
    }
  });

  // ==========================================
  // MAINTENANCE MANAGEMENT
  // ==========================================

  router.get('/maintenance', requireAuth, async (_req: Request, res: Response) => {
    const [allVehicles, allRecords] = await Promise.all([
      db.select().from(vehicles).where(isNull(vehicles.archivedAt)),
      db
        .select()
        .from(maintenanceRecords)
        .where(isNull(maintenanceRecords.archivedAt))
        .orderBy(desc(maintenanceRecords.createdAt)),
    ]);
    const vMap = new Map(allVehicles.map((v) => [v.id, v]));

    const alerts = allVehicles.flatMap((v) =>
      getMaintenanceAlertsForVehicle(
        v.currentMileage,
        allRecords.filter((r) => r.vehicleId === v.id),
      ).map((a) => ({
        ...a,
        vehicleId: v.id,
        vehicleName: `${v.brand} ${v.model}`,
        registrationNumber: v.registrationNumber,
      })),
    );

    res.json({
      records: allRecords.map((r) => ({
        ...r,
        vehicle: vMap.get(r.vehicleId) || null,
      })),
      alerts,
    });
  });

  router.post('/maintenance', requireAuth, async (req: Request, res: Response) => {
    try {
      const idempotencyKey = getIdempotencyKey(req);
      if (idempotencyKey) {
        const [existingByKey] = await db
          .select()
          .from(maintenanceRecords)
          .where(eq(maintenanceRecords.idempotencyKey, idempotencyKey));
        if (existingByKey) {
          res.status(200).json({ record: existingByKey, deduplicated: true });
          return;
        }
      }

      const vehicleId = Number(req.body?.vehicleId);
      const maintenanceType = String(req.body?.maintenanceType || 'graissage');
      const maintenanceDate = String(req.body?.maintenanceDate || getAlgiersTodayIso());
      const costDzd = parseOptionalNonNegInt(req.body?.costDzd, 0);
      const notes = String(req.body?.notes || '').trim();
      const markCompletedImmediately =
        req.body?.markCompletedImmediately === true ||
        req.body?.markCompletedImmediately === 'true';

      if (!vehicleId || costDzd === null) {
        res.status(400).json({ error: 'Véhicule ou coût invalide' });
        return;
      }

      const [vehicle] = await db
        .select()
        .from(vehicles)
        .where(and(eq(vehicles.id, vehicleId), isNull(vehicles.archivedAt)));
      if (!vehicle) {
        res.status(404).json({ error: 'Véhicule introuvable' });
        return;
      }

      const mileageAtService = parseOptionalNonNegInt(
        req.body?.mileageAtService,
        vehicle.currentMileage,
      );
      if (mileageAtService === null) {
        res.status(400).json({ error: 'Kilométrage invalide' });
        return;
      }
      const interval =
        maintenanceType in MAINTENANCE_INTERVALS
          ? MAINTENANCE_INTERVALS[maintenanceType as keyof typeof MAINTENANCE_INTERVALS].intervalKm
          : Number(req.body?.customIntervalKm || 10000);
      const nextServiceMileage =
        parseOptionalNonNegInt(req.body?.nextServiceMileage, mileageAtService + interval) ??
        mileageAtService + interval;

      const created = await db.transaction(async (tx) => {
        const [rec] = await tx
          .insert(maintenanceRecords)
          .values({
            vehicleId,
            maintenanceType,
            maintenanceDate,
            mileageAtService,
            nextServiceMileage,
            costDzd,
            notes,
            status: markCompletedImmediately ? 'completed' : 'in_progress',
            completedAt: markCompletedImmediately ? new Date() : null,
            idempotencyKey,
          })
          .returning();

        await tx
          .update(vehicles)
          .set({
            currentMileage: Math.max(vehicle.currentMileage, mileageAtService),
            manualStatus: markCompletedImmediately ? 'available' : 'maintenance',
            updatedAt: new Date(),
          })
          .where(eq(vehicles.id, vehicleId));

        if (markCompletedImmediately && costDzd > 0) {
          await tx.insert(financialTransactions).values({
            txType: 'expense',
            paymentMethod: 'cash',
            amountDzd: costDzd,
            vehicleId,
            maintenanceId: rec.id,
            category: 'Maintenance',
            description: `Entretien ${maintenanceType} · ${vehicle.registrationNumber}`,
            createdByRole: req.auth?.role || 'employee',
          });
        }

        return rec;
      });

      await logAudit(req.auth, 'CREATE_MAINTENANCE', 'maintenance_records', created.id, {
        vehicleId,
        maintenanceType,
      });
      broadcastSyncEvent({ type: 'data_changed', entity: 'maintenance', id: created.id });
      res.status(201).json({ record: created });
    } catch (err) {
      sendPgOrUnexpectedError(res, err, 'Impossible d’enregistrer la fiche entretien');
    }
  });

  router.post('/maintenance/:id/complete', requireAuth, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const [rec] = await db
        .select()
        .from(maintenanceRecords)
        .where(and(eq(maintenanceRecords.id, id), isNull(maintenanceRecords.archivedAt)));
      if (!rec) {
        res.status(404).json({ error: 'Intervention introuvable' });
        return;
      }

      const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, rec.vehicleId));
      const costDzd = parseOptionalNonNegInt(req.body?.costDzd, rec.costDzd);
      const finalMileage = parseOptionalNonNegInt(req.body?.mileageAtService, rec.mileageAtService);
      if (costDzd === null || finalMileage === null) {
        res.status(400).json({ error: 'Kilométrage ou coût final invalide' });
        return;
      }

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(maintenanceRecords)
          .set({
            status: 'completed',
            costDzd,
            mileageAtService: finalMileage,
            notes: req.body?.notes ? String(req.body.notes) : rec.notes,
            completedAt: new Date(),
          })
          .where(eq(maintenanceRecords.id, id))
          .returning();

        const otherOpen = await tx
          .select()
          .from(maintenanceRecords)
          .where(
            and(
              eq(maintenanceRecords.vehicleId, rec.vehicleId),
              eq(maintenanceRecords.status, 'in_progress'),
              isNull(maintenanceRecords.archivedAt),
            ),
          );

        await tx
          .update(vehicles)
          .set({
            currentMileage: Math.max(vehicle?.currentMileage || 0, finalMileage),
            manualStatus: otherOpen.length > 0 ? 'maintenance' : 'available',
            updatedAt: new Date(),
          })
          .where(eq(vehicles.id, rec.vehicleId));

        if (costDzd > 0) {
          await tx.insert(financialTransactions).values({
            txType: 'expense',
            paymentMethod: 'cash',
            amountDzd: costDzd,
            vehicleId: rec.vehicleId,
            maintenanceId: rec.id,
            category: 'Maintenance',
            description: `Entretien ${rec.maintenanceType} · ${vehicle?.registrationNumber || rec.vehicleId}`,
            createdByRole: req.auth?.role || 'employee',
          });
        }

        return row;
      });

      await logAudit(req.auth, 'COMPLETE_MAINTENANCE', 'maintenance_records', id);
      broadcastSyncEvent({ type: 'data_changed', entity: 'maintenance', id });
      res.json({ record: updated });
    } catch (err) {
      sendPgOrUnexpectedError(res, err, 'Impossible de clôturer la maintenance');
    }
  });

  router.delete('/maintenance/:id', requireAuth, async (req: Request, res: Response) => {
    const allowed = await canRoleDelete(req.auth?.role, 'maintenance');
    if (!allowed) {
      res.status(403).json({ error: 'Permission insuffisante pour supprimer un entretien' });
      return;
    }

    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(maintenanceRecords)
      .where(and(eq(maintenanceRecords.id, id), isNull(maintenanceRecords.archivedAt)));
    if (!existing) {
      res.status(404).json({ error: 'Intervention introuvable' });
      return;
    }

    const linkedTxs = await db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.maintenanceId, id));

    const mode = await db.transaction(async (tx) => {
      let resultMode: 'archived' | 'deleted' = 'deleted';
      if (linkedTxs.length > 0) {
        await tx
          .update(maintenanceRecords)
          .set({
            archivedAt: new Date(),
            archivedByRole: req.auth?.role || 'manager',
          })
          .where(eq(maintenanceRecords.id, id));
        resultMode = 'archived';
      } else {
        await tx.delete(maintenanceRecords).where(eq(maintenanceRecords.id, id));
      }

      const otherOpen = await tx
        .select()
        .from(maintenanceRecords)
        .where(
          and(
            eq(maintenanceRecords.vehicleId, existing.vehicleId),
            eq(maintenanceRecords.status, 'in_progress'),
            isNull(maintenanceRecords.archivedAt),
          ),
        );

      await tx
        .update(vehicles)
        .set({
          manualStatus: otherOpen.length > 0 ? 'maintenance' : 'available',
          updatedAt: new Date(),
        })
        .where(eq(vehicles.id, existing.vehicleId));

      return resultMode;
    });

    await logAudit(req.auth, mode === 'archived' ? 'ARCHIVE_MAINTENANCE' : 'DELETE_MAINTENANCE', 'maintenance_records', id);
    broadcastSyncEvent({ type: 'data_changed', entity: 'maintenance', id });
    res.json({
      ok: true,
      mode,
      message:
        mode === 'archived'
          ? 'Fiche entretien archivée (dépense financière conservée).'
          : 'Fiche entretien supprimée définitivement.',
    });
  });

  // ==========================================
  // RENTAL CONDITIONS (CONDITIONS DE LOCATION)
  // ==========================================

  router.get('/conditions', requireAuth, async (_req: Request, res: Response) => {
    const versions = await db
      .select()
      .from(rentalConditionsVersions)
      .orderBy(desc(rentalConditionsVersions.id));
    const resCounts = await db.select().from(reservations);

    res.json({
      versions: versions.map((v) => ({
        ...v,
        acceptancesCount: resCounts.filter((r) => r.conditionsVersionId === v.id).length,
      })),
    });
  });

  router.post('/conditions', requireAuth, requireManager, async (req: Request, res: Response) => {
    try {
      const versionNumber = String(req.body?.versionNumber || '').trim();
      const articles = req.body?.articles as RentalConditionArticle[] | undefined;
      if (!versionNumber || !Array.isArray(articles) || articles.length < 10) {
        res.status(400).json({
          error: 'Numéro de version et les 10 articles officiels obligatoires',
        });
        return;
      }

      const [existingVer] = await db
        .select()
        .from(rentalConditionsVersions)
        .where(eq(rentalConditionsVersions.versionNumber, versionNumber));
      if (existingVer) {
        res.status(409).json({
          error: `La version ${versionNumber} existe déjà. Veuillez choisir un nouveau numéro.`,
        });
        return;
      }

      const created = await db.transaction(async (tx) => {
        await tx.update(rentalConditionsVersions).set({ isPublished: false });
        const [row] = await tx
          .insert(rentalConditionsVersions)
          .values({
            versionNumber,
            isPublished: true,
            articlesJson: articles,
            createdByRole: req.auth?.role || 'manager',
          })
          .returning();
        return row;
      });

      await logAudit(req.auth, 'PUBLISH_CONDITIONS', 'rental_conditions_versions', created.id, {
        versionNumber,
      });
      broadcastSyncEvent({ type: 'data_changed', entity: 'conditions', id: created.id });
      res.status(201).json({ version: created });
    } catch (err) {
      sendPgOrUnexpectedError(res, err, 'Impossible de publier les conditions');
    }
  });

  // ==========================================
  // NOTIFICATIONS CENTER
  // ==========================================

  router.get('/notifications', requireAuth, async (req: Request, res: Response) => {
    const all = await db
      .select()
      .from(notifications)
      .orderBy(desc(notifications.createdAt));

    const filtered =
      req.auth?.role === 'manager' ? all : all.filter((n) => n.audience === 'all');

    res.json({ notifications: filtered });
  });

  router.post('/notifications/:id/read', requireAuth, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
    broadcastSyncEvent({ type: 'notification', entity: 'notification', id });
    res.json({ ok: true });
  });

  router.post('/notifications/read-all', requireAuth, async (req: Request, res: Response) => {
    if (req.auth?.role === 'manager') {
      await db.update(notifications).set({ isRead: true });
    } else {
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.audience, 'all'));
    }
    broadcastSyncEvent({ type: 'notification', entity: 'notification' });
    res.json({ ok: true });
  });

  router.post('/notifications/run-checks', requireAuth, async (_req: Request, res: Response) => {
    await runExpiryAndMaintenanceChecks();
    res.json({ ok: true });
  });

  router.delete('/notifications/:id', requireAuth, async (req: Request, res: Response) => {
    const allowed = await canRoleDelete(req.auth?.role, 'notifications');
    if (!allowed) {
      res.status(403).json({ error: 'Permission insuffisante pour supprimer les notifications' });
      return;
    }
    const id = Number(req.params.id);
    const [existing] = await db.select().from(notifications).where(eq(notifications.id, id));
    if (!existing) {
      res.status(404).json({ error: 'Notification introuvable' });
      return;
    }
    if (req.auth?.role !== 'manager' && existing.audience === 'manager') {
      res.status(403).json({ error: 'Accès refusé' });
      return;
    }
    await db.delete(notifications).where(eq(notifications.id, id));
    broadcastSyncEvent({ type: 'notification', entity: 'notification', id });
    res.json({ ok: true });
  });

  router.delete('/notifications', requireAuth, async (req: Request, res: Response) => {
    const allowed = await canRoleDelete(req.auth?.role, 'notifications');
    if (!allowed) {
      res.status(403).json({ error: 'Permission insuffisante pour effacer les notifications' });
      return;
    }
    if (req.auth?.role === 'manager') {
      await db.delete(notifications);
    } else {
      await db.delete(notifications).where(eq(notifications.audience, 'all'));
    }
    await logAudit(req.auth, 'CLEAR_NOTIFICATIONS', 'notifications', 'all');
    broadcastSyncEvent({ type: 'notification', entity: 'notification' });
    res.json({ ok: true });
  });

  // ==========================================
  // MANAGER-ONLY: CASH REGISTER & FINANCES
  // ==========================================

  router.get('/finance/transactions', requireAuth, requireManager, async (_req: Request, res: Response) => {
    const [txs, allVehicles, allContracts] = await Promise.all([
      db
        .select()
        .from(financialTransactions)
        .where(isNull(financialTransactions.archivedAt))
        .orderBy(desc(financialTransactions.txDate)),
      db.select().from(vehicles),
      db.select().from(rentalContracts),
    ]);
    const vMap = new Map(allVehicles.map((v) => [v.id, v]));
    const ctMap = new Map(allContracts.map((c) => [c.id, c]));

    const mapped = txs.map((tx) => ({
      ...tx,
      vehicle: tx.vehicleId ? vMap.get(tx.vehicleId) || null : null,
      contract: tx.contractId ? ctMap.get(tx.contractId) || null : null,
    }));

    res.json({
      summary: computeCashSummary(txs),
      transactions: mapped,
      withdrawals: mapped.filter((t) => t.txType === 'cash_withdrawal'),
    });
  });

  router.post('/finance/transactions', requireAuth, requireManager, async (req: Request, res: Response) => {
    try {
      const idempotencyKey = getIdempotencyKey(req);
      if (idempotencyKey) {
        const [existingByKey] = await db
          .select()
          .from(financialTransactions)
          .where(eq(financialTransactions.idempotencyKey, idempotencyKey));
        if (existingByKey) {
          res.status(200).json({ transaction: existingByKey, deduplicated: true });
          return;
        }
      }

      const txType = String(req.body?.txType || 'expense');
      const paymentMethod = String(req.body?.paymentMethod || 'cash');
      const amountDzd = Number(req.body?.amountDzd || 0);
      const category = String(req.body?.category || 'Général').trim() || 'Général';
      const description = String(req.body?.description || '').trim();
      const rawVehicleId = req.body?.vehicleId ? Number(req.body.vehicleId) : null;
      const rawContractId = req.body?.contractId ? Number(req.body.contractId) : null;

      if (
        !['rental_payment', 'deposit_in', 'deposit_refund', 'expense', 'refund', 'late_extra_fee'].includes(
          txType,
        ) ||
        !Number.isFinite(amountDzd) ||
        amountDzd <= 0
      ) {
        res.status(400).json({ error: 'Type d’opération ou montant invalide (> 0 DZD requis)' });
        return;
      }

      let vehicleId: number | null = null;
      if (rawVehicleId && Number.isInteger(rawVehicleId) && rawVehicleId > 0) {
        const [v] = await db.select().from(vehicles).where(eq(vehicles.id, rawVehicleId));
        if (v) vehicleId = v.id;
      }

      let contractId: number | null = null;
      if (rawContractId && Number.isInteger(rawContractId) && rawContractId > 0) {
        const [ct] = await db.select().from(rentalContracts).where(eq(rentalContracts.id, rawContractId));
        if (ct) contractId = ct.id;
      }

      const [created] = await db
        .insert(financialTransactions)
        .values({
          txType,
          paymentMethod,
          amountDzd: Math.round(amountDzd),
          category,
          description,
          vehicleId,
          contractId,
          createdByRole: req.auth?.role || 'manager',
          idempotencyKey,
        })
        .returning();

      await logAudit(req.auth, 'CREATE_FINANCIAL_TX', 'financial_transactions', created.id, {
        txType,
        amountDzd: created.amountDzd,
      });
      broadcastSyncEvent({ type: 'data_changed', entity: 'finance', id: created.id });
      res.status(201).json({ transaction: created });
    } catch (err) {
      sendPgOrUnexpectedError(res, err, 'Impossible d’enregistrer l’opération financière');
    }
  });

  router.post('/finance/withdrawals', requireAuth, requireManager, async (req: Request, res: Response) => {
    const idempotencyKey = getIdempotencyKey(req);
    if (idempotencyKey) {
      const [existingByKey] = await db
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.idempotencyKey, idempotencyKey));
      if (existingByKey) {
        const allActive = await db
          .select()
          .from(financialTransactions)
          .where(isNull(financialTransactions.archivedAt));
        res.status(200).json({
          transaction: existingByKey,
          summary: computeCashSummary(allActive),
          deduplicated: true,
        });
        return;
      }
    }

    const resetToZero = req.body?.resetToZero === true || req.body?.resetToZero === 'true';
    const requestedAmount = Number(req.body?.amountDzd || 0);
    const notes = String(req.body?.notes || '').trim();
    const paymentMethod = String(req.body?.paymentMethod || 'cash');

    try {
      const result = await db.transaction(async (tx) => {
        // Prevent concurrent duplicate withdrawals using advisory transaction lock
        await tx.execute(sql`SELECT pg_advisory_xact_lock(948271)`);
        const allActive = await tx
          .select()
          .from(financialTransactions)
          .where(isNull(financialTransactions.archivedAt));
        const currentSummary = computeCashSummary(allActive);

        if (currentSummary.cashBalance <= 0) {
          throw new Error('EMPTY_CASH_REGISTER');
        }

        const withdrawAmount = resetToZero
          ? currentSummary.cashBalance
          : Math.round(requestedAmount);

        if (!Number.isFinite(withdrawAmount) || withdrawAmount <= 0) {
          throw new Error('INVALID_AMOUNT');
        }
        if (withdrawAmount > currentSummary.cashBalance) {
          throw new Error('EXCEEDS_BALANCE');
        }

        const [created] = await tx
          .insert(financialTransactions)
          .values({
            txType: 'cash_withdrawal',
            paymentMethod,
            amountDzd: withdrawAmount,
            category: resetToZero ? 'Remise à zéro caisse' : 'Retrait gérant',
            description:
              notes ||
              (resetToZero
                ? `Retrait intégral et remise à zéro de la caisse (${withdrawAmount.toLocaleString('fr-FR')} DZD)`
                : `Retrait d’espèces par le gérant`),
            createdByRole: req.auth?.role || 'manager',
            idempotencyKey,
          })
          .returning();

        const updatedSummary = computeCashSummary([...allActive, created]);
        return { created, updatedSummary };
      });

      await logAudit(req.auth, 'CASH_WITHDRAWAL', 'financial_transactions', result.created.id, {
        amountDzd: result.created.amountDzd,
        resetToZero,
        remainingCashBalance: result.updatedSummary.cashBalance,
      });
      broadcastSyncEvent({ type: 'data_changed', entity: 'finance', id: result.created.id });
      res.status(201).json({
        transaction: result.created,
        summary: result.updatedSummary,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'EMPTY_CASH_REGISTER') {
        res.status(400).json({ error: 'Le solde disponible en caisse est déjà à 0 DZD.' });
        return;
      }
      if (msg === 'EXCEEDS_BALANCE') {
        res.status(400).json({ error: 'Le montant du retrait dépasse le solde disponible en caisse.' });
        return;
      }
      if (msg === 'INVALID_AMOUNT') {
        res.status(400).json({ error: 'Veuillez saisir un montant de retrait valide.' });
        return;
      }
      console.error('[Cash withdrawal error]', err);
      res.status(400).json({ error: 'Impossible d’enregistrer le retrait de caisse.' });
    }
  });

  router.delete('/finance/transactions/:id', requireAuth, requireManager, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(financialTransactions)
      .where(and(eq(financialTransactions.id, id), isNull(financialTransactions.archivedAt)));
    if (!existing) {
      res.status(404).json({ error: 'Transaction introuvable' });
      return;
    }

    await db
      .update(financialTransactions)
      .set({
        archivedAt: new Date(),
        archivedByRole: req.auth?.role || 'manager',
      })
      .where(eq(financialTransactions.id, id));

    await logAudit(req.auth, 'ARCHIVE_FINANCIAL_TX', 'financial_transactions', id, {
      txType: existing.txType,
      amountDzd: existing.amountDzd,
    });
    broadcastSyncEvent({ type: 'data_changed', entity: 'finance', id });
    res.json({
      ok: true,
      mode: 'archived',
      message: 'Écriture archivée avec traçabilité comptable.',
    });
  });

  // ==========================================
  // MANAGER-ONLY: FINANCIAL REPORTS
  // ==========================================

  router.get('/reports/financial', requireAuth, requireManager, async (req: Request, res: Response) => {
    const period = String(req.query.period || 'monthly');
    const now = new Date();
    const todayIso = getAlgiersTodayIso();
    let startBoundary = new Date(`${todayIso}T00:00:00Z`);

    if (period === 'weekly') {
      startBoundary = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'monthly') {
      startBoundary = new Date(`${todayIso.slice(0, 7)}-01T00:00:00Z`);
    } else if (period === 'annual') {
      startBoundary = new Date(`${todayIso.slice(0, 4)}-01-01T00:00:00Z`);
    }

    const [txs, allVehicles, allContracts, allMaint] = await Promise.all([
      db.select().from(financialTransactions).where(isNull(financialTransactions.archivedAt)),
      db.select().from(vehicles).where(isNull(vehicles.archivedAt)),
      db.select().from(rentalContracts).where(isNull(rentalContracts.archivedAt)),
      db.select().from(maintenanceRecords).where(isNull(maintenanceRecords.archivedAt)),
    ]);

    const periodTxs = txs.filter((tx) => tx.txDate.getTime() >= startBoundary.getTime());

    let revenue = 0;
    let expenses = 0;
    let refunds = 0;
    for (const tx of periodTxs) {
      if (tx.txType === 'rental_payment' || tx.txType === 'late_extra_fee') {
        revenue += tx.amountDzd;
      } else if (tx.txType === 'expense') {
        expenses += tx.amountDzd;
      } else if (tx.txType === 'refund') {
        refunds += tx.amountDzd;
      }
    }

    const outstandingPayments = allContracts
      .filter((c) => c.status !== 'cancelled')
      .reduce((acc, c) => acc + Math.max(0, c.totalAmountDzd - c.amountPaidDzd), 0);

    const vehiclePerformance = allVehicles.map((v) => {
      const vContracts = allContracts.filter(
        (c) =>
          c.vehicleId === v.id &&
          c.status !== 'cancelled' &&
          c.startAt.getTime() >= startBoundary.getTime(),
      );
      const rentedDays = vContracts.reduce((sum, c) => sum + c.durationDays, 0);
      const vRevenue = periodTxs
        .filter(
          (tx) =>
            tx.vehicleId === v.id &&
            (tx.txType === 'rental_payment' || tx.txType === 'late_extra_fee'),
        )
        .reduce((sum, tx) => sum + tx.amountDzd, 0);
      const vExpenses = periodTxs
        .filter((tx) => tx.vehicleId === v.id && tx.txType === 'expense')
        .reduce((sum, tx) => sum + tx.amountDzd, 0);
      const vMaintCount = allMaint.filter((m) => m.vehicleId === v.id).length;

      return {
        vehicleId: v.id,
        brand: v.brand,
        model: v.model,
        registrationNumber: v.registrationNumber,
        rentedDays,
        revenueDzd: vRevenue,
        maintenanceExpenseDzd: vExpenses,
        netProfitDzd: vRevenue - vExpenses,
        maintenanceCount: vMaintCount,
      };
    });

    res.json({
      period,
      summary: {
        revenueDzd: revenue,
        expensesDzd: expenses + refunds,
        netProfitDzd: revenue - expenses - refunds,
        outstandingPaymentsDzd: outstandingPayments,
      },
      vehiclePerformance,
      transactions: periodTxs,
    });
  });

  // ==========================================
  // MANAGER-ONLY: BACKUPS, RESTORE & AUDIT
  // ==========================================

  router.get('/backups', requireAuth, requireManager, async (_req: Request, res: Response) => {
    const records = await db
      .select()
      .from(backupRecords)
      .orderBy(desc(backupRecords.createdAt));
    res.json({ backups: records });
  });

  router.post('/backups', requireAuth, requireManager, async (req: Request, res: Response) => {
    const created = await createFullBackupArchive(req.auth?.role || 'manager');
    await logAudit(req.auth, 'CREATE_BACKUP', 'backup_records', created.id, {
      filename: created.filename,
    });
    res.status(201).json({ backup: created });
  });

  router.get(
    '/backups/:id/download',
    requireAuth,
    requireManager,
    async (req: Request, res: Response) => {
      const id = Number(req.params.id);
      const [rec] = await db.select().from(backupRecords).where(eq(backupRecords.id, id));
      if (!rec) {
        res.status(404).json({ error: 'Sauvegarde introuvable' });
        return;
      }
      const absPath = path.resolve(BACKUPS_DIR, rec.filename);
      if (!absPath.startsWith(BACKUPS_DIR + path.sep) || !fs.existsSync(absPath)) {
        res.status(404).json({ error: 'Fichier de sauvegarde introuvable' });
        return;
      }
      res.download(absPath, rec.filename);
    },
  );

  router.post(
    '/backups/restore',
    requireAuth,
    requireManager,
    upload.single('archive'),
    async (req: Request, res: Response) => {
      if (!req.file) {
        res.status(400).json({ error: 'Fichier archive (.zip) obligatoire' });
        return;
      }
      try {
        const zip = await JSZip.loadAsync(req.file.buffer);
        const dbJsonFile = zip.file('database.json');
        if (!dbJsonFile) {
          res.status(400).json({ error: 'Archive invalide : database.json manquant' });
          return;
        }
        const raw = await dbJsonFile.async('string');
        const parsed = JSON.parse(raw);
        if (!parsed?.data) {
          res.status(400).json({ error: 'Format de sauvegarde invalide' });
          return;
        }

        // Restore files
        for (const [entryPath, zipEntry] of Object.entries(zip.files)) {
          if (entryPath.startsWith('uploads/') && !zipEntry.dir) {
            const rel = entryPath.slice('uploads/'.length);
            const target = path.resolve(UPLOADS_ROOT, rel);
            if (target.startsWith(UPLOADS_ROOT + path.sep)) {
              fs.mkdirSync(path.dirname(target), { recursive: true });
              const content = await zipEntry.async('nodebuffer');
              fs.writeFileSync(target, content);
            }
          }
        }

        await db.transaction(async (tx) => {
          await tx.delete(financialTransactions);
          await tx.delete(vehicleReturns);
          await tx.delete(rentalContracts);
          await tx.delete(reservations);
          await tx.delete(vehicleDocuments);
          await tx.delete(maintenanceRecords);
          await tx.delete(notifications);
          await tx.delete(customers);
          await tx.delete(vehicles);

          const d = parsed.data;
          if (Array.isArray(d.vehicles) && d.vehicles.length) {
            await tx.insert(vehicles).values(
              d.vehicles.map((v: Record<string, unknown>) => ({
                ...v,
                createdAt: new Date(String(v.createdAt)),
                updatedAt: new Date(String(v.updatedAt)),
              })),
            );
          }
          if (Array.isArray(d.customers) && d.customers.length) {
            await tx.insert(customers).values(
              d.customers.map((c: Record<string, unknown>) => ({
                ...c,
                createdAt: new Date(String(c.createdAt)),
                updatedAt: new Date(String(c.updatedAt)),
              })),
            );
          }
          if (Array.isArray(d.reservations) && d.reservations.length) {
            await tx.insert(reservations).values(
              d.reservations.map((r: Record<string, unknown>) => ({
                ...r,
                startDate: new Date(String(r.startDate)),
                endDate: new Date(String(r.endDate)),
                conditionsAcceptedAt: r.conditionsAcceptedAt
                  ? new Date(String(r.conditionsAcceptedAt))
                  : null,
                createdAt: new Date(String(r.createdAt)),
                updatedAt: new Date(String(r.updatedAt)),
              })),
            );
          }
          if (Array.isArray(d.rentalContracts) && d.rentalContracts.length) {
            await tx.insert(rentalContracts).values(
              d.rentalContracts.map((ct: Record<string, unknown>) => ({
                ...ct,
                startAt: new Date(String(ct.startAt)),
                endAt: new Date(String(ct.endAt)),
                confirmedAt: ct.confirmedAt ? new Date(String(ct.confirmedAt)) : null,
                completedAt: ct.completedAt ? new Date(String(ct.completedAt)) : null,
                extensionStartAt: ct.extensionStartAt ? new Date(String(ct.extensionStartAt)) : null,
                extensionEndAt: ct.extensionEndAt ? new Date(String(ct.extensionEndAt)) : null,
                createdAt: new Date(String(ct.createdAt)),
                updatedAt: new Date(String(ct.updatedAt)),
              })),
            );
          }
          if (Array.isArray(d.vehicleReturns) && d.vehicleReturns.length) {
            await tx.insert(vehicleReturns).values(
              d.vehicleReturns.map((r: Record<string, unknown>) => ({
                ...r,
                returnedAt: new Date(String(r.returnedAt)),
                createdAt: new Date(String(r.createdAt)),
              })),
            );
          }
          if (Array.isArray(d.vehicleDocuments) && d.vehicleDocuments.length) {
            await tx.insert(vehicleDocuments).values(
              d.vehicleDocuments.map((doc: Record<string, unknown>) => ({
                ...doc,
                uploadedAt: new Date(String(doc.uploadedAt)),
              })),
            );
          }
          if (Array.isArray(d.maintenanceRecords) && d.maintenanceRecords.length) {
            await tx.insert(maintenanceRecords).values(
              d.maintenanceRecords.map((m: Record<string, unknown>) => ({
                ...m,
                completedAt: m.completedAt ? new Date(String(m.completedAt)) : null,
                createdAt: new Date(String(m.createdAt)),
              })),
            );
          }
          if (Array.isArray(d.financialTransactions) && d.financialTransactions.length) {
            await tx.insert(financialTransactions).values(
              d.financialTransactions.map((ft: Record<string, unknown>) => ({
                ...ft,
                txDate: new Date(String(ft.txDate)),
                createdAt: new Date(String(ft.createdAt)),
              })),
            );
          }
          if (Array.isArray(d.notifications) && d.notifications.length) {
            await tx.insert(notifications).values(
              d.notifications.map((n: Record<string, unknown>) => ({
                ...n,
                createdAt: new Date(String(n.createdAt)),
              })),
            );
          }

          // Re-align sequential contract counter with restored historical contracts
          const restoredRows = Array.isArray(d.rentalContracts)
            ? (d.rentalContracts as Array<{ contractNumber?: string }>).map((c) => ({
                contractNumber: String(c.contractNumber || ''),
              }))
            : [];
          const restoredMaxSeq = extractMaxContractSequence(restoredRows);
          await tx
            .insert(systemSettings)
            .values({
              key: CONTRACT_SEQ_KEY,
              valueJson: { lastSeq: restoredMaxSeq },
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: systemSettings.key,
              set: { valueJson: { lastSeq: restoredMaxSeq }, updatedAt: new Date() },
            });
        });

        await logAudit(req.auth, 'RESTORE_BACKUP', 'backup_records', 'restore');
        broadcastSyncEvent({ type: 'data_changed', entity: 'all' });
        res.json({ ok: true });
      } catch (err) {
        console.error('[Restore backup error]', err);
        res.status(500).json({ error: 'Erreur lors de la restauration de la sauvegarde' });
      }
    },
  );

  router.delete('/backups/:id', requireAuth, requireManager, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const [rec] = await db.select().from(backupRecords).where(eq(backupRecords.id, id));
    if (!rec) {
      res.status(404).json({ error: 'Sauvegarde introuvable' });
      return;
    }
    const absPath = path.resolve(BACKUPS_DIR, rec.filename);
    if (absPath.startsWith(BACKUPS_DIR + path.sep) && fs.existsSync(absPath)) {
      try {
        fs.unlinkSync(absPath);
      } catch {
        // ignore missing file
      }
    }
    await db.delete(backupRecords).where(eq(backupRecords.id, id));
    await logAudit(req.auth, 'DELETE_BACKUP', 'backup_records', id, { filename: rec.filename });
    res.json({ ok: true });
  });

  router.get('/settings/permissions', requireAuth, async (_req: Request, res: Response) => {
    const permissions = await getDeletePermissions();
    res.json({ permissions });
  });

  router.put('/settings/permissions', requireAuth, requireManager, async (req: Request, res: Response) => {
    const current = await getDeletePermissions();
    const next: DeletePermissionConfig = {
      employeeCanDeleteVehicles:
        typeof req.body?.employeeCanDeleteVehicles === 'boolean'
          ? req.body.employeeCanDeleteVehicles
          : current.employeeCanDeleteVehicles,
      employeeCanDeleteCustomers:
        typeof req.body?.employeeCanDeleteCustomers === 'boolean'
          ? req.body.employeeCanDeleteCustomers
          : current.employeeCanDeleteCustomers,
      employeeCanDeleteReservations:
        typeof req.body?.employeeCanDeleteReservations === 'boolean'
          ? req.body.employeeCanDeleteReservations
          : current.employeeCanDeleteReservations,
      employeeCanDeleteContracts:
        typeof req.body?.employeeCanDeleteContracts === 'boolean'
          ? req.body.employeeCanDeleteContracts
          : current.employeeCanDeleteContracts,
      employeeCanDeleteDocuments:
        typeof req.body?.employeeCanDeleteDocuments === 'boolean'
          ? req.body.employeeCanDeleteDocuments
          : current.employeeCanDeleteDocuments,
      employeeCanDeleteMaintenance:
        typeof req.body?.employeeCanDeleteMaintenance === 'boolean'
          ? req.body.employeeCanDeleteMaintenance
          : current.employeeCanDeleteMaintenance,
      employeeCanClearNotifications:
        typeof req.body?.employeeCanClearNotifications === 'boolean'
          ? req.body.employeeCanClearNotifications
          : current.employeeCanClearNotifications,
    };

    await db
      .insert(systemSettings)
      .values({ key: 'delete_permissions', valueJson: next, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { valueJson: next, updatedAt: new Date() },
      });

    await logAudit(req.auth, 'UPDATE_DELETE_PERMISSIONS', 'system_settings', 'delete_permissions', next);
    broadcastSyncEvent({ type: 'data_changed', entity: 'settings' });
    res.json({ permissions: next });
  });

  router.get('/audit-logs', requireAuth, requireManager, async (_req: Request, res: Response) => {
    const logs = await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);
    res.json({ logs });
  });

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({
          error: 'Le fichier dépasse la taille maximale autorisée (15 Mo).',
        });
        return;
      }
      res.status(400).json({ error: `Erreur de téléversement du fichier (${err.code}).` });
      return;
    }
    if (
      err &&
      typeof err === 'object' &&
      'type' in err &&
      (err as { type?: string }).type === 'entity.parse.failed'
    ) {
      res.status(400).json({ error: 'Format de requête JSON invalide.' });
      return;
    }
    console.error('[API Error Middleware]', err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  });

  return router;
}
