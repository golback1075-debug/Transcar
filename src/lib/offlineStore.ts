import type {
  ContractItem,
  CustomerItem,
  DeletePermissions,
  FinanceSummary,
  FinancialTransactionItem,
  MaintenanceItem,
  NotificationItem,
  ReservationItem,
  ReturnItem,
  VehicleDocumentItem,
  VehicleItem,
} from '../types.ts';
import {
  getAllSnapshotKeys,
  loadSnapshotFromDb,
  saveSnapshotToDb,
} from './offlineDb.ts';

let tempIdSeq = 0;
export function nextTempId(): number {
  tempIdSeq = (tempIdSeq + 1) % 100;
  return -(Math.max(1, Date.now() - 1700000000000) * 100 + tempIdSeq);
}

function formatLocalContractNumber(seq: number): string {
  return `TRANSCAR-${String(Math.max(1, seq)).padStart(4, '0')}`;
}

function computeNextLocalContractSeq(
  contracts: ContractItem[],
  hintedNextContractNumber?: string,
): number {
  let maxSeq = 0;
  for (const ct of contracts) {
    const m = /^TRANSCAR-(\d+)$/.exec(String(ct.contractNumber || '').trim());
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  if (hintedNextContractNumber) {
    const hm = /^TRANSCAR-(\d+)$/.exec(String(hintedNextContractNumber).trim());
    if (hm) {
      const hn = Number(hm[1]);
      if (Number.isFinite(hn) && hn - 1 > maxSeq) maxSeq = hn - 1;
    }
  }
  return maxSeq + 1;
}

export function peekNextOfflineContractNumber(): string {
  const ctSnap = loadSnapshotFromDb<{
    contracts: ContractItem[];
    nextContractNumber?: string;
  }>('/api/contracts');
  const seq = computeNextLocalContractSeq(
    ctSnap?.contracts || [],
    ctSnap?.nextContractNumber,
  );
  return formatLocalContractNumber(seq);
}

function localDatesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function calcDays(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function isBlockingContractStatusLocal(status: string): boolean {
  return status === 'confirmed' || status === 'active';
}

function isOpenContractStatusLocal(status: string): boolean {
  return status === 'pending' || status === 'upcoming' || status === 'confirmed' || status === 'active';
}

export function recomputeCashSummaryLocal(
  txs: FinancialTransactionItem[],
): FinanceSummary {
  const todayIso = getTodayIso();
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
    const dt = String(tx.txDate || '');
    const txDay = dt.slice(0, 10);
    const txMonth = dt.slice(0, 7);
    const amt = Number(tx.amountDzd || 0);

    if (tx.txType === 'rental_payment' || tx.txType === 'late_extra_fee') {
      totalIncome += amt;
      cashBalance += amt;
      if (txDay === todayIso) dailyTotal += amt;
      if (txMonth === currentMonth) monthlyTotal += amt;
    } else if (tx.txType === 'deposit_in') {
      totalDepositsIn += amt;
      cashBalance += amt;
    } else if (tx.txType === 'deposit_refund') {
      totalDepositsRefund += amt;
      cashBalance -= amt;
    } else if (tx.txType === 'expense') {
      totalExpenses += amt;
      cashBalance -= amt;
    } else if (tx.txType === 'refund') {
      totalRefunds += amt;
      cashBalance -= amt;
    } else if (tx.txType === 'cash_withdrawal') {
      totalWithdrawals += amt;
      cashBalance -= amt;
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

function updateFinanceCache(mutator: (txs: FinancialTransactionItem[]) => FinancialTransactionItem[]) {
  const current = loadSnapshotFromDb<{
    summary: FinanceSummary;
    transactions: FinancialTransactionItem[];
    withdrawals?: FinancialTransactionItem[];
  }>('/api/finance/transactions');

  const nextTxs = mutator(current?.transactions ? [...current.transactions] : []);
  const summary = recomputeCashSummaryLocal(nextTxs);
  const withdrawals = nextTxs.filter((t) => t.txType === 'cash_withdrawal');

  saveSnapshotToDb('/api/finance/transactions', {
    summary,
    transactions: nextTxs,
    withdrawals,
  });

  // Also keep cached financial report snapshots reasonably aligned
  recomputeReportSnapshots(nextTxs);

  return { summary, transactions: nextTxs, withdrawals };
}

function recomputeReportSnapshots(txs: FinancialTransactionItem[]) {
  const vehiclesData = loadSnapshotFromDb<{ vehicles: VehicleItem[] }>('/api/vehicles');
  const contractsData = loadSnapshotFromDb<{ contracts: ContractItem[] }>('/api/contracts');
  const maintData = loadSnapshotFromDb<{ records: MaintenanceItem[] }>('/api/maintenance');

  const keys = getAllSnapshotKeys().filter((k) => k.startsWith('/api/reports/financial'));
  for (const key of keys) {
    const existing = loadSnapshotFromDb<{ period: string }>(key);
    const period = existing?.period || (key.includes('weekly') ? 'weekly' : key.includes('annual') ? 'annual' : key.includes('daily') ? 'daily' : 'monthly');
    const now = new Date();
    const todayIso = getTodayIso();
    let startBoundary = new Date(`${todayIso}T00:00:00Z`);
    if (period === 'weekly') startBoundary = new Date(now.getTime() - 7 * 86400000);
    else if (period === 'monthly') startBoundary = new Date(`${todayIso.slice(0, 7)}-01T00:00:00Z`);
    else if (period === 'annual') startBoundary = new Date(`${todayIso.slice(0, 4)}-01-01T00:00:00Z`);

    const periodTxs = txs.filter((t) => new Date(t.txDate).getTime() >= startBoundary.getTime());
    let revenue = 0;
    let expenses = 0;
    let refunds = 0;
    for (const tx of periodTxs) {
      if (tx.txType === 'rental_payment' || tx.txType === 'late_extra_fee') revenue += tx.amountDzd;
      else if (tx.txType === 'expense') expenses += tx.amountDzd;
      else if (tx.txType === 'refund') refunds += tx.amountDzd;
    }

    const contracts = contractsData?.contracts || [];
    const vehicles = vehiclesData?.vehicles || [];
    const records = maintData?.records || [];

    const outstandingPaymentsDzd = contracts
      .filter((c) => c.status !== 'cancelled')
      .reduce((acc, c) => acc + Math.max(0, c.totalAmountDzd - c.amountPaidDzd), 0);

    const vehiclePerformance = vehicles.map((v) => {
      const vContracts = contracts.filter(
        (c) =>
          c.vehicleId === v.id &&
          c.status !== 'cancelled' &&
          new Date(c.startAt).getTime() >= startBoundary.getTime(),
      );
      const rentedDays = vContracts.reduce((s, c) => s + (c.durationDays || 0), 0);
      const vRev = periodTxs
        .filter((t) => t.vehicleId === v.id && (t.txType === 'rental_payment' || t.txType === 'late_extra_fee'))
        .reduce((s, t) => s + t.amountDzd, 0);
      const vExp = periodTxs
        .filter((t) => t.vehicleId === v.id && t.txType === 'expense')
        .reduce((s, t) => s + t.amountDzd, 0);
      const maintCount = records.filter((m) => m.vehicleId === v.id).length;
      return {
        vehicleId: v.id,
        brand: v.brand,
        model: v.model,
        registrationNumber: v.registrationNumber,
        rentedDays,
        revenueDzd: vRev,
        maintenanceExpenseDzd: vExp,
        netProfitDzd: vRev - vExp,
        maintenanceCount: maintCount,
      };
    });

    saveSnapshotToDb(key, {
      period,
      summary: {
        revenueDzd: revenue,
        expensesDzd: expenses + refunds,
        netProfitDzd: revenue - expenses - refunds,
        outstandingPaymentsDzd,
      },
      vehiclePerformance,
      transactions: periodTxs,
    });
  }
}

export function recomputeDashboardAndVehiclesLocal() {
  const vehiclesData = loadSnapshotFromDb<{ vehicles: VehicleItem[] }>('/api/vehicles');
  const contractsData = loadSnapshotFromDb<{ contracts: ContractItem[] }>('/api/contracts');
  const reservationsData = loadSnapshotFromDb<{ reservations: ReservationItem[] }>('/api/reservations');
  const customersData = loadSnapshotFromDb<{ customers: CustomerItem[] }>('/api/customers');
  const maintData = loadSnapshotFromDb<{ records: MaintenanceItem[]; alerts: unknown[] }>('/api/maintenance');
  const dash = loadSnapshotFromDb<Record<string, unknown>>('/api/dashboard');

  const vehicles = vehiclesData?.vehicles || [];
  const contracts = contractsData?.contracts || [];
  const reservations = reservationsData?.reservations || [];
  const maintRecords = maintData?.records || [];

  const updatedVehicles = vehicles.map((v) => {
    const activeCt = contracts.find((c) => c.vehicleId === v.id && isBlockingContractStatusLocal(c.status)) || null;
    const activeMaint = maintRecords.find((m) => m.vehicleId === v.id && m.status === 'in_progress') || null;
    const activeRes = reservations.find((r) => r.vehicleId === v.id && (r.status === 'confirmed' || r.status === 'pending')) || null;
    let computedStatus: VehicleItem['computedStatus'] = 'available';
    if (v.manualStatus === 'maintenance' || activeMaint) computedStatus = 'maintenance';
    else if (activeCt) computedStatus = 'rented';
    else if (activeRes) computedStatus = 'reserved';
    return {
      ...v,
      computedStatus,
      activeContract: activeCt,
      activeReservation: activeRes,
      inProgressMaintenance: activeMaint,
    };
  });

  if (vehiclesData) {
    saveSnapshotToDb('/api/vehicles', { vehicles: updatedVehicles });
  }

  if (dash && typeof dash === 'object') {
    const existingStats = (dash.stats as Record<string, number> | undefined) || {};
    const stats = {
      ...existingStats,
      totalVehicles: updatedVehicles.length,
      availableVehicles: updatedVehicles.filter((v) => v.computedStatus === 'available').length,
      rentedVehicles: updatedVehicles.filter((v) => v.computedStatus === 'rented').length,
      reservedVehicles: updatedVehicles.filter((v) => v.computedStatus === 'reserved').length,
      maintenanceVehicles: updatedVehicles.filter((v) => v.computedStatus === 'maintenance').length,
      activeRentals: contracts.filter((c) => isBlockingContractStatusLocal(c.status)).length,
      totalCustomers: customersData?.customers?.length ?? existingStats.totalCustomers ?? 0,
    };
    const finSnap = loadSnapshotFromDb<{ summary: FinanceSummary }>('/api/finance/transactions');
    const financeSummary = finSnap?.summary
      ? {
          dailyRevenue: finSnap.summary.dailyTotal,
          monthlyRevenue: finSnap.summary.monthlyTotal,
          totalRevenue: finSnap.summary.totalIncome,
          totalExpenses: finSnap.summary.totalExpenses + finSnap.summary.totalRefunds,
          netProfit: finSnap.summary.netProfit,
          cashBalance: finSnap.summary.cashBalance,
        }
      : dash.financeSummary;
    saveSnapshotToDb('/api/dashboard', {
      ...dash,
      stats,
      financeSummary,
      recentContracts: contracts.slice(0, 6),
    });
  }
}

export interface OfflineApplyContext {
  tempId?: number;
  fileUrlMap?: Record<string, string>;
}

export function applyOfflineMutation(
  url: string,
  method: string,
  payload: Record<string, unknown>,
  ctx: OfflineApplyContext = {},
): unknown {
  const upper = method.toUpperCase();
  const cleanUrl = url.split('?')[0];

  // 1. VEHICLES
  if (cleanUrl === '/api/vehicles' && upper === 'POST') {
    const brand = String(payload.brand || '').trim();
    const model = String(payload.model || '').trim();
    const color = String(payload.color || '').trim();
    const plate = String(payload.registrationNumber || '').trim();
    const dailyPriceDzd = Number(payload.dailyPriceDzd || 0);
    const currentMileage = payload.currentMileage !== undefined && payload.currentMileage !== '' ? Number(payload.currentMileage) : 0;
    if (!brand || !model || !color || !plate) {
      throw new Error('Marque, modèle, couleur et immatriculation sont obligatoires');
    }
    if (!Number.isFinite(dailyPriceDzd) || dailyPriceDzd <= 0) {
      throw new Error('Le prix journalier doit être supérieur à 0 DZD');
    }
    if (!Number.isFinite(currentMileage) || currentMileage < 0) {
      throw new Error('Le kilométrage doit être supérieur ou égal à 0');
    }
    const id = ctx.tempId ?? nextTempId();
    const vehiclesSnap = loadSnapshotFromDb<{ vehicles: VehicleItem[] }>('/api/vehicles') || { vehicles: [] };
    if (vehiclesSnap.vehicles.some((v) => v.registrationNumber.toLowerCase() === plate.toLowerCase())) {
      throw new Error('Un véhicule avec ce numéro d’immatriculation existe déjà');
    }
    const photoUrl = ctx.fileUrlMap?.photo || '';
    const newVehicle: VehicleItem = {
      id,
      brand,
      model,
      year: Number(payload.year || new Date().getFullYear()),
      color,
      registrationNumber: plate,
      dailyPriceDzd: Math.round(dailyPriceDzd),
      currentMileage: Math.round(currentMileage),
      photoPath: photoUrl,
      photoUrl,
      fuelType: String(payload.fuelType || 'Essence'),
      transmission: String(payload.transmission || 'Manuelle'),
      seats: Number(payload.seats || 5),
      chassisNumber: String(payload.chassisNumber || ''),
      engineSeries: String(payload.engineSeries || ''),
      manualStatus: String(payload.manualStatus || 'available'),
      computedStatus: payload.manualStatus === 'maintenance' ? 'maintenance' : 'available',
      availableForRange: true,
      docAlertCount: 0,
      maintAlerts: [],
      version: 1,
    };
    saveSnapshotToDb('/api/vehicles', { vehicles: [newVehicle, ...vehiclesSnap.vehicles] });
    recomputeDashboardAndVehiclesLocal();
    return { vehicle: newVehicle, tempId: id, queuedOffline: true };
  }

  const vehMatch = cleanUrl.match(/^\/api\/vehicles\/(-?\d+)$/);
  if (vehMatch) {
    const vehId = Number(vehMatch[1]);
    const vehiclesSnap = loadSnapshotFromDb<{ vehicles: VehicleItem[] }>('/api/vehicles') || { vehicles: [] };
    if (upper === 'PUT') {
      const updatedList = vehiclesSnap.vehicles.map((v) => {
        if (v.id !== vehId) return v;
        return {
          ...v,
          brand: payload.brand !== undefined ? String(payload.brand) : v.brand,
          model: payload.model !== undefined ? String(payload.model) : v.model,
          year: payload.year !== undefined ? Number(payload.year) : v.year,
          color: payload.color !== undefined ? String(payload.color) : v.color,
          registrationNumber: payload.registrationNumber !== undefined ? String(payload.registrationNumber) : v.registrationNumber,
          dailyPriceDzd: payload.dailyPriceDzd !== undefined ? Number(payload.dailyPriceDzd) : v.dailyPriceDzd,
          currentMileage: payload.currentMileage !== undefined ? Number(payload.currentMileage) : v.currentMileage,
          fuelType: payload.fuelType !== undefined ? String(payload.fuelType) : v.fuelType,
          transmission: payload.transmission !== undefined ? String(payload.transmission) : v.transmission,
          seats: payload.seats !== undefined ? Number(payload.seats) : v.seats,
          chassisNumber: payload.chassisNumber !== undefined ? String(payload.chassisNumber) : v.chassisNumber,
          engineSeries: payload.engineSeries !== undefined ? String(payload.engineSeries) : v.engineSeries,
          manualStatus: payload.manualStatus !== undefined ? String(payload.manualStatus) : v.manualStatus,
          photoUrl: ctx.fileUrlMap?.photo || v.photoUrl,
          version: (v.version || 1) + 1,
        };
      });
      saveSnapshotToDb('/api/vehicles', { vehicles: updatedList });
      recomputeDashboardAndVehiclesLocal();
      return { vehicle: updatedList.find((v) => v.id === vehId), queuedOffline: true };
    }
    if (upper === 'DELETE') {
      const contracts = loadSnapshotFromDb<{ contracts: ContractItem[] }>('/api/contracts')?.contracts || [];
      const resList = loadSnapshotFromDb<{ reservations: ReservationItem[] }>('/api/reservations')?.reservations || [];
      if (contracts.some((c) => c.vehicleId === vehId && isOpenContractStatusLocal(c.status))) {
        throw new Error('Suppression impossible : ce véhicule a un contrat en cours ou à confirmer.');
      }
      if (resList.some((r) => r.vehicleId === vehId && (r.status === 'pending' || r.status === 'confirmed'))) {
        throw new Error('Suppression impossible : ce véhicule a une réservation en cours.');
      }
      saveSnapshotToDb('/api/vehicles', {
        vehicles: vehiclesSnap.vehicles.filter((v) => v.id !== vehId),
      });
      recomputeDashboardAndVehiclesLocal();
      return { ok: true, mode: 'deleted', message: 'Véhicule supprimé (hors ligne — en attente de sync).', queuedOffline: true };
    }
  }

  // 2. VEHICLE DOCUMENTS
  const docPostMatch = cleanUrl.match(/^\/api\/vehicles\/(-?\d+)\/documents$/);
  if (docPostMatch && upper === 'POST') {
    const vehId = Number(docPostMatch[1]);
    const docId = ctx.tempId ?? nextTempId();
    const docsKey = `/api/vehicles/${vehId}/documents`;
    const docsSnap = loadSnapshotFromDb<{ documents: VehicleDocumentItem[] }>(docsKey) || { documents: [] };
    const docType = String(payload.docType || 'other');
    const docName = String(payload.docName || docType).trim();
    if (!docName) {
      throw new Error('Le nom du document est obligatoire.');
    }
    const issueDate = String(payload.issueDate || getTodayIso());
    const noExpiry = payload.noExpiry === true || payload.noExpiry === 'true';
    const expiryDate = noExpiry ? '' : String(payload.expiryDate || '');
    const replaceDocId = payload.replaceDocId ? Number(payload.replaceDocId) : null;
    const nextDocs = docsSnap.documents.map((d) =>
      replaceDocId && d.id === replaceDocId ? { ...d, isCurrent: false } : d,
    );
    const createdDoc: VehicleDocumentItem = {
      id: docId,
      vehicleId: vehId,
      docType,
      docName,
      issueDate,
      expiryDate,
      fileUrl: ctx.fileUrlMap?.file || '',
      mimeType: String(payload.mimeType || 'application/pdf'),
      isCurrent: true,
      uploadedAt: new Date().toISOString(),
      computed: {
        status: expiryDate ? 'valid' : 'permanent',
        color: 'green',
        remainingDays: expiryDate ? 365 : null,
      },
    };
    saveSnapshotToDb(docsKey, { documents: [createdDoc, ...nextDocs] });
    return { document: createdDoc, tempId: docId, queuedOffline: true };
  }

  const docDelMatch = cleanUrl.match(/^\/api\/vehicles\/(-?\d+)\/documents\/(-?\d+)$/);
  if (docDelMatch && upper === 'DELETE') {
    const vehId = Number(docDelMatch[1]);
    const docId = Number(docDelMatch[2]);
    const docsKey = `/api/vehicles/${vehId}/documents`;
    const docsSnap = loadSnapshotFromDb<{ documents: VehicleDocumentItem[] }>(docsKey);
    if (docsSnap) {
      saveSnapshotToDb(docsKey, {
        documents: docsSnap.documents.filter((d) => d.id !== docId),
      });
    }
    return { ok: true, queuedOffline: true };
  }

  // 3. CUSTOMERS & LICENCES
  if (cleanUrl === '/api/customers' && upper === 'POST') {
    const fullName = String(payload.fullName || '').trim();
    const phone = String(payload.phone || '').trim();
    if (!fullName || !phone) {
      throw new Error('Le nom complet et le téléphone du client sont obligatoires');
    }
    const id = ctx.tempId ?? nextTempId();
    const snap = loadSnapshotFromDb<{ customers: CustomerItem[] }>('/api/customers') || { customers: [] };
    const created: CustomerItem = {
      id,
      fullName,
      dateOfBirth: String(payload.dateOfBirth || ''),
      birthPlace: String(payload.birthPlace || ''),
      phone,
      address: String(payload.address || ''),
      email: String(payload.email || ''),
      idType: String(payload.idType || 'CNI'),
      idNumber: String(payload.idNumber || ''),
      idIssuedBy: String(payload.idIssuedBy || ''),
      country: String(payload.country || 'Algérie'),
      licenceNumber: String(payload.licenceNumber || ''),
      licenceFrontUrl: ctx.fileUrlMap?.licenceFront || null,
      licenceBackUrl: ctx.fileUrlMap?.licenceBack || null,
      contractsCount: 0,
      reservationsCount: 0,
      rentalHistory: [],
      version: 1,
    };
    saveSnapshotToDb('/api/customers', { customers: [created, ...snap.customers] });
    recomputeDashboardAndVehiclesLocal();
    return { customer: created, tempId: id, queuedOffline: true };
  }

  const custMatch = cleanUrl.match(/^\/api\/customers\/(-?\d+)$/);
  if (custMatch) {
    const custId = Number(custMatch[1]);
    const snap = loadSnapshotFromDb<{ customers: CustomerItem[] }>('/api/customers') || { customers: [] };
    if (upper === 'PUT') {
      const updated = snap.customers.map((c) =>
        c.id === custId
          ? {
              ...c,
              fullName: payload.fullName !== undefined ? String(payload.fullName) : c.fullName,
              dateOfBirth: payload.dateOfBirth !== undefined ? String(payload.dateOfBirth) : c.dateOfBirth,
              birthPlace: payload.birthPlace !== undefined ? String(payload.birthPlace) : c.birthPlace,
              phone: payload.phone !== undefined ? String(payload.phone) : c.phone,
              address: payload.address !== undefined ? String(payload.address) : c.address,
              email: payload.email !== undefined ? String(payload.email) : c.email,
              idType: payload.idType !== undefined ? String(payload.idType) : c.idType,
              idNumber: payload.idNumber !== undefined ? String(payload.idNumber) : c.idNumber,
              idIssuedBy: payload.idIssuedBy !== undefined ? String(payload.idIssuedBy) : c.idIssuedBy,
              country: payload.country !== undefined ? String(payload.country) : c.country,
              licenceNumber: payload.licenceNumber !== undefined ? String(payload.licenceNumber) : c.licenceNumber,
              version: (c.version || 1) + 1,
            }
          : c,
      );
      saveSnapshotToDb('/api/customers', { customers: updated });
      return { customer: updated.find((c) => c.id === custId), queuedOffline: true };
    }
    if (upper === 'DELETE') {
      const contracts = loadSnapshotFromDb<{ contracts: ContractItem[] }>('/api/contracts')?.contracts || [];
      const resList = loadSnapshotFromDb<{ reservations: ReservationItem[] }>('/api/reservations')?.reservations || [];
      if (contracts.some((c) => c.customerId === custId && isOpenContractStatusLocal(c.status))) {
        throw new Error('Suppression impossible : ce client possède un contrat en cours ou à confirmer.');
      }
      if (resList.some((r) => r.customerId === custId && (r.status === 'pending' || r.status === 'confirmed'))) {
        throw new Error('Suppression impossible : ce client possède une réservation en cours.');
      }
      saveSnapshotToDb('/api/customers', {
        customers: snap.customers.filter((c) => c.id !== custId),
      });
      recomputeDashboardAndVehiclesLocal();
      return { ok: true, mode: 'deleted', message: 'Client supprimé (hors ligne).', queuedOffline: true };
    }
  }

  const licUploadMatch = cleanUrl.match(/^\/api\/customers\/(-?\d+)\/licence$/);
  if (licUploadMatch && upper === 'POST') {
    const custId = Number(licUploadMatch[1]);
    const snap = loadSnapshotFromDb<{ customers: CustomerItem[] }>('/api/customers') || { customers: [] };
    const updated = snap.customers.map((c) =>
      c.id === custId
        ? {
            ...c,
            licenceFrontUrl: ctx.fileUrlMap?.front || c.licenceFrontUrl,
            licenceBackUrl: ctx.fileUrlMap?.back || c.licenceBackUrl,
            licenceNumber: payload.licenceNumber ? String(payload.licenceNumber) : c.licenceNumber,
          }
        : c,
    );
    saveSnapshotToDb('/api/customers', { customers: updated });
    return { customer: updated.find((c) => c.id === custId), queuedOffline: true };
  }

  const licDelMatch = cleanUrl.match(/^\/api\/customers\/(-?\d+)\/licence\/(front|back)$/);
  if (licDelMatch && upper === 'DELETE') {
    const custId = Number(licDelMatch[1]);
    const side = licDelMatch[2];
    const snap = loadSnapshotFromDb<{ customers: CustomerItem[] }>('/api/customers') || { customers: [] };
    const updated = snap.customers.map((c) =>
      c.id === custId
        ? {
            ...c,
            licenceFrontUrl: side === 'front' ? null : c.licenceFrontUrl,
            licenceBackUrl: side === 'back' ? null : c.licenceBackUrl,
          }
        : c,
    );
    saveSnapshotToDb('/api/customers', { customers: updated });
    return { ok: true, customer: updated.find((c) => c.id === custId), queuedOffline: true };
  }

  // 4. RESERVATIONS
  if (cleanUrl === '/api/reservations' && upper === 'POST') {
    const vehicleId = Number(payload.vehicleId);
    const customerId = Number(payload.customerId);
    const startAt = new Date(String(payload.startDate || ''));
    const endAt = new Date(String(payload.endDate || ''));
    if (!vehicleId || !customerId || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      throw new Error('Véhicule, client et dates valides (retour après départ) requis');
    }
    const id = ctx.tempId ?? nextTempId();
    const resSnap = loadSnapshotFromDb<{ reservations: ReservationItem[] }>('/api/reservations') || { reservations: [] };
    const ctSnap = loadSnapshotFromDb<{ contracts: ContractItem[] }>('/api/contracts') || { contracts: [] };
    const vehicles = loadSnapshotFromDb<{ vehicles: VehicleItem[] }>('/api/vehicles')?.vehicles || [];
    const customers = loadSnapshotFromDb<{ customers: CustomerItem[] }>('/api/customers')?.customers || [];
    const v = vehicles.find((x) => x.id === vehicleId) || null;
    const c = customers.find((x) => x.id === customerId) || null;
    if (!v) throw new Error('Véhicule sélectionné introuvable');
    if (!c) throw new Error('Client sélectionné introuvable');
    if (v.manualStatus === 'maintenance' || v.computedStatus === 'maintenance') {
      throw new Error('Véhicule en maintenance : réservation impossible');
    }
    if (
      resSnap.reservations.some(
        (r) =>
          r.vehicleId === vehicleId &&
          (r.status === 'pending' || r.status === 'confirmed') &&
          localDatesOverlap(new Date(r.startDate), new Date(r.endDate), startAt, endAt),
      ) ||
      ctSnap.contracts.some(
        (ct) =>
          ct.vehicleId === vehicleId &&
          isBlockingContractStatusLocal(ct.status) &&
          localDatesOverlap(new Date(ct.startAt), new Date(ct.endAt), startAt, endAt),
      )
    ) {
      throw new Error('Conflit de dates : véhicule déjà réservé ou loué sur cette période');
    }

    const days = calcDays(startAt, endAt);
    const dailyPrice = v.dailyPriceDzd || 0;
    const created: ReservationItem = {
      id,
      reservationCode: `RES-OFF-${String(Math.abs(id)).slice(-4)}`,
      vehicleId,
      customerId,
      startDate: startAt.toISOString(),
      endDate: endAt.toISOString(),
      dailyPriceDzd: dailyPrice,
      totalAmountDzd: days * dailyPrice,
      status: 'confirmed',
      source: 'admin',
      notes: String(payload.notes || ''),
      version: 1,
      vehicle: v,
      customer: c,
    };
    saveSnapshotToDb('/api/reservations', { reservations: [created, ...resSnap.reservations] });
    recomputeDashboardAndVehiclesLocal();
    return { reservation: created, tempId: id, queuedOffline: true };
  }

  const resStatusMatch = cleanUrl.match(/^\/api\/reservations\/(-?\d+)\/status$/);
  if (resStatusMatch && upper === 'PUT') {
    const id = Number(resStatusMatch[1]);
    const resSnap = loadSnapshotFromDb<{ reservations: ReservationItem[] }>('/api/reservations') || { reservations: [] };
    const updated = resSnap.reservations.map((r) =>
      r.id === id ? { ...r, status: String(payload.status || r.status), version: r.version + 1 } : r,
    );
    saveSnapshotToDb('/api/reservations', { reservations: updated });
    recomputeDashboardAndVehiclesLocal();
    return { reservation: updated.find((r) => r.id === id), queuedOffline: true };
  }

  const resDelMatch = cleanUrl.match(/^\/api\/reservations\/(-?\d+)$/);
  if (resDelMatch && upper === 'DELETE') {
    const id = Number(resDelMatch[1]);
    const resSnap = loadSnapshotFromDb<{ reservations: ReservationItem[] }>('/api/reservations') || { reservations: [] };
    const target = resSnap.reservations.find((r) => r.id === id);
    const contracts = loadSnapshotFromDb<{ contracts: ContractItem[] }>('/api/contracts')?.contracts || [];
    if (target?.status === 'converted' && contracts.some((c) => c.reservationId === id)) {
      throw new Error('Suppression impossible : cette réservation est liée à un contrat de location.');
    }
    saveSnapshotToDb('/api/reservations', {
      reservations: resSnap.reservations.filter((r) => r.id !== id),
    });
    recomputeDashboardAndVehiclesLocal();
    return { ok: true, mode: 'deleted', message: 'Réservation supprimée (hors ligne).', queuedOffline: true };
  }

  // 5. CONTRACTS (with sequential TRANSCAR-XXXX numbering)
  if (cleanUrl === '/api/contracts' && upper === 'POST') {
    const id = ctx.tempId ?? nextTempId();
    const ctSnap = loadSnapshotFromDb<{
      contracts: ContractItem[];
      nextContractNumber?: string;
    }>('/api/contracts') || { contracts: [] };
    const resSnap = loadSnapshotFromDb<{ reservations: ReservationItem[] }>('/api/reservations');
    const vehicles = loadSnapshotFromDb<{ vehicles: VehicleItem[] }>('/api/vehicles')?.vehicles || [];
    const customers = loadSnapshotFromDb<{ customers: CustomerItem[] }>('/api/customers')?.customers || [];
    const vehicleId = Number(payload.vehicleId);
    const customerId = Number(payload.customerId);
    const reservationId = payload.reservationId ? Number(payload.reservationId) : null;
    const v = vehicles.find((x) => x.id === vehicleId) || null;
    const c = customers.find((x) => x.id === customerId) || null;
    const startAt = new Date(String(payload.startAt));
    const endAt = new Date(String(payload.endAt));

    if (!vehicleId || !customerId || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      throw new Error('Client, véhicule et dates valides (retour postérieur au départ) obligatoires');
    }
    if (!v) throw new Error('Véhicule introuvable');
    if (!c) throw new Error('Client introuvable');
    if (v.manualStatus === 'maintenance' || v.computedStatus === 'maintenance') {
      throw new Error('Véhicule en maintenance : location impossible');
    }
    if (
      (resSnap?.reservations || []).some(
        (r) =>
          r.vehicleId === vehicleId &&
          r.id !== reservationId &&
          (r.status === 'pending' || r.status === 'confirmed') &&
          localDatesOverlap(new Date(r.startDate), new Date(r.endDate), startAt, endAt),
      ) ||
      ctSnap.contracts.some(
        (ct) =>
          ct.vehicleId === vehicleId &&
          isBlockingContractStatusLocal(ct.status) &&
          localDatesOverlap(new Date(ct.startAt), new Date(ct.endAt), startAt, endAt),
      )
    ) {
      throw new Error('Ce véhicule est déjà réservé ou loué sur cette période');
    }

    const durationDays = calcDays(startAt, endAt);
    const dailyPriceDzd = Number(payload.dailyPriceDzd ?? v.dailyPriceDzd ?? 0);
    const totalAmountDzd = durationDays * dailyPriceDzd;
    const depositDzd = Number(payload.depositDzd ?? 0);
    const amountPaidDzd = Number(payload.amountPaidDzd ?? 0);
    if (!Number.isFinite(depositDzd) || depositDzd < 0 || !Number.isFinite(amountPaidDzd) || amountPaidDzd < 0) {
      throw new Error('Caution ou montant versé invalide');
    }
    const departureMileage =
      payload.departureMileage !== undefined && payload.departureMileage !== ''
        ? Number(payload.departureMileage)
        : v.currentMileage ?? 0;
    if (!Number.isFinite(departureMileage) || departureMileage < 0) {
      throw new Error('Kilométrage de départ invalide');
    }
    const rawMaxMileageLimit = payload.maxMileageLimit;
    const maxMileageLimit =
      rawMaxMileageLimit !== undefined && rawMaxMileageLimit !== null && rawMaxMileageLimit !== ''
        ? Math.max(0, Math.round(Number(rawMaxMileageLimit)))
        : null;

    const rawManualNumber =
      typeof payload.contractNumber === 'string' ? payload.contractNumber.trim() : '';
    if (rawManualNumber.length > 64) {
      throw new Error('Le numéro de contrat ne doit pas dépasser 64 caractères.');
    }
    if (
      rawManualNumber &&
      ctSnap.contracts.some(
        (ct) => String(ct.contractNumber || '').trim().toLowerCase() === rawManualNumber.toLowerCase(),
      )
    ) {
      throw new Error('Ce numéro de contrat existe déjà. Veuillez saisir un numéro unique.');
    }

    const contractNumber = rawManualNumber
      ? rawManualNumber
      : formatLocalContractNumber(computeNextLocalContractSeq(ctSnap.contracts, ctSnap.nextContractNumber));
    const status = 'pending';

    const driverCustomerId = payload.driverCustomerId ? Number(payload.driverCustomerId) : null;
    const dc = driverCustomerId ? customers.find((x) => x.id === driverCustomerId) || null : null;
    if (driverCustomerId && !dc) throw new Error('Client conducteur introuvable');
    const dcDob = dc ? [dc.dateOfBirth, dc.birthPlace].filter(Boolean).join(' · ') : '';

    const created: ContractItem = {
      id,
      contractNumber,
      reservationId,
      vehicleId,
      customerId,
      driverCustomerId: dc?.id ?? null,
      driverName: String(payload.driverName || dc?.fullName || '').trim(),
      driverDob: String(payload.driverDob || dcDob || '').trim(),
      driverIdNumber: String(payload.driverIdNumber || dc?.idNumber || '').trim(),
      driverLicenceNumber: String(payload.driverLicenceNumber || dc?.licenceNumber || '').trim(),
      driverCountry: String(payload.driverCountry || dc?.country || '').trim(),
      driverAddress: String(payload.driverAddress || dc?.address || '').trim(),
      driverPhone: String(payload.driverPhone || dc?.phone || '').trim(),
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      durationDays,
      dailyPriceDzd,
      totalAmountDzd,
      depositDzd: Math.round(depositDzd),
      amountPaidDzd: Math.round(amountPaidDzd),
      departureMileage: Math.round(departureMileage),
      maxMileageLimit: Number.isFinite(maxMileageLimit) ? maxMileageLimit : null,
      departureFuelLevel: String(payload.departureFuelLevel || '4/4'),
      departureNotes: String(payload.departureNotes || ''),
      departureDamageJson: Array.isArray(payload.departureDamageJson) ? (payload.departureDamageJson as string[]) : [],
      extensionFromDate: String(payload.extensionFromDate || '').trim(),
      extensionUntilDate: String(payload.extensionUntilDate || '').trim(),
      extensionExitTime: String(payload.extensionExitTime || '').trim(),
      extensionEntryTime: String(payload.extensionEntryTime || '').trim(),
      earlyReturnDate: String(payload.earlyReturnDate || '').trim(),
      earlyReturnTime: String(payload.earlyReturnTime || '').trim(),
      earlyReturnLocation: String(payload.earlyReturnLocation || '').trim(),
      status,
      confirmedAt: null,
      completedAt: null,
      pickupLocation: String(payload.pickupLocation || 'Blida'),
      returnLocation: String(payload.returnLocation || 'Blida'),
      version: 1,
      createdAt: new Date().toISOString(),
      vehicle: v,
      customer: c,
      driverCustomer: dc,
      returnRecord: null,
    };
    const nextContracts = [created, ...ctSnap.contracts];
    const nextContractNumber = formatLocalContractNumber(
      computeNextLocalContractSeq(nextContracts, ctSnap.nextContractNumber),
    );
    saveSnapshotToDb('/api/contracts', {
      nextContractNumber,
      contracts: nextContracts,
    });
    if (reservationId && resSnap) {
      saveSnapshotToDb('/api/reservations', {
        reservations: resSnap.reservations.map((r) =>
          r.id === reservationId ? { ...r, status: 'converted' } : r,
        ),
      });
    }
    const paymentMethod = String(payload.paymentMethod || 'cash');
    if (amountPaidDzd > 0 || depositDzd > 0) {
      updateFinanceCache((txs) => {
        const added: FinancialTransactionItem[] = [];
        if (amountPaidDzd > 0) {
          added.push({
            id: nextTempId(),
            txType: 'rental_payment',
            paymentMethod,
            amountDzd: Math.round(amountPaidDzd),
            contractId: id,
            vehicleId,
            category: 'Location',
            description: `Paiement contrat ${created.contractNumber}`,
            txDate: new Date().toISOString(),
            vehicle: v,
            contract: created,
          });
        }
        if (depositDzd > 0) {
          added.push({
            id: nextTempId(),
            txType: 'deposit_in',
            paymentMethod,
            amountDzd: Math.round(depositDzd),
            contractId: id,
            vehicleId,
            category: 'Caution',
            description: `Caution contrat ${created.contractNumber}`,
            txDate: new Date().toISOString(),
            vehicle: v,
            contract: created,
          });
        }
        return [...added, ...txs];
      });
    }
    recomputeDashboardAndVehiclesLocal();
    return { contract: created, nextContractNumber, tempId: id, queuedOffline: true };
  }

  const ctEditMatch = cleanUrl.match(/^\/api\/contracts\/(-?\d+)$/);
  if (ctEditMatch && upper === 'PUT') {
    const id = Number(ctEditMatch[1]);
    const ctSnap = loadSnapshotFromDb<{
      contracts: ContractItem[];
      nextContractNumber?: string;
    }>('/api/contracts') || { contracts: [] };
    const customers = loadSnapshotFromDb<{ customers: CustomerItem[] }>('/api/customers')?.customers || [];
    let updatedCt: ContractItem | undefined;
    const updatedList = ctSnap.contracts.map((ct) => {
      if (ct.id !== id) return ct;
      if (ct.status === 'cancelled') {
        throw new Error('Un contrat annulé ne peut plus être modifié');
      }
      const startAt = payload.startAt ? new Date(String(payload.startAt)) : new Date(ct.startAt);
      const endAt = payload.endAt ? new Date(String(payload.endAt)) : new Date(ct.endAt);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
        throw new Error('Dates de contrat invalides (retour postérieur au départ requis)');
      }
      const durationDays = calcDays(startAt, endAt);
      const totalAmountDzd = durationDays * ct.dailyPriceDzd;
      let nextNum = ct.contractNumber;
      if (payload.contractNumber !== undefined) {
        const candidate = String(payload.contractNumber ?? '').trim();
        if (!candidate) {
          throw new Error('Le numéro de contrat ne peut pas être vide.');
        }
        if (candidate.length > 64) {
          throw new Error('Le numéro de contrat ne doit pas dépasser 64 caractères.');
        }
        if (
          ctSnap.contracts.some(
            (other) =>
              other.id !== id &&
              String(other.contractNumber || '').trim().toLowerCase() === candidate.toLowerCase(),
          )
        ) {
          throw new Error('Ce numéro de contrat existe déjà. Veuillez saisir un numéro unique.');
        }
        nextNum = candidate;
      }
      const nextDriverCustomerId =
        payload.driverCustomerId !== undefined
          ? payload.driverCustomerId
            ? Number(payload.driverCustomerId)
            : null
          : (ct.driverCustomerId ?? null);
      const nextDc = nextDriverCustomerId
        ? customers.find((x) => x.id === nextDriverCustomerId) || null
        : null;
      if (payload.driverCustomerId !== undefined && nextDriverCustomerId && !nextDc) {
        throw new Error('Client conducteur introuvable');
      }
      const nextDcDob = nextDc
        ? [nextDc.dateOfBirth, nextDc.birthPlace].filter(Boolean).join(' · ')
        : '';

      updatedCt = {
        ...ct,
        contractNumber: nextNum,
        driverCustomerId: nextDriverCustomerId,
        driverCustomer: nextDc,
        driverName:
          payload.driverName !== undefined
            ? String(payload.driverName).trim()
            : nextDc
              ? nextDc.fullName
              : ct.driverName,
        driverDob:
          payload.driverDob !== undefined
            ? String(payload.driverDob).trim()
            : nextDc
              ? nextDcDob
              : ct.driverDob,
        driverIdNumber:
          payload.driverIdNumber !== undefined
            ? String(payload.driverIdNumber).trim()
            : nextDc
              ? nextDc.idNumber || ''
              : ct.driverIdNumber,
        driverLicenceNumber:
          payload.driverLicenceNumber !== undefined
            ? String(payload.driverLicenceNumber).trim()
            : nextDc
              ? nextDc.licenceNumber || ''
              : ct.driverLicenceNumber || '',
        driverCountry:
          payload.driverCountry !== undefined
            ? String(payload.driverCountry).trim()
            : nextDc
              ? nextDc.country || ''
              : ct.driverCountry,
        driverAddress:
          payload.driverAddress !== undefined
            ? String(payload.driverAddress).trim()
            : nextDc
              ? nextDc.address || ''
              : ct.driverAddress,
        driverPhone:
          payload.driverPhone !== undefined
            ? String(payload.driverPhone).trim()
            : nextDc
              ? nextDc.phone || ''
              : ct.driverPhone,
        pickupLocation: payload.pickupLocation !== undefined ? String(payload.pickupLocation).trim() || 'Blida' : ct.pickupLocation,
        returnLocation: payload.returnLocation !== undefined ? String(payload.returnLocation).trim() || 'Blida' : ct.returnLocation,
        departureFuelLevel: payload.departureFuelLevel !== undefined ? String(payload.departureFuelLevel) : ct.departureFuelLevel,
        departureNotes: payload.departureNotes !== undefined ? String(payload.departureNotes).trim() : ct.departureNotes,
        departureMileage:
          payload.departureMileage !== undefined ? Math.round(Number(payload.departureMileage)) : ct.departureMileage,
        maxMileageLimit:
          payload.maxMileageLimit !== undefined
            ? payload.maxMileageLimit === '' || payload.maxMileageLimit === null
              ? null
              : Math.max(0, Math.round(Number(payload.maxMileageLimit)))
            : (ct.maxMileageLimit ?? null),
        extensionFromDate:
          payload.extensionFromDate !== undefined
            ? String(payload.extensionFromDate).trim()
            : ct.extensionFromDate,
        extensionUntilDate:
          payload.extensionUntilDate !== undefined
            ? String(payload.extensionUntilDate).trim()
            : ct.extensionUntilDate,
        extensionExitTime:
          payload.extensionExitTime !== undefined
            ? String(payload.extensionExitTime).trim()
            : ct.extensionExitTime,
        extensionEntryTime:
          payload.extensionEntryTime !== undefined
            ? String(payload.extensionEntryTime).trim()
            : ct.extensionEntryTime,
        earlyReturnDate:
          payload.earlyReturnDate !== undefined
            ? String(payload.earlyReturnDate).trim()
            : ct.earlyReturnDate,
        earlyReturnTime:
          payload.earlyReturnTime !== undefined
            ? String(payload.earlyReturnTime).trim()
            : ct.earlyReturnTime,
        earlyReturnLocation:
          payload.earlyReturnLocation !== undefined
            ? String(payload.earlyReturnLocation).trim()
            : ct.earlyReturnLocation,
        depositDzd: payload.depositDzd !== undefined ? Math.round(Number(payload.depositDzd)) : ct.depositDzd,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        durationDays,
        totalAmountDzd,
        version: ct.version + 1,
      };
      return updatedCt;
    });
    const nextContractNumber = formatLocalContractNumber(
      computeNextLocalContractSeq(updatedList, ctSnap.nextContractNumber),
    );
    saveSnapshotToDb('/api/contracts', {
      nextContractNumber,
      contracts: updatedList,
    });
    recomputeDashboardAndVehiclesLocal();
    return { contract: updatedCt, queuedOffline: true };
  }

  const ctActionMatch = cleanUrl.match(/^\/api\/contracts\/(-?\d+)\/(confirm|activate|payment|extend)$/);
  if (ctActionMatch && upper === 'POST') {
    const id = Number(ctActionMatch[1]);
    const action = ctActionMatch[2];
    const ctSnap = loadSnapshotFromDb<{
      contracts: ContractItem[];
      nextContractNumber?: string;
    }>('/api/contracts') || { contracts: [] };
    const vehiclesSnap = loadSnapshotFromDb<{ vehicles: VehicleItem[] }>('/api/vehicles');
    const resSnap = loadSnapshotFromDb<{ reservations: ReservationItem[] }>('/api/reservations');
    let targetCt: ContractItem | undefined;
    const updated = ctSnap.contracts.map((ct) => {
      if (ct.id !== id) return ct;
      if (action === 'confirm') {
        if (isBlockingContractStatusLocal(ct.status) || ct.status === 'completed' || ct.status === 'cancelled') {
          throw new Error('Ce contrat est déjà confirmé ou clôturé');
        }
        const v = (vehiclesSnap?.vehicles || []).find((x) => x.id === ct.vehicleId);
        if (v && (v.manualStatus === 'maintenance' || v.computedStatus === 'maintenance')) {
          throw new Error('Véhicule en maintenance : confirmation impossible');
        }
        const startAt = new Date(ct.startAt);
        const endAt = new Date(ct.endAt);
        if (
          (resSnap?.reservations || []).some(
            (r) =>
              r.vehicleId === ct.vehicleId &&
              r.id !== ct.reservationId &&
              (r.status === 'pending' || r.status === 'confirmed') &&
              localDatesOverlap(new Date(r.startDate), new Date(r.endDate), startAt, endAt),
          ) ||
          ctSnap.contracts.some(
            (other) =>
              other.id !== ct.id &&
              other.vehicleId === ct.vehicleId &&
              isBlockingContractStatusLocal(other.status) &&
              localDatesOverlap(new Date(other.startAt), new Date(other.endAt), startAt, endAt),
          )
        ) {
          throw new Error('Ce véhicule est déjà réservé ou loué sur cette période');
        }
        targetCt = {
          ...ct,
          status: 'confirmed',
          confirmedAt: new Date().toISOString(),
          version: ct.version + 1,
        };
        return targetCt;
      }
      if (action === 'activate') {
        targetCt = { ...ct, status: 'active', version: ct.version + 1 };
        return targetCt;
      }
      if (action === 'payment') {
        const amt = Number(payload.amountDzd || 0);
        if (!Number.isFinite(amt) || amt <= 0) {
          throw new Error('Le montant du paiement doit être supérieur à 0 DZD');
        }
        targetCt = { ...ct, amountPaidDzd: ct.amountPaidDzd + Math.round(amt), version: ct.version + 1 };
        updateFinanceCache((txs) => [
          {
            id: nextTempId(),
            txType: 'rental_payment',
            paymentMethod: String(payload.paymentMethod || 'cash'),
            amountDzd: Math.round(amt),
            contractId: ct.id,
            vehicleId: ct.vehicleId,
            category: 'Location',
            description: `Complément paiement ${ct.contractNumber}`,
            txDate: new Date().toISOString(),
            vehicle: ct.vehicle,
            contract: targetCt,
          },
          ...txs,
        ]);
        return targetCt;
      }
      // extend
      const newEndAt = new Date(String(payload.newEndAt));
      if (Number.isNaN(newEndAt.getTime()) || newEndAt <= new Date(ct.endAt)) {
        throw new Error('La date de prolongation doit être postérieure au retour prévu');
      }
      const extraDays = calcDays(new Date(ct.endAt), newEndAt);
      const extraAmount = extraDays * ct.dailyPriceDzd;
      targetCt = {
        ...ct,
        extensionNumber: `EXT-${ct.contractNumber}`,
        extensionStartAt: ct.endAt,
        extensionEndAt: newEndAt.toISOString(),
        extensionDays: (ct.extensionDays || 0) + extraDays,
        endAt: newEndAt.toISOString(),
        durationDays: ct.durationDays + extraDays,
        totalAmountDzd: ct.totalAmountDzd + extraAmount,
        version: ct.version + 1,
      };
      return targetCt;
    });
    saveSnapshotToDb('/api/contracts', { ...ctSnap, contracts: updated });
    recomputeDashboardAndVehiclesLocal();
    return { contract: targetCt, queuedOffline: true };
  }

  const ctDelMatch = cleanUrl.match(/^\/api\/contracts\/(-?\d+)$/);
  if (ctDelMatch && upper === 'DELETE') {
    const id = Number(ctDelMatch[1]);
    const ctSnap = loadSnapshotFromDb<{
      contracts: ContractItem[];
      nextContractNumber?: string;
    }>('/api/contracts') || { contracts: [] };
    const existing = ctSnap.contracts.find((c) => c.id === id);
    if (existing && isBlockingContractStatusLocal(existing.status)) {
      throw new Error('Suppression impossible : ce contrat est confirmé en cours de location.');
    }
    const remainingContracts = ctSnap.contracts.filter((c) => c.id !== id);
    const nextContractNumber = formatLocalContractNumber(
      computeNextLocalContractSeq(remainingContracts, undefined),
    );
    saveSnapshotToDb('/api/contracts', {
      nextContractNumber,
      contracts: remainingContracts,
    });
    const retSnap = loadSnapshotFromDb<{ returns: ReturnItem[] }>('/api/returns');
    if (retSnap) {
      saveSnapshotToDb('/api/returns', {
        returns: retSnap.returns.filter((r) => r.contractId !== id),
      });
    }
    updateFinanceCache((txs) =>
      txs.map((t) => (t.contractId === id ? { ...t, contractId: null, contract: null } : t)),
    );
    if (existing?.reservationId && existing.status !== 'completed') {
      const resSnap = loadSnapshotFromDb<{ reservations: ReservationItem[] }>('/api/reservations');
      if (resSnap) {
        saveSnapshotToDb('/api/reservations', {
          reservations: resSnap.reservations.map((r) =>
            r.id === existing.reservationId ? { ...r, status: 'confirmed' } : r,
          ),
        });
      }
    }
    recomputeDashboardAndVehiclesLocal();
    return {
      ok: true,
      mode: 'deleted',
      message: 'Contrat supprimé définitivement (hors ligne).',
      queuedOffline: true,
    };
  }

  // 6. RETURNS
  if (cleanUrl === '/api/returns' && upper === 'POST') {
    const retId = ctx.tempId ?? nextTempId();
    const contractId = Number(payload.contractId);
    const ctSnap = loadSnapshotFromDb<{
      contracts: ContractItem[];
      nextContractNumber?: string;
    }>('/api/contracts') || { contracts: [] };
    const retSnap = loadSnapshotFromDb<{ returns: ReturnItem[] }>('/api/returns') || { returns: [] };
    const vehSnap = loadSnapshotFromDb<{ vehicles: VehicleItem[] }>('/api/vehicles') || { vehicles: [] };
    const ct = ctSnap.contracts.find((c) => c.id === contractId);
    if (!ct) throw new Error('Contrat introuvable en cache');
    if (ct.status === 'completed') throw new Error('Ce contrat a déjà été clôturé');
    if (!isBlockingContractStatusLocal(ct.status)) {
      throw new Error('Seul un contrat confirmé peut faire l’objet d’un retour véhicule');
    }

    const returnedAt = new Date(String(payload.returnedAt || new Date().toISOString()));
    const rawMileage = payload.returnMileage;
    const returnMileage =
      rawMileage !== undefined && rawMileage !== null && rawMileage !== ''
        ? Math.round(Number(rawMileage))
        : ct.departureMileage;
    if (!Number.isFinite(returnMileage) || returnMileage < ct.departureMileage) {
      throw new Error('Le kilométrage retour ne peut pas être inférieur au départ');
    }
    const diffMs = Math.max(0, returnedAt.getTime() - new Date(ct.endAt).getTime());
    const rawLateHours = Number((diffMs / 3600000).toFixed(2));
    const fullDays = Math.floor(rawLateHours / 24);
    const remHours = rawLateHours % 24;
    const remDayFactor = remHours > 6 ? 1 : remHours > 3 ? 0.5 : 0;
    const lateHours = diffMs > 0 ? Math.ceil(rawLateHours) : 0;
    const lateFeeDzd = Math.round((fullDays + remDayFactor) * ct.dailyPriceDzd);
    const allowedKm = Math.max(1, ct.durationDays) * 350;
    const drivenKm = Math.max(0, returnMileage - ct.departureMileage);
    const extraKm = Math.max(0, drivenKm - allowedKm);
    const extraKmFeeDzd = extraKm * 50;
    const damageFeeDzd = Number(payload.damageFeeDzd || 0);
    const fuelCleaningFeeDzd = Number(payload.fuelCleaningFeeDzd || 0);
    const totalAdditionalFeeDzd = lateFeeDzd + extraKmFeeDzd + damageFeeDzd + fuelCleaningFeeDzd;
    const collectedAmountDzd = Number(payload.collectedAmountDzd || 0);
    const refundDepositDzd = Number(payload.refundDepositDzd || 0);

    const newReturn: ReturnItem = {
      id: retId,
      contractId,
      vehicleId: ct.vehicleId,
      returnedAt: returnedAt.toISOString(),
      returnMileage,
      fuelLevel: String(payload.fuelLevel || ct.departureFuelLevel || '4/4'),
      conditionNotes: String(payload.conditionNotes || ''),
      damageMarkersJson: Array.isArray(payload.damageMarkers) ? (payload.damageMarkers as string[]) : [],
      lateHours,
      lateFeeDzd,
      allowedKm,
      drivenKm,
      extraKm,
      extraKmFeeDzd,
      damageFeeDzd,
      fuelCleaningFeeDzd,
      totalAdditionalFeeDzd,
      contract: ct,
      vehicle: ct.vehicle,
      customer: ct.customer,
    };

    saveSnapshotToDb('/api/returns', { returns: [newReturn, ...retSnap.returns] });
    saveSnapshotToDb('/api/contracts', {
      ...ctSnap,
      contracts: ctSnap.contracts.map((c) =>
        c.id === contractId
          ? {
              ...c,
              status: 'completed' as const,
              completedAt: returnedAt.toISOString(),
              totalAmountDzd: c.totalAmountDzd + totalAdditionalFeeDzd,
              amountPaidDzd: c.amountPaidDzd + collectedAmountDzd,
              returnRecord: newReturn,
              version: c.version + 1,
            }
          : c,
      ),
    });
    saveSnapshotToDb('/api/vehicles', {
      vehicles: vehSnap.vehicles.map((v) =>
        v.id === ct.vehicleId ? { ...v, currentMileage: returnMileage } : v,
      ),
    });
    if (collectedAmountDzd > 0 || refundDepositDzd > 0) {
      const paymentMethod = String(payload.paymentMethod || 'cash');
      updateFinanceCache((txs) => {
        const added: FinancialTransactionItem[] = [];
        if (collectedAmountDzd > 0) {
          added.push({
            id: nextTempId(),
            txType: totalAdditionalFeeDzd > 0 ? 'late_extra_fee' : 'rental_payment',
            paymentMethod,
            amountDzd: collectedAmountDzd,
            contractId,
            vehicleId: ct.vehicleId,
            category: 'Retour véhicule',
            description: `Règlement retour contrat ${ct.contractNumber}`,
            txDate: new Date().toISOString(),
          });
        }
        if (refundDepositDzd > 0) {
          added.push({
            id: nextTempId(),
            txType: 'deposit_refund',
            paymentMethod,
            amountDzd: refundDepositDzd,
            contractId,
            vehicleId: ct.vehicleId,
            category: 'Restitution caution',
            description: `Restitution caution ${ct.contractNumber}`,
            txDate: new Date().toISOString(),
          });
        }
        return [...added, ...txs];
      });
    }
    recomputeDashboardAndVehiclesLocal();
    return { returnRecord: newReturn, tempId: retId, queuedOffline: true };
  }

  // 7. MAINTENANCE
  if (cleanUrl === '/api/maintenance' && upper === 'POST') {
    const id = ctx.tempId ?? nextTempId();
    const maintSnap = loadSnapshotFromDb<{ records: MaintenanceItem[]; alerts: unknown[] }>('/api/maintenance') || { records: [], alerts: [] };
    const vehSnap = loadSnapshotFromDb<{ vehicles: VehicleItem[] }>('/api/vehicles') || { vehicles: [] };
    const vehicleId = Number(payload.vehicleId);
    const v = vehSnap.vehicles.find((x) => x.id === vehicleId) || null;
    const immediate = payload.markCompletedImmediately === true;
    const costDzd = Number(payload.costDzd || 0);
    const mileageAtService = Number(payload.mileageAtService ?? v?.currentMileage ?? 0);
    const created: MaintenanceItem = {
      id,
      vehicleId,
      maintenanceType: String(payload.maintenanceType || 'graissage'),
      maintenanceDate: String(payload.maintenanceDate || getTodayIso()),
      mileageAtService,
      nextServiceMileage: Number(payload.nextServiceMileage || mileageAtService + 10000),
      costDzd,
      notes: String(payload.notes || ''),
      status: immediate ? 'completed' : 'in_progress',
      completedAt: immediate ? new Date().toISOString() : null,
      vehicle: v,
    };
    saveSnapshotToDb('/api/maintenance', {
      ...maintSnap,
      records: [created, ...maintSnap.records],
    });
    saveSnapshotToDb('/api/vehicles', {
      vehicles: vehSnap.vehicles.map((x) =>
        x.id === vehicleId
          ? {
              ...x,
              currentMileage: Math.max(x.currentMileage, mileageAtService),
              manualStatus: immediate ? 'available' : 'maintenance',
            }
          : x,
      ),
    });
    if (immediate && costDzd > 0) {
      updateFinanceCache((txs) => [
        {
          id: nextTempId(),
          txType: 'expense',
          paymentMethod: 'cash',
          amountDzd: costDzd,
          contractId: null,
          vehicleId,
          category: 'Maintenance',
          description: `Entretien ${created.maintenanceType} · ${v?.registrationNumber || vehicleId}`,
          txDate: new Date().toISOString(),
        },
        ...txs,
      ]);
    }
    recomputeDashboardAndVehiclesLocal();
    return { record: created, tempId: id, queuedOffline: true };
  }

  const maintCompleteMatch = cleanUrl.match(/^\/api\/maintenance\/(-?\d+)\/complete$/);
  if (maintCompleteMatch && upper === 'POST') {
    const id = Number(maintCompleteMatch[1]);
    const maintSnap = loadSnapshotFromDb<{ records: MaintenanceItem[]; alerts: unknown[] }>('/api/maintenance') || { records: [], alerts: [] };
    const vehSnap = loadSnapshotFromDb<{ vehicles: VehicleItem[] }>('/api/vehicles') || { vehicles: [] };
    let targetRec: MaintenanceItem | undefined;
    const nextRecords = maintSnap.records.map((r) => {
      if (r.id !== id) return r;
      targetRec = {
        ...r,
        status: 'completed',
        costDzd: Number(payload.costDzd ?? r.costDzd),
        mileageAtService: Number(payload.mileageAtService ?? r.mileageAtService),
        completedAt: new Date().toISOString(),
      };
      return targetRec;
    });
    saveSnapshotToDb('/api/maintenance', { ...maintSnap, records: nextRecords });
    if (targetRec) {
      const otherOpen = nextRecords.some(
        (r) => r.vehicleId === targetRec!.vehicleId && r.status === 'in_progress',
      );
      saveSnapshotToDb('/api/vehicles', {
        vehicles: vehSnap.vehicles.map((v) =>
          v.id === targetRec!.vehicleId
            ? {
                ...v,
                currentMileage: Math.max(v.currentMileage, targetRec!.mileageAtService),
                manualStatus: otherOpen ? 'maintenance' : 'available',
              }
            : v,
        ),
      });
      if (targetRec.costDzd > 0) {
        updateFinanceCache((txs) => [
          {
            id: nextTempId(),
            txType: 'expense',
            paymentMethod: 'cash',
            amountDzd: targetRec!.costDzd,
            contractId: null,
            vehicleId: targetRec!.vehicleId,
            category: 'Maintenance',
            description: `Entretien ${targetRec!.maintenanceType}`,
            txDate: new Date().toISOString(),
          },
          ...txs,
        ]);
      }
    }
    recomputeDashboardAndVehiclesLocal();
    return { record: targetRec, queuedOffline: true };
  }

  const maintDelMatch = cleanUrl.match(/^\/api\/maintenance\/(-?\d+)$/);
  if (maintDelMatch && upper === 'DELETE') {
    const id = Number(maintDelMatch[1]);
    const maintSnap = loadSnapshotFromDb<{ records: MaintenanceItem[]; alerts: unknown[] }>('/api/maintenance') || { records: [], alerts: [] };
    const target = maintSnap.records.find((r) => r.id === id);
    const remaining = maintSnap.records.filter((r) => r.id !== id);
    saveSnapshotToDb('/api/maintenance', { ...maintSnap, records: remaining });
    if (target) {
      const otherOpen = remaining.some((r) => r.vehicleId === target.vehicleId && r.status === 'in_progress');
      const vehSnap = loadSnapshotFromDb<{ vehicles: VehicleItem[] }>('/api/vehicles');
      if (vehSnap) {
        saveSnapshotToDb('/api/vehicles', {
          vehicles: vehSnap.vehicles.map((v) =>
            v.id === target.vehicleId ? { ...v, manualStatus: otherOpen ? 'maintenance' : 'available' } : v,
          ),
        });
      }
    }
    recomputeDashboardAndVehiclesLocal();
    return { ok: true, mode: 'deleted', message: 'Entretien supprimé (hors ligne).', queuedOffline: true };
  }

  // 8. NOTIFICATIONS
  if (cleanUrl === '/api/notifications/read-all' && upper === 'POST') {
    const snap = loadSnapshotFromDb<{ notifications: NotificationItem[] }>('/api/notifications');
    if (snap) {
      saveSnapshotToDb('/api/notifications', {
        notifications: snap.notifications.map((n) => ({ ...n, isRead: true })),
      });
    }
    return { ok: true, queuedOffline: true };
  }
  const notifReadMatch = cleanUrl.match(/^\/api\/notifications\/(-?\d+)\/read$/);
  if (notifReadMatch && upper === 'POST') {
    const id = Number(notifReadMatch[1]);
    const snap = loadSnapshotFromDb<{ notifications: NotificationItem[] }>('/api/notifications');
    if (snap) {
      saveSnapshotToDb('/api/notifications', {
        notifications: snap.notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      });
    }
    return { ok: true, queuedOffline: true };
  }
  const notifDelMatch = cleanUrl.match(/^\/api\/notifications\/(-?\d+)$/);
  if (notifDelMatch && upper === 'DELETE') {
    const id = Number(notifDelMatch[1]);
    const snap = loadSnapshotFromDb<{ notifications: NotificationItem[] }>('/api/notifications');
    if (snap) {
      saveSnapshotToDb('/api/notifications', {
        notifications: snap.notifications.filter((n) => n.id !== id),
      });
    }
    return { ok: true, queuedOffline: true };
  }
  if (cleanUrl === '/api/notifications' && upper === 'DELETE') {
    saveSnapshotToDb('/api/notifications', { notifications: [] });
    return { ok: true, queuedOffline: true };
  }

  // 9. FINANCE & WITHDRAWALS
  if (cleanUrl === '/api/finance/transactions' && upper === 'POST') {
    const id = ctx.tempId ?? nextTempId();
    const created: FinancialTransactionItem = {
      id,
      txType: String(payload.txType || 'expense'),
      paymentMethod: String(payload.paymentMethod || 'cash'),
      amountDzd: Number(payload.amountDzd || 0),
      contractId: payload.contractId ? Number(payload.contractId) : null,
      vehicleId: payload.vehicleId ? Number(payload.vehicleId) : null,
      category: String(payload.category || 'Général'),
      description: String(payload.description || ''),
      txDate: new Date().toISOString(),
    };
    updateFinanceCache((txs) => [created, ...txs]);
    return { transaction: created, tempId: id, queuedOffline: true };
  }

  if (cleanUrl === '/api/finance/withdrawals' && upper === 'POST') {
    const finSnap = loadSnapshotFromDb<{ summary: FinanceSummary; transactions: FinancialTransactionItem[] }>(
      '/api/finance/transactions',
    );
    const currentBalance = finSnap?.summary?.cashBalance ?? 0;
    const resetToZero = payload.resetToZero === true;
    if (currentBalance <= 0) {
      throw new Error('Le solde disponible en caisse est déjà à 0 DZD.');
    }
    const withdrawAmount = resetToZero ? currentBalance : Math.round(Number(payload.amountDzd || 0));
    if (withdrawAmount <= 0 || withdrawAmount > currentBalance) {
      throw new Error('Montant de retrait invalide ou supérieur au solde.');
    }
    const id = ctx.tempId ?? nextTempId();
    const created: FinancialTransactionItem = {
      id,
      txType: 'cash_withdrawal',
      paymentMethod: String(payload.paymentMethod || 'cash'),
      amountDzd: withdrawAmount,
      contractId: null,
      vehicleId: null,
      category: resetToZero ? 'Remise à zéro caisse' : 'Retrait gérant',
      description:
        String(payload.notes || '').trim() ||
        (resetToZero
          ? `Retrait intégral et remise à zéro de la caisse (${withdrawAmount.toLocaleString('fr-FR')} DZD)`
          : 'Retrait d’espèces par le gérant'),
      txDate: new Date().toISOString(),
      createdByRole: 'manager',
    };
    const res = updateFinanceCache((txs) => [created, ...txs]);
    return { transaction: created, summary: res.summary, tempId: id, queuedOffline: true };
  }

  const finDelMatch = cleanUrl.match(/^\/api\/finance\/transactions\/(-?\d+)$/);
  if (finDelMatch && upper === 'DELETE') {
    const id = Number(finDelMatch[1]);
    updateFinanceCache((txs) => txs.filter((t) => t.id !== id));
    return { ok: true, mode: 'archived', message: 'Écriture archivée (hors ligne).', queuedOffline: true };
  }

  // 10. SETTINGS & PERMISSIONS
  if (cleanUrl === '/api/settings/permissions' && upper === 'PUT') {
    const current = loadSnapshotFromDb<{ permissions: DeletePermissions }>('/api/settings/permissions')?.permissions;
    const next = { ...(current || {}), ...payload } as DeletePermissions;
    saveSnapshotToDb('/api/settings/permissions', { permissions: next });
    return { permissions: next, queuedOffline: true };
  }

  return { queuedOffline: true };
}
