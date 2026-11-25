import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import JSZip from 'jszip';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
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
} from '../db/schema.ts';
import { computeDocumentStatus, getMaintenanceAlertsForVehicle } from './business.ts';
import { broadcastSyncEvent } from './events.ts';
import { BACKUPS_DIR, ensureStorageDirectories, UPLOADS_ROOT } from './storage.ts';

async function insertNotificationIfNew(input: {
  audience: 'manager' | 'all';
  severity: 'normal' | 'warning' | 'urgent';
  category: string;
  title: string;
  message: string;
  dedupeKey: string;
  metadataJson?: Record<string, unknown>;
}) {
  const inserted = await db
    .insert(notifications)
    .values({
      audience: input.audience,
      severity: input.severity,
      category: input.category,
      title: input.title,
      message: input.message,
      dedupeKey: input.dedupeKey,
      metadataJson: input.metadataJson || {},
    })
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning();

  if (inserted.length > 0) {
    broadcastSyncEvent({
      type: 'notification',
      entity: 'notification',
      id: inserted[0].id,
    });
  }
}

export async function runExpiryAndMaintenanceChecks() {
  const allVehicles = await db.select().from(vehicles).where(isNull(vehicles.archivedAt));
  if (allVehicles.length === 0) return;

  const vehicleMap = new Map(allVehicles.map((v) => [v.id, v]));

  // 1. Vehicle Document Expiry Checks (30, 15, 7, 0 days + expired)
  const currentDocs = await db
    .select()
    .from(vehicleDocuments)
    .where(and(eq(vehicleDocuments.isCurrent, true), isNull(vehicleDocuments.archivedAt)));

  for (const doc of currentDocs) {
    if (!doc.expiryDate) continue;
    const v = vehicleMap.get(doc.vehicleId);
    if (!v) continue;

    const status = computeDocumentStatus(doc.expiryDate);
    if (status.remainingDays === null) continue;

    const d = status.remainingDays;
    let windowKey: string | null = null;
    let severity: 'normal' | 'warning' | 'urgent' = 'normal';

    if (d < 0) {
      windowKey = 'expired';
      severity = 'urgent';
    } else if (d === 0) {
      windowKey = '0d';
      severity = 'urgent';
    } else if (d <= 7) {
      windowKey = '7d';
      severity = 'warning';
    } else if (d <= 15) {
      windowKey = '15d';
      severity = 'warning';
    } else if (d <= 30) {
      windowKey = '30d';
      severity = 'normal';
    }

    if (windowKey) {
      const label =
        d < 0
          ? `Expiré depuis ${Math.abs(d)} j`
          : d === 0
            ? "Expire aujourd'hui"
            : `Expire dans ${d} j`;
      await insertNotificationIfNew({
        audience: 'manager',
        severity,
        category: 'document_expiry',
        title: `${doc.docName} · ${v.registrationNumber}`,
        message: `${v.brand} ${v.model} (${v.registrationNumber}) — ${label} (${doc.expiryDate})`,
        dedupeKey: `doc:${doc.id}:expiry:${doc.expiryDate}:win:${windowKey}`,
        metadataJson: {
          vehicleId: v.id,
          documentId: doc.id,
          docType: doc.docType,
          expiryDate: doc.expiryDate,
          remainingDays: d,
        },
      });
    }
  }

  // 2. Maintenance Mileage Reminders (10,000 / 25,000 / 50,000 km)
  const allMaint = await db
    .select()
    .from(maintenanceRecords)
    .where(isNull(maintenanceRecords.archivedAt));
  for (const v of allVehicles) {
    const history = allMaint.filter((m) => m.vehicleId === v.id);
    const alerts = getMaintenanceAlertsForVehicle(v.currentMileage, history);
    for (const alert of alerts) {
      if (alert.state === 'overdue' || alert.state === 'approaching') {
        await insertNotificationIfNew({
          audience: 'manager',
          severity: alert.state === 'overdue' ? 'urgent' : 'warning',
          category: 'maintenance',
          title: `Maintenance ${alert.maintenanceType} · ${v.registrationNumber}`,
          message:
            alert.state === 'overdue'
              ? `${v.brand} ${v.model} : seuil ${alert.nextServiceMileage.toLocaleString('fr-FR')} km dépassé (actuel : ${v.currentMileage.toLocaleString('fr-FR')} km)`
              : `${v.brand} ${v.model} : ${alert.maintenanceType} prévu à ${alert.nextServiceMileage.toLocaleString('fr-FR')} km (dans ${alert.remainingKm.toLocaleString('fr-FR')} km)`,
          dedupeKey: `maint:${v.id}:${alert.maintenanceType}:target:${alert.nextServiceMileage}:${alert.state}`,
          metadataJson: {
            vehicleId: v.id,
            maintenanceType: alert.maintenanceType,
            nextServiceMileage: alert.nextServiceMileage,
            remainingKm: alert.remainingKm,
          },
        });
      }
    }
  }

  // 3. Overdue Returns Check
  const now = new Date();
  const activeContracts = await db
    .select()
    .from(rentalContracts)
    .where(
      and(
        inArray(rentalContracts.status, ['confirmed', 'active']),
        isNull(rentalContracts.archivedAt),
      ),
    );

  for (const c of activeContracts) {
    if (c.endAt.getTime() < now.getTime()) {
      const v = vehicleMap.get(c.vehicleId);
      const dayKey = now.toISOString().slice(0, 10);
      await insertNotificationIfNew({
        audience: 'all',
        severity: 'urgent',
        category: 'return',
        title: `Retour en retard · ${v?.registrationNumber || c.contractNumber}`,
        message: `Contrat ${c.contractNumber} prévu le ${c.endAt.toLocaleString('fr-FR')}`,
        dedupeKey: `contract-overdue:${c.id}:${dayKey}`,
        metadataJson: { contractId: c.id, vehicleId: c.vehicleId },
      });
    }
  }
}

export async function createFullBackupArchive(createdByRole: string): Promise<{
  id: number;
  filename: string;
  sizeBytes: number;
  absPath: string;
  recordCounts: Record<string, number>;
}> {
  ensureStorageDirectories();
  const [
    vehiclesRows,
    customersRows,
    conditionsRows,
    reservationsRows,
    contractsRows,
    returnsRows,
    docsRows,
    maintRows,
    financeRows,
    notifRows,
    settingsRows,
  ] = await Promise.all([
    db.select().from(vehicles),
    db.select().from(customers),
    db.select().from(rentalConditionsVersions),
    db.select().from(reservations),
    db.select().from(rentalContracts),
    db.select().from(vehicleReturns),
    db.select().from(vehicleDocuments),
    db.select().from(maintenanceRecords),
    db.select().from(financialTransactions),
    db.select().from(notifications),
    db.select().from(systemSettings),
  ]);

  const recordCounts: Record<string, number> = {
    vehicles: vehiclesRows.length,
    customers: customersRows.length,
    conditions: conditionsRows.length,
    reservations: reservationsRows.length,
    contracts: contractsRows.length,
    returns: returnsRows.length,
    documents: docsRows.length,
    maintenance: maintRows.length,
    transactions: financeRows.length,
    notifications: notifRows.length,
  };

  const dump = {
    exportedAt: new Date().toISOString(),
    app: 'TRANSCAR',
    version: '1.0',
    recordCounts,
    data: {
      vehicles: vehiclesRows,
      customers: customersRows,
      rentalConditionsVersions: conditionsRows,
      reservations: reservationsRows,
      rentalContracts: contractsRows,
      vehicleReturns: returnsRows,
      vehicleDocuments: docsRows,
      maintenanceRecords: maintRows,
      financialTransactions: financeRows,
      notifications: notifRows,
      systemSettings: settingsRows,
    },
  };

  const zip = new JSZip();
  zip.file('database.json', JSON.stringify(dump, null, 2));

  // Include all protected uploaded files in the archive
  const uploadsFolder = zip.folder('uploads');
  if (uploadsFolder && fs.existsSync(UPLOADS_ROOT)) {
    for (const sub of ['vehicles', 'documents', 'licences']) {
      const subDir = path.join(UPLOADS_ROOT, sub);
      if (fs.existsSync(subDir)) {
        for (const file of fs.readdirSync(subDir)) {
          const full = path.join(subDir, file);
          if (fs.statSync(full).isFile()) {
            uploadsFolder.file(`${sub}/${file}`, fs.readFileSync(full));
          }
        }
      }
    }
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `transcar-backup-${stamp}.zip`;
  const absPath = path.resolve(BACKUPS_DIR, filename);
  fs.writeFileSync(absPath, buffer);

  const [saved] = await db
    .insert(backupRecords)
    .values({
      filename,
      sizeBytes: buffer.length,
      recordCountsJson: recordCounts,
      createdByRole,
    })
    .returning();

  return {
    id: saved.id,
    filename,
    sizeBytes: buffer.length,
    absPath,
    recordCounts,
  };
}

let schedulerStarted = false;

export function startBackgroundSchedulers() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Check document expiries, maintenance thresholds & overdue returns every 15 minutes
  cron.schedule(
    '*/15 * * * *',
    () => {
      runExpiryAndMaintenanceChecks().catch((err) => {
        console.error('[Scheduler] Monitoring error:', err);
      });
    },
    { timezone: 'Africa/Algiers' },
  );

  // Automatic daily backup at 02:00 Algiers time
  cron.schedule(
    '0 2 * * *',
    () => {
      createFullBackupArchive('system-cron').catch((err) => {
        console.error('[Scheduler] Automatic backup error:', err);
      });
    },
    { timezone: 'Africa/Algiers' },
  );
}
