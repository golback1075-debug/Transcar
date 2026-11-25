import React, { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { TRANSLATIONS, type Lang } from '../../i18n/translations.ts';
import { apiFetch, formatDzd } from '../../lib/api.ts';

interface VehiclePerfRow {
  vehicleId: number;
  brand: string;
  model: string;
  registrationNumber: string;
  rentedDays: number;
  revenueDzd: number;
  maintenanceExpenseDzd: number;
  netProfitDzd: number;
  maintenanceCount: number;
}

interface ReportResponse {
  period: string;
  summary: {
    revenueDzd: number;
    expensesDzd: number;
    netProfitDzd: number;
    outstandingPaymentsDzd: number;
  };
  vehiclePerformance: VehiclePerfRow[];
}

interface Props {
  lang: Lang;
}

export const FinancialReportsView: React.FC<Props> = ({ lang }) => {
  const t = TRANSLATIONS[lang];
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'annual'>('monthly');
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadReport = async (selectedPeriod: typeof period) => {
    setLoading(true);
    try {
      const data = await apiFetch<ReportResponse>(
        `/api/reports/financial?period=${selectedPeriod}`,
      );
      setReport(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport(period);
  }, [period]);

  const handleExportExcel = () => {
    if (!report) return;
    const rows = report.vehiclePerformance.map((v) => ({
      Véhicule: `${v.brand} ${v.model}`,
      Matricule: v.registrationNumber,
      'Jours loués': v.rentedDays,
      'Revenus (DZD)': v.revenueDzd,
      'Entretien / Dépenses (DZD)': v.maintenanceExpenseDzd,
      'Bénéfice net (DZD)': v.netProfitDzd,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, `TRANSCAR_${period}`);
    XLSX.writeFile(wb, `TRANSCAR-Rapport-${period}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleExportPdf = () => {
    if (!report) return;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`TRANSCAR Blida — Rapport Financier (${period.toUpperCase()})`, 14, 18);
    doc.setFontSize(11);
    doc.text(`Chiffre d'affaires : ${formatDzd(report.summary.revenueDzd)}`, 14, 28);
    doc.text(`Dépenses totales : ${formatDzd(report.summary.expensesDzd)}`, 14, 35);
    doc.text(`Bénéfice net : ${formatDzd(report.summary.netProfitDzd)}`, 14, 42);
    doc.text(
      `Paiements en attente : ${formatDzd(report.summary.outstandingPaymentsDzd)}`,
      14,
      49,
    );

    let y = 62;
    doc.setFontSize(10);
    doc.text('Vehicule | Matricule | Jours | Revenus | Entretien | Net', 14, y);
    y += 7;
    for (const v of report.vehiclePerformance) {
      doc.text(
        `${v.brand} ${v.model} | ${v.registrationNumber} | ${v.rentedDays}j | ${v.revenueDzd} | ${v.maintenanceExpenseDzd} | ${v.netProfitDzd} DZD`,
        14,
        y,
      );
      y += 6;
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
    }
    doc.save(`TRANSCAR-Rapport-${period}-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const s = report?.summary || {
    revenueDzd: 0,
    expensesDzd: 0,
    netProfitDzd: 0,
    outstandingPaymentsDzd: 0,
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Period Tabs & Export Actions */}
      <section className="no-print bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2" role="tablist">
          {(
            [
              { id: 'daily', label: t.periodDaily },
              { id: 'weekly', label: t.periodWeekly },
              { id: 'monthly', label: t.periodMonthly },
              { id: 'annual', label: t.periodAnnual },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={period === tab.id}
              onClick={() => setPeriod(tab.id)}
              className={`px-3.5 py-2 rounded font-label text-[13px] font-semibold cursor-pointer ${
                period === tab.id
                  ? 'bg-[#111114] text-white'
                  : 'bg-[#F6F2F7] text-[#1B1B1E] hover:bg-[#F0EDF1]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded border border-[#E4BEB9] bg-white text-[#1B1B1E] hover:bg-[#F6F2F7] font-label text-[13px] font-semibold cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">print</span>
            {t.printReport}
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-2 px-4 py-2 rounded border border-[#E4BEB9] bg-white text-[#1B1B1E] hover:bg-[#F6F2F7] font-label text-[13px] font-semibold cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">table_view</span>
            {t.exportExcel}
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="inline-flex items-center gap-2 px-4 py-2 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] font-label text-[13px] font-semibold cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
            {t.exportPdf}
          </button>
        </div>
      </section>

      {/* P&L KPI Summary */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <article className="bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-col gap-1">
          <span className="font-label text-[11px] font-semibold text-[#5B403D]">
            Chiffre d'affaires
          </span>
          <span className="font-headline text-[18px] font-bold text-[#1B1B1E] tabular-nums">
            {formatDzd(s.revenueDzd)}
          </span>
        </article>
        <article className="bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-col gap-1">
          <span className="font-label text-[11px] font-semibold text-[#5B403D]">
            Dépenses totales
          </span>
          <span className="font-headline text-[18px] font-bold text-[#BA1A1A] tabular-nums">
            {formatDzd(s.expensesDzd)}
          </span>
        </article>
        <article className="bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-col gap-1">
          <span className="font-label text-[11px] font-semibold text-[#5B403D]">Bénéfice net</span>
          <span className="font-headline text-[18px] font-bold text-[#15803D] tabular-nums">
            {formatDzd(s.netProfitDzd)}
          </span>
        </article>
        <article className="bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-col gap-1">
          <span className="font-label text-[11px] font-semibold text-[#5B403D]">
            Paiements en attente
          </span>
          <span className="font-headline text-[18px] font-bold text-[#B45309] tabular-nums">
            {formatDzd(s.outstandingPaymentsDzd)}
          </span>
        </article>
      </section>

      {/* Vehicle Rental Performance Table */}
      <section className="bg-white border border-[#E4BEB9] rounded-lg overflow-hidden">
        <header className="px-4 py-4 border-b border-[#E4BEB9] flex items-center justify-between gap-2">
          <h2 className="font-title text-[18px] font-semibold text-[#1B1B1E]">
            Rentabilité par véhicule
          </h2>
          <span className="text-[12px] text-[#5B403D]">
            {report?.vehiclePerformance.length || 0} véhicules
          </span>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#F6F2F7] border-b border-[#E4BEB9]">
              <tr>
                <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase">
                  Véhicule
                </th>
                <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase">
                  Jours loués
                </th>
                <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase">
                  Revenus
                </th>
                <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase">
                  Entretien
                </th>
                <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase text-right">
                  Bénéfice net
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4BEB9]">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[13px] text-[#5B403D]">
                    Chargement...
                  </td>
                </tr>
              ) : (report?.vehiclePerformance || []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[13px] text-[#5B403D]">
                    Aucune donnée véhicule enregistrée pour cette période.
                  </td>
                </tr>
              ) : (
                report?.vehiclePerformance.map((v) => (
                  <tr key={v.vehicleId} className="hover:bg-[#F6F2F7]">
                    <td className="px-4 py-3.5">
                      <span className="font-title text-[15px] font-semibold text-[#1B1B1E] block">
                        {v.brand} {v.model}
                      </span>
                      <span className="font-mono text-[13px] text-[#5B403D] tabular-nums">
                        {v.registrationNumber}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 tabular-nums text-[13px]">{v.rentedDays} jours</td>
                    <td className="px-4 py-3.5 tabular-nums font-mono text-[13px]">
                      {formatDzd(v.revenueDzd)}
                    </td>
                    <td className="px-4 py-3.5 tabular-nums font-mono text-[13px] text-[#BA1A1A]">
                      {formatDzd(v.maintenanceExpenseDzd)}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums font-mono text-[13px] font-semibold text-[#15803D]">
                      {formatDzd(v.netProfitDzd)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
