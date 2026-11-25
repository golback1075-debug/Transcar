import React from 'react';
import { TRANSLATIONS, type Lang } from '../../i18n/translations.ts';
import { formatDateTime, formatDzd } from '../../lib/api.ts';
import type { ContractItem, NotificationItem } from '../../types.ts';

interface DashboardData {
  stats: {
    totalVehicles: number;
    availableVehicles: number;
    reservedVehicles: number;
    rentedVehicles: number;
    maintenanceVehicles: number;
    totalCustomers: number;
    activeRentals: number;
    overdueReturns: number;
    todayReservations: number;
    todayReturns: number;
    upcomingReturns: number;
    maintenanceAlerts: number;
    documentExpiryAlerts: number;
    unreadNotifications: number;
  };
  recentContracts: ContractItem[];
  financeSummary: {
    dailyRevenue: number;
    monthlyRevenue: number;
    totalRevenue: number;
    totalExpenses: number;
    netProfit: number;
    cashBalance: number;
  } | null;
}

interface Props {
  lang: Lang;
  role: 'manager' | 'employee';
  data: DashboardData | null;
  notifications: NotificationItem[];
  onNavigate: (tab: string) => void;
}

export const DashboardView: React.FC<Props> = ({
  lang,
  role,
  data,
  notifications,
  onNavigate,
}) => {
  const t = TRANSLATIONS[lang];
  const s = data?.stats || {
    totalVehicles: 0,
    availableVehicles: 0,
    reservedVehicles: 0,
    rentedVehicles: 0,
    maintenanceVehicles: 0,
    totalCustomers: 0,
    activeRentals: 0,
    overdueReturns: 0,
    todayReservations: 0,
    todayReturns: 0,
    upcomingReturns: 0,
    maintenanceAlerts: 0,
    documentExpiryAlerts: 0,
    unreadNotifications: 0,
  };

  const f = data?.financeSummary;
  const activeAlerts = notifications.filter((n) => !n.isRead).slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      {/* Fleet & Operations KPIs */}
      <section aria-labelledby="fleet-kpis-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="fleet-kpis-heading" className="font-title text-[18px] font-semibold text-[#1B1B1E]">
            {t.fleetOpsTitle}
          </h2>
          <span className="text-[13px] text-[#5B403D] tabular-nums">
            {s.totalCustomers} {t.totalCustomers} · {s.activeRentals} {t.activeContracts} ·{' '}
            {s.todayReservations} {t.todayReservations}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-stretch">
          <article className="bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-col justify-between gap-2">
            <header className="flex items-center justify-between gap-2">
              <span className="font-label text-[11px] font-semibold text-[#5B403D]">
                {t.totalVehicles}
              </span>
              <span className="material-symbols-outlined text-[20px] text-[#1B1B1E]">
                directions_car
              </span>
            </header>
            <div>
              <p className="font-headline text-[28px] font-bold text-[#1B1B1E] tabular-nums">
                {s.totalVehicles}
              </p>
              <p className="text-[12px] text-[#5B403D]">{t.navFleet}</p>
            </div>
          </article>

          <article className="bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-col justify-between gap-2">
            <header className="flex items-center justify-between gap-2">
              <span className="font-label text-[11px] font-semibold text-[#5B403D]">
                {t.availableVehicles}
              </span>
              <span className="material-symbols-outlined text-[20px] text-[#15803D]">
                check_circle
              </span>
            </header>
            <div>
              <p className="font-headline text-[28px] font-bold text-[#15803D] tabular-nums">
                {s.availableVehicles}
              </p>
              <p className="text-[12px] text-[#5B403D]">{t.statusAvailable}</p>
            </div>
          </article>

          <article className="bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-col justify-between gap-2">
            <header className="flex items-center justify-between gap-2">
              <span className="font-label text-[11px] font-semibold text-[#5B403D]">
                {t.reservedVehicles}
              </span>
              <span className="material-symbols-outlined text-[20px] text-[#BA1A1A]">
                event_busy
              </span>
            </header>
            <div>
              <p className="font-headline text-[28px] font-bold text-[#BA1A1A] tabular-nums">
                {s.reservedVehicles}
              </p>
              <p className="text-[12px] text-[#5B403D]">
                {s.todayReservations} {t.todayReservations}
              </p>
            </div>
          </article>

          <article className="bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-col justify-between gap-2">
            <header className="flex items-center justify-between gap-2">
              <span className="font-label text-[11px] font-semibold text-[#5B403D]">
                {t.rentedVehicles}
              </span>
              <span className="material-symbols-outlined text-[20px] text-[#93000B]">
                car_rental
              </span>
            </header>
            <div>
              <p className="font-headline text-[28px] font-bold text-[#93000B] tabular-nums">
                {s.rentedVehicles}
              </p>
              <p className="text-[12px] text-[#5B403D]">
                {s.todayReturns} {t.todayReturns} · {s.upcomingReturns} {t.upcomingReturns}
              </p>
            </div>
          </article>

          <article className="bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-col justify-between gap-2">
            <header className="flex items-center justify-between gap-2">
              <span className="font-label text-[11px] font-semibold text-[#5B403D]">
                {t.maintenanceVehicles}
              </span>
              <span className="material-symbols-outlined text-[20px] text-[#B45309]">
                build_circle
              </span>
            </header>
            <div>
              <p className="font-headline text-[28px] font-bold text-[#BA1A1A] tabular-nums">
                {s.maintenanceVehicles}
              </p>
              <p className="text-[12px] text-[#5B403D]">
                {s.maintenanceAlerts} alertes · {s.documentExpiryAlerts} docs
              </p>
            </div>
          </article>
        </div>
      </section>

      {/* Manager-Only Financial Overview */}
      {role === 'manager' && (
        <section
          aria-labelledby="finance-kpis-heading"
          className="bg-[#111114] text-white rounded-xl p-6 flex flex-col gap-4"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-[#B91C1C]">lock</span>
              <h2 id="finance-kpis-heading" className="font-title text-[18px] font-semibold">
                {t.financeOnlyHeader}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('cash')}
              className="text-[12px] font-semibold text-[#FFCDC7] hover:underline cursor-pointer"
            >
              {t.navCash}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="p-4 rounded-lg bg-[#303033] flex flex-col gap-1">
              <span className="text-[11px] text-[#DCD9DD]">{t.dailyRevenue}</span>
              <span className="font-headline text-[18px] font-bold tabular-nums">
                {formatDzd(f?.dailyRevenue)}
              </span>
            </div>
            <div className="p-4 rounded-lg bg-[#303033] flex flex-col gap-1">
              <span className="text-[11px] text-[#DCD9DD]">{t.monthlyRevenue}</span>
              <span className="font-headline text-[18px] font-bold tabular-nums">
                {formatDzd(f?.monthlyRevenue)}
              </span>
            </div>
            <div className="p-4 rounded-lg bg-[#303033] flex flex-col gap-1">
              <span className="text-[11px] text-[#DCD9DD]">{t.expenses}</span>
              <span className="font-headline text-[18px] font-bold text-[#FFCDC7] tabular-nums">
                {formatDzd(f?.totalExpenses)}
              </span>
            </div>
            <div className="p-4 rounded-lg bg-[#303033] flex flex-col gap-1">
              <span className="text-[11px] text-[#DCD9DD]">{t.netProfit}</span>
              <span className="font-headline text-[18px] font-bold tabular-nums">
                {formatDzd(f?.netProfit)}
              </span>
            </div>
            <div className="p-4 rounded-lg bg-[#93000B] flex flex-col gap-1">
              <span className="text-[11px] text-[#FFCDC7]">{t.cashBalance}</span>
              <span className="font-headline text-[18px] font-bold text-white tabular-nums">
                {formatDzd(f?.cashBalance)}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Two-Column Split: Alerts + Recent Contracts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-5 bg-white border border-[#E4BEB9] rounded-lg p-6 flex flex-col gap-4">
          <header className="flex items-center justify-between gap-2">
            <h2 className="font-title text-[18px] font-semibold text-[#1B1B1E]">
              {t.activeAlerts}
            </h2>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[#FFDAD6] text-[#93000A] font-label text-[11px] font-semibold tabular-nums">
              {activeAlerts.length}
            </span>
          </header>

          {activeAlerts.length === 0 ? (
            <p className="text-[13px] text-[#5B403D] py-6 text-center">{t.noAlerts}</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {activeAlerts.map((n) => (
                <div
                  key={n.id}
                  className={`p-3 rounded-lg border border-[#E4BEB9] flex items-start justify-between gap-3 ${
                    n.severity === 'urgent'
                      ? 'bg-[#FFDAD6] text-[#93000A]'
                      : n.severity === 'warning'
                        ? 'bg-[#FEF3C7] text-[#78350F]'
                        : 'bg-[#F6F2F7] text-[#1B1B1E]'
                  }`}
                >
                  <div className="min-w-0">
                    <span className="font-label text-[13px] font-semibold block">{n.title}</span>
                    <span className="text-[12px] block">{n.message}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="lg:col-span-7 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-title text-[18px] font-semibold text-[#1B1B1E]">
              {t.todayTableTitle}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('contracts')}
              className="font-label text-[13px] font-semibold text-[#93000B] hover:underline cursor-pointer"
            >
              {t.viewAllContracts}
            </button>
          </div>

          <div className="bg-white border border-[#E4BEB9] rounded-lg overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#F6F2F7] border-b border-[#E4BEB9]">
                <tr>
                  <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase">
                    Contrat
                  </th>
                  <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase">
                    Échéance
                  </th>
                  <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase text-right">
                    Statut
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4BEB9]">
                {(data?.recentContracts || []).length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-[13px] text-[#5B403D]">
                      Aucun contrat enregistré.
                    </td>
                  </tr>
                ) : (
                  (data?.recentContracts || []).map((c) => (
                    <tr key={c.id} className="hover:bg-[#F6F2F7]">
                      <td className="px-4 py-3">
                        <span className="font-mono text-[13px] font-semibold text-[#1B1B1E] block">
                          {c.contractNumber}
                        </span>
                        <span className="text-[12px] text-[#5B403D] tabular-nums">
                          {formatDzd(c.totalAmountDzd)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] tabular-nums">
                        {formatDateTime(c.endAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full font-label text-[11px] font-semibold ${
                            c.status === 'completed'
                              ? 'bg-[#DCFCE7] text-[#14532D]'
                              : c.status === 'confirmed' || c.status === 'active'
                                ? 'bg-[#DBEAFE] text-[#1E3A8A]'
                                : 'bg-[#FEF3C7] text-[#78350F]'
                          }`}
                        >
                          {c.status === 'completed'
                            ? t.navCompleted
                            : c.status === 'confirmed' || c.status === 'active'
                              ? lang === 'ar'
                                ? 'مؤكد'
                                : lang === 'en'
                                  ? 'Confirmed'
                                  : 'Confirmé'
                              : lang === 'ar'
                                ? 'بانتظار التأكيد'
                                : lang === 'en'
                                  ? 'Pending'
                                  : 'À confirmer'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
