import React, { useEffect, useState } from 'react';
import { TRANSLATIONS, type Lang } from '../i18n/translations.ts';
import { formatDate, formatDzd, triggerPdfPrint } from '../lib/api.ts';
import { triggerOnePagePrint } from '../lib/printFit.ts';
import type { PublicDigitalContractPayload } from '../types.ts';
import { OfficialContractSheet } from './OfficialContractSheet.tsx';

interface DigitalContractPortalProps {
  token: string;
  initialLang: Lang;
  onChangeLang: (lang: Lang) => void;
  onOpenBookingSite: () => void;
  onOpenAgencyLogin: () => void;
}

export const DigitalContractPortal: React.FC<DigitalContractPortalProps> = ({
  token,
  initialLang,
  onChangeLang,
  onOpenBookingSite,
  onOpenAgencyLogin,
}) => {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [sheetLang, setSheetLang] = useState<'ar' | 'fr'>(initialLang === 'ar' ? 'ar' : 'fr');
  const [payload, setPayload] = useState<PublicDigitalContractPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [showConditions, setShowConditions] = useState(false);

  const t = TRANSLATIONS[lang];

  const handleLangSwitch = (next: Lang) => {
    setLang(next);
    onChangeLang(next);
    if (next === 'ar' || next === 'fr') {
      setSheetLang(next);
    }
  };

  useEffect(() => {
    let active = true;
    const loadContract = async () => {
      setLoading(true);
      setErrorMsg('');
      try {
        const res = await fetch(`/api/public/contract-access/${encodeURIComponent(token)}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          throw new Error(t.digitalContractNotFound);
        }
        const data = (await res.json()) as PublicDigitalContractPayload;
        if (active) {
          setPayload(data);
        }
      } catch (err) {
        if (active) {
          setPayload(null);
          setErrorMsg(err instanceof Error && err.message ? err.message : t.digitalContractNotFound);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void loadContract();
    return () => {
      active = false;
    };
  }, [token]);

  const contract = payload?.contract;
  const remainingDzd = contract
    ? Math.max(0, contract.totalAmountDzd - contract.amountPaidDzd)
    : 0;

  const statusMeta = (status?: string) => {
    if (status === 'completed') {
      return {
        label: lang === 'ar' ? 'منتهي' : lang === 'en' ? 'Completed' : 'Terminé',
        icon: 'task_alt',
        cls: 'bg-[#DCFCE7] text-[#14532D] border-[#15803D]/25',
      };
    }
    if (status === 'confirmed' || status === 'active') {
      return {
        label: lang === 'ar' ? 'مؤكد' : lang === 'en' ? 'Confirmed' : 'Confirmé',
        icon: 'verified',
        cls: 'bg-[#F0FDF4] text-[#15803D] border-[#15803D]/30',
      };
    }
    if (status === 'pending' || status === 'upcoming') {
      return {
        label:
          lang === 'ar'
            ? 'بانتظار التأكيد'
            : lang === 'en'
              ? 'Pending Confirmation'
              : 'En attente de confirmation',
        icon: 'schedule',
        cls: 'bg-[#FEF3C7] text-[#78350F] border-[#B45309]/25',
      };
    }
    if (status === 'cancelled') {
      return {
        label: lang === 'ar' ? 'ملغى' : lang === 'en' ? 'Cancelled' : 'Annulé',
        icon: 'cancel',
        cls: 'bg-[#FFDAD6] text-[#93000A] border-[#BA1A1A]/25',
      };
    }
    return {
      label: lang === 'ar' ? 'نشط' : lang === 'en' ? 'Active' : 'Actif',
      icon: 'verified',
      cls: 'bg-[#F0FDF4] text-[#15803D] border-[#15803D]/30',
    };
  };

  return (
    <div
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      className="app-print-shell min-h-screen bg-[#FBF8FC] text-[#1B1B1E] flex flex-col"
    >
      {/* Top Bar */}
      <header className="no-print sticky top-0 z-30 bg-[#111114]/95 backdrop-blur-md text-white border-b border-[#303033] px-4 sm:px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <a
            href="/book"
            onClick={(e) => {
              e.preventDefault();
              onOpenBookingSite();
            }}
            className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            TRANSCAR
          </a>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="flex items-center rounded border border-[#303033] overflow-hidden bg-[#1D1D22]">
              {(['fr', 'ar', 'en'] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => handleLangSwitch(code)}
                  className={`min-h-[38px] px-2.5 py-1.5 font-mono text-[12px] font-semibold uppercase cursor-pointer whitespace-nowrap shrink-0 ${
                    lang === code
                      ? 'bg-[#93000B] text-white'
                      : 'text-[#DCD9DD] hover:bg-[#303033]'
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>

            {contract && (
              <button
                type="button"
                onClick={() => triggerOnePagePrint()}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#93000B] hover:bg-[#B91C1C] text-white text-[13px] font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                <span className="material-symbols-outlined text-[18px]">print</span>
                <span>{t.printContract}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="app-print-main flex-1 px-4 sm:px-6 py-6 max-w-6xl w-full mx-auto flex flex-col gap-6">
        {loading ? (
          <div className="no-print bg-white border border-[#E4BEB9] rounded-xl p-10 text-center flex flex-col items-center gap-3">
            <span className="material-symbols-outlined text-[36px] text-[#93000B] animate-spin">
              progress_activity
            </span>
            <p className="text-[15px] font-semibold text-[#1B1B1E]">{t.digitalContractLoading}</p>
          </div>
        ) : !contract || !payload ? (
          <div className="no-print bg-white border border-[#E4BEB9] rounded-xl p-8 max-w-xl mx-auto text-center flex flex-col items-center gap-4">
            <span className="material-symbols-outlined text-[42px] text-[#BA1A1A]">
              qr_code_2
            </span>
            <h1 className="font-headline text-[20px] font-bold text-[#1B1B1E]">
              {t.digitalContractTitle}
            </h1>
            <p className="text-[14px] text-[#5B403D]">
              {errorMsg || t.digitalContractNotFound}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={onOpenBookingSite}
                className="min-h-[44px] px-5 py-2.5 rounded-lg bg-[#93000B] text-white text-[13px] font-semibold hover:bg-[#B91C1C] cursor-pointer whitespace-nowrap shrink-0"
              >
                {t.openPublicSite}
              </button>
              <button
                type="button"
                onClick={onOpenAgencyLogin}
                className="min-h-[44px] px-5 py-2.5 rounded-lg border border-[#E4BEB9] text-[#1B1B1E] text-[13px] font-semibold hover:bg-[#F6F2F7] cursor-pointer whitespace-nowrap shrink-0"
              >
                {t.backToAdmin}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Digital Summary Header */}
            <section className="no-print bg-white border border-[#E4BEB9] rounded-xl p-5 sm:p-6 flex flex-col gap-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E4BEB9] pb-4">
                <div>
                  <div className="flex items-center gap-2 text-[12px] text-[#5B403D]">
                    <span>{t.digitalContractSubtitle}</span>
                    <span aria-hidden="true">·</span>
                    <span>{payload.agency.address}</span>
                  </div>
                  <h1 className="font-headline text-[22px] sm:text-[26px] font-bold text-[#1B1B1E] mt-1">
                    {t.digitalContractTitle} ·{' '}
                    <span dir="ltr" className="font-mono text-[#93000B]">
                      {contract.contractNumber}
                    </span>
                  </h1>
                </div>

                {(() => {
                  const st = statusMeta(contract.status);
                  return (
                    <div
                      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border text-[13px] font-bold shrink-0 self-start sm:self-auto ${st.cls}`}
                    >
                      <span className="material-symbols-outlined text-[18px]">{st.icon}</span>
                      <span>{st.label}</span>
                    </div>
                  );
                })()}
              </div>

              {/* Key Digital Metrics Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-3.5 rounded-lg bg-[#F6F2F7] border border-[#E4BEB9]/70 flex flex-col gap-1">
                  <span className="text-[12px] text-[#5B403D]">
                    {lang === 'ar' ? 'المركبة' : lang === 'en' ? 'Vehicle' : 'Véhicule'}
                  </span>
                  <span className="font-bold text-[15px] text-[#1B1B1E]">
                    {contract.vehicle
                      ? `${contract.vehicle.brand} ${contract.vehicle.model} (${contract.vehicle.year})`
                      : '—'}
                  </span>
                  <span dir="ltr" className="font-mono text-[12px] font-bold text-[#93000B]">
                    {contract.vehicle?.registrationNumber || '—'}
                  </span>
                </div>

                <div className="p-3.5 rounded-lg bg-[#F6F2F7] border border-[#E4BEB9]/70 flex flex-col gap-1">
                  <span className="text-[12px] text-[#5B403D]">
                    {lang === 'ar' ? 'المستأجر والسائق' : lang === 'en' ? 'Renter & Driver' : 'Locataire'}
                  </span>
                  <span className="font-bold text-[15px] text-[#1B1B1E]">
                    {contract.customer?.fullName || '—'}
                  </span>
                  <span className="text-[12px] text-[#5B403D]">
                    {contract.driverName
                      ? `${lang === 'ar' ? 'السائق:' : lang === 'en' ? 'Driver:' : 'Conducteur :'} ${contract.driverName}`
                      : contract.customer?.phone || '—'}
                  </span>
                </div>

                <div className="p-3.5 rounded-lg bg-[#F6F2F7] border border-[#E4BEB9]/70 flex flex-col gap-1">
                  <span className="text-[12px] text-[#5B403D]">
                    {lang === 'ar' ? 'مدة الكراء' : lang === 'en' ? 'Rental Period' : 'Durée de location'}
                  </span>
                  <span className="font-bold text-[14px] text-[#1B1B1E] tabular-nums">
                    {formatDate(contract.startAt)} → {formatDate(contract.endAt)}
                  </span>
                  <span className="text-[12px] text-[#5B403D] tabular-nums">
                    {contract.durationDays}{' '}
                    {lang === 'ar' ? 'أيام' : lang === 'en' ? 'days' : 'jours'} ·{' '}
                    {contract.pickupLocation || 'Blida'}
                  </span>
                </div>

                <div className="p-3.5 rounded-lg bg-[#F6F2F7] border border-[#E4BEB9]/70 flex flex-col gap-1">
                  <span className="text-[12px] text-[#5B403D]">
                    {lang === 'ar' ? 'المالية والضمان' : lang === 'en' ? 'Payment Summary' : 'Règlement'}
                  </span>
                  <span dir="ltr" className="font-mono font-bold text-[16px] text-[#93000B] tabular-nums">
                    {formatDzd(contract.totalAmountDzd)}
                  </span>
                  <span dir="ltr" className="font-mono text-[12px] text-[#5B403D] tabular-nums">
                    {lang === 'ar' ? 'المدفوع:' : lang === 'en' ? 'Paid:' : 'Payé :'}{' '}
                    {formatDzd(contract.amountPaidDzd)}
                    {remainingDzd > 0
                      ? ` · ${lang === 'ar' ? 'المتبقي:' : lang === 'en' ? 'Due:' : 'Reste :'} ${formatDzd(remainingDzd)}`
                      : ''}
                  </span>
                </div>
              </div>

              {/* Return summary if completed */}
              {contract.returnRecord && (
                <div className="p-3.5 rounded-lg bg-[#DCFCE7]/50 border border-[#15803D]/25 flex flex-wrap items-center justify-between gap-3 text-[13px]">
                  <span className="font-semibold text-[#14532D]">
                    {lang === 'ar'
                      ? `تم إرجاع المركبة بتاريخ ${formatDate(contract.returnRecord.returnedAt)}`
                      : lang === 'en'
                        ? `Vehicle returned on ${formatDate(contract.returnRecord.returnedAt)}`
                        : `Véhicule restitué le ${formatDate(contract.returnRecord.returnedAt)}`}
                  </span>
                  <span dir="ltr" className="font-mono font-semibold text-[#14532D] tabular-nums">
                    {contract.returnRecord.returnMileage.toLocaleString('fr-FR')} km ·{' '}
                    {contract.returnRecord.totalAdditionalFeeDzd > 0
                      ? `+${formatDzd(contract.returnRecord.totalAdditionalFeeDzd)}`
                      : lang === 'ar'
                        ? 'بدون رسوم إضافية'
                        : lang === 'en'
                          ? 'No extra fees'
                          : 'Aucun frais supplémentaire'}
                  </span>
                </div>
              )}

              {/* Printable Copy Bar & Conditions Toggle */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-[#1B1B1E]">
                    {t.digitalContractSheetTitle}
                  </span>
                  <div className="inline-flex rounded border border-[#E4BEB9] overflow-hidden text-[12px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setSheetLang('ar')}
                      className={`min-h-[36px] px-3 py-1.5 cursor-pointer ${
                        sheetLang === 'ar'
                          ? 'bg-[#111114] text-white'
                          : 'bg-white text-[#1B1B1E] hover:bg-[#F6F2F7]'
                      }`}
                    >
                      AR
                    </button>
                    <button
                      type="button"
                      onClick={() => setSheetLang('fr')}
                      className={`min-h-[36px] px-3 py-1.5 cursor-pointer ${
                        sheetLang === 'fr'
                          ? 'bg-[#111114] text-white'
                          : 'bg-white text-[#1B1B1E] hover:bg-[#F6F2F7]'
                      }`}
                    >
                      FR
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {payload.conditionsArticles.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowConditions((v) => !v)}
                      className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#E4BEB9] text-[#1B1B1E] hover:bg-[#F6F2F7] text-[13px] font-semibold cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <span className="material-symbols-outlined text-[18px]">gavel</span>
                      <span>{t.digitalContractConditionsTitle}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => triggerPdfPrint(`${contract.contractNumber}.pdf`)}
                    className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#111114] text-white hover:bg-[#303033] text-[13px] font-semibold cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
                    <span>{t.downloadPdf}</span>
                  </button>
                </div>
              </div>
            </section>

            {/* Applicable Rental Conditions */}
            {showConditions && payload.conditionsArticles.length > 0 && (
              <section className="no-print bg-white border border-[#E4BEB9] rounded-xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-[#E4BEB9] pb-2">
                  <h2 className="font-title text-[16px] font-bold text-[#1B1B1E]">
                    {t.digitalContractConditionsTitle}{' '}
                    {payload.conditionsVersionNumber ? `· v${payload.conditionsVersionNumber}` : ''}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowConditions(false)}
                    className="min-h-[36px] px-3 py-1 rounded border border-[#E4BEB9] text-[12px] font-semibold cursor-pointer"
                  >
                    {lang === 'ar' ? 'إغلاق' : lang === 'en' ? 'Close' : 'Fermer'}
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {payload.conditionsArticles.map((art) => (
                    <div
                      key={art.number}
                      className="p-3 rounded-lg bg-[#F6F2F7] border border-[#E4BEB9]/70 flex flex-col gap-1"
                    >
                      <h3 className="text-[13px] font-bold text-[#93000B]">
                        {art.number}. {lang === 'ar' ? art.titleAr : art.titleFr}
                      </h3>
                      <p className="text-[12px] text-[#1B1B1E] leading-relaxed">
                        {lang === 'ar' ? art.bodyAr : art.bodyFr}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Official Printable 1-Page A4 Contract Sheet */}
            <div className="print-grid-reset">
              <OfficialContractSheet contract={contract} sheetLang={sheetLang} />
            </div>
          </>
        )}
      </main>

      <footer className="no-print border-t border-[#E4BEB9] bg-white px-4 sm:px-6 py-4 text-[12px] text-[#5B403D]">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <span>
            TRANSCAR · Larbi Tébessi 09000 Blida · RC 4038527A04 ·{' '}
            <a href="tel:0560970536" dir="ltr" className="font-mono font-semibold text-[#93000B] hover:underline">
              0560 97 05 36
            </a>{' '}
            /{' '}
            <a href="tel:0550495783" dir="ltr" className="font-mono font-semibold text-[#93000B] hover:underline">
              0550 49 57 83
            </a>
          </span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onOpenBookingSite}
              className="font-semibold text-[#1B1B1E] hover:underline cursor-pointer"
            >
              {t.openPublicSite}
            </button>
            <button
              type="button"
              onClick={onOpenAgencyLogin}
              className="font-semibold text-[#5B403D] hover:underline cursor-pointer"
            >
              {t.backToAdmin}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
