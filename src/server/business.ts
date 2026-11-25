export const MAINTENANCE_INTERVALS: Record<
  'graissage' | 'bougies' | 'kit_chaine',
  { intervalKm: number; warnWithinKm: number }
> = {
  graissage: { intervalKm: 10000, warnWithinKm: 1000 },
  bougies: { intervalKm: 25000, warnWithinKm: 2000 },
  kit_chaine: { intervalKm: 50000, warnWithinKm: 3000 },
};

export function getAlgiersTodayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Algiers',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function computeDocumentStatus(expiryDateStr: string | null | undefined) {
  if (!expiryDateStr) {
    return {
      status: 'permanent' as const,
      color: 'green' as const,
      remainingDays: null,
    };
  }
  const todayIso = getAlgiersTodayIso();
  const todayDate = new Date(`${todayIso}T00:00:00Z`);
  const expiryDate = new Date(`${expiryDateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(expiryDate.getTime())) {
    return {
      status: 'valid' as const,
      color: 'green' as const,
      remainingDays: null,
    };
  }
  const remainingDays = Math.round(
    (expiryDate.getTime() - todayDate.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (remainingDays < 0) {
    return {
      status: 'expired' as const,
      color: 'red' as const,
      remainingDays,
    };
  }
  if (remainingDays <= 30) {
    return {
      status: 'approaching' as const,
      color: 'orange' as const,
      remainingDays,
    };
  }
  return {
    status: 'valid' as const,
    color: 'green' as const,
    remainingDays,
  };
}

export function computeDefaultExpiryOneYear(issueDateStr: string): string {
  const base = new Date(`${issueDateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return '';
  base.setUTCFullYear(base.getUTCFullYear() + 1);
  return base.toISOString().slice(0, 10);
}

/**
 * Official Article 01 Late Return Calculation:
 * - First 3 hours: grace period (0)
 * - > 3 hours and <= 6 hours: +0.5 day
 * - > 6 hours: +1 full day (per 24h bracket + remainder rule)
 */
export function calculateLateReturnCharges(
  scheduledEndAt: Date,
  actualReturnedAt: Date,
  dailyPriceDzd: number,
) {
  const diffMs = actualReturnedAt.getTime() - scheduledEndAt.getTime();
  if (diffMs <= 0) {
    return { lateHours: 0, lateDaysEquivalent: 0, lateFeeDzd: 0 };
  }
  const lateHours = Number((diffMs / (1000 * 60 * 60)).toFixed(2));
  const fullDays = Math.floor(lateHours / 24);
  const remHours = lateHours % 24;

  let remDayFactor = 0;
  if (remHours > 6) {
    remDayFactor = 1;
  } else if (remHours > 3) {
    remDayFactor = 0.5;
  }

  const lateDaysEquivalent = fullDays + remDayFactor;
  const lateFeeDzd = Math.round(lateDaysEquivalent * dailyPriceDzd);
  return {
    lateHours: Math.ceil(lateHours),
    lateDaysEquivalent,
    lateFeeDzd,
  };
}

/**
 * Official Article 02 Distance Calculation:
 * - Allowed distance: 350 km per 24 hours
 * - Extra km price: 50 DZD per km
 */
export function calculateDistanceCharges(
  durationDays: number,
  departureMileage: number,
  returnMileage: number,
) {
  const effectiveDays = Math.max(1, durationDays);
  const allowedKm = effectiveDays * 350;
  const drivenKm = Math.max(0, returnMileage - departureMileage);
  const extraKm = Math.max(0, drivenKm - allowedKm);
  const extraKmFeeDzd = extraKm * 50;
  return {
    allowedKm,
    drivenKm,
    extraKm,
    extraKmFeeDzd,
  };
}

export function calculateDurationDays(startAt: Date, endAt: Date): number {
  const diffMs = endAt.getTime() - startAt.getTime();
  if (diffMs <= 0) return 1;
  return Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

export function datesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

export function getMaintenanceAlertsForVehicle(
  currentMileage: number,
  history: Array<{ maintenanceType: string; mileageAtService: number; nextServiceMileage: number; status: string }>,
) {
  const types: Array<'graissage' | 'bougies' | 'kit_chaine'> = [
    'graissage',
    'bougies',
    'kit_chaine',
  ];
  return types.map((type) => {
    const cfg = MAINTENANCE_INTERVALS[type];
    const latestCompleted = history
      .filter((h) => h.maintenanceType === type && h.status === 'completed')
      .sort((a, b) => b.mileageAtService - a.mileageAtService)[0];
    const inProgress = history.find(
      (h) => h.maintenanceType === type && h.status === 'in_progress',
    );
    const nextServiceMileage = latestCompleted
      ? latestCompleted.nextServiceMileage
      : Math.ceil((currentMileage + 1) / cfg.intervalKm) * cfg.intervalKm;
    const remainingKm = nextServiceMileage - currentMileage;

    let state: 'in_progress' | 'overdue' | 'approaching' | 'ok' = 'ok';
    if (inProgress) {
      state = 'in_progress';
    } else if (remainingKm <= 0) {
      state = 'overdue';
    } else if (remainingKm <= cfg.warnWithinKm) {
      state = 'approaching';
    }

    return {
      maintenanceType: type,
      intervalKm: cfg.intervalKm,
      currentMileage,
      lastServiceMileage: latestCompleted?.mileageAtService ?? null,
      nextServiceMileage,
      remainingKm,
      state,
    };
  });
}
