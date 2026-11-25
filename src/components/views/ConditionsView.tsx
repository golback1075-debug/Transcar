import React, { useEffect, useState } from 'react';
import type { RentalConditionArticle } from '../../db/schema.ts';
import { TRANSLATIONS, type Lang } from '../../i18n/translations.ts';
import { apiFetch, formatDate, triggerPdfPrint } from '../../lib/api.ts';
import { triggerOnePagePrint } from '../../lib/printFit.ts';
import { OFFICIAL_CONDITIONS_HEADER } from '../../shared/officialConditions.ts';
import type { ConditionVersionItem } from '../../types.ts';

interface Props {
  lang: Lang;
  role: 'manager' | 'employee';
}

export const ConditionsView: React.FC<Props> = ({ lang, role }) => {
  const t = TRANSLATIONS[lang];
  const [docLang, setDocLang] = useState<Lang>('ar');
  const [versions, setVersions] = useState<ConditionVersionItem[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [editableArticles, setEditableArticles] = useState<RentalConditionArticle[]>([]);
  const [newVersionNumber, setNewVersionNumber] = useState('1.1');
  const [publishing, setPublishing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadVersions = async () => {
    try {
      const res = await apiFetch<{ versions: ConditionVersionItem[] }>('/api/conditions');
      setVersions(res.versions);
      const active = res.versions.find((v) => v.isPublished) || res.versions[0];
      if (active) {
        setSelectedVersionId(active.id);
        setEditableArticles(active.articlesJson);
        const num = parseFloat(active.versionNumber);
        if (!Number.isNaN(num)) {
          setNewVersionNumber((num + 0.1).toFixed(1));
        }
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur chargement des conditions.',
      });
    }
  };

  useEffect(() => {
    loadVersions();
  }, []);

  const selectedVersion = versions.find((v) => v.id === selectedVersionId) || versions[0] || null;

  const updateArticleField = (
    idx: number,
    field: 'titleAr' | 'bodyAr' | 'titleFr' | 'bodyFr' | 'titleEn' | 'bodyEn',
    value: string,
  ) => {
    setEditableArticles((prev) =>
      prev.map((a, i) => (i === idx ? { ...a, [field]: value } : a)),
    );
  };

  const handlePublish = async () => {
    if (role !== 'manager' || publishing) return;
    if (!newVersionNumber.trim()) {
      setFeedback({ type: 'error', text: 'Veuillez saisir un numéro de version valide.' });
      return;
    }
    setPublishing(true);
    setFeedback(null);
    try {
      await apiFetch('/api/conditions', {
        method: 'POST',
        body: JSON.stringify({
          versionNumber: newVersionNumber.trim(),
          articles: editableArticles,
        }),
      });
      setFeedback({
        type: 'success',
        text: `Version ${newVersionNumber.trim()} publiée et synchronisée avec le site client.`,
      });
      await loadVersions();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur lors de la publication.',
      });
    } finally {
      setPublishing(false);
    }
  };

  const headerTitle =
    docLang === 'ar'
      ? OFFICIAL_CONDITIONS_HEADER.titleAr
      : docLang === 'en'
        ? OFFICIAL_CONDITIONS_HEADER.titleEn
        : OFFICIAL_CONDITIONS_HEADER.titleFr;

  const headerIntro =
    docLang === 'ar'
      ? OFFICIAL_CONDITIONS_HEADER.introAr
      : docLang === 'en'
        ? OFFICIAL_CONDITIONS_HEADER.introEn
        : OFFICIAL_CONDITIONS_HEADER.introFr;

  return (
    <div className="flex flex-col gap-6">
      {/* Language Tabs & Print/PDF/Publish Bar */}
      <section className="no-print bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={docLang === 'fr'}
            onClick={() => setDocLang('fr')}
            className={`px-3.5 py-2 rounded font-label text-[13px] font-semibold cursor-pointer ${
              docLang === 'fr'
                ? 'bg-[#111114] text-white'
                : 'bg-[#F6F2F7] text-[#1B1B1E] hover:bg-[#F0EDF1]'
            }`}
          >
            FR · Français
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={docLang === 'ar'}
            onClick={() => setDocLang('ar')}
            className={`px-3.5 py-2 rounded font-label text-[13px] font-semibold cursor-pointer ${
              docLang === 'ar'
                ? 'bg-[#111114] text-white'
                : 'bg-[#F6F2F7] text-[#1B1B1E] hover:bg-[#F0EDF1]'
            }`}
          >
            DZ · العربية (RTL)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={docLang === 'en'}
            onClick={() => setDocLang('en')}
            className={`px-3.5 py-2 rounded font-label text-[13px] font-semibold cursor-pointer ${
              docLang === 'en'
                ? 'bg-[#111114] text-white'
                : 'bg-[#F6F2F7] text-[#1B1B1E] hover:bg-[#F0EDF1]'
            }`}
          >
            GB · English
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => triggerOnePagePrint()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded border border-[#E4BEB9] bg-white text-[#1B1B1E] hover:bg-[#F6F2F7] font-label text-[13px] font-semibold cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">print</span>
            {t.printConditions}
          </button>
          <button
            type="button"
            onClick={() => triggerPdfPrint(`TRANSCAR-Conditions-v${selectedVersion?.versionNumber || '1.0'}.pdf`)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded border border-[#E4BEB9] bg-white text-[#1B1B1E] hover:bg-[#F6F2F7] font-label text-[13px] font-semibold cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
            {t.downloadPdf}
          </button>

          {role === 'manager' && (
            <div className="flex items-center gap-2">
              <input
                value={newVersionNumber}
                onChange={(e) => setNewVersionNumber(e.target.value)}
                aria-label="Numéro de version"
                className="w-20 rounded border border-[#E4BEB9] px-2.5 py-2 font-mono text-[13px]"
              />
              <button
                type="button"
                disabled={publishing}
                onClick={handlePublish}
                className="inline-flex items-center gap-2 px-4 py-2 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] font-label text-[13px] font-semibold cursor-pointer disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">save</span>
                {publishing ? 'Publication...' : `${t.publishVersion} (v${newVersionNumber})`}
              </button>
            </div>
          )}
        </div>
      </section>

      {feedback && (
        <div
          className={`no-print p-3 rounded border text-[13px] font-medium flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'bg-[#DCFCE7] text-[#14532D] border-[#15803D]/20'
              : 'bg-[#FFDAD6] text-[#93000A] border-[#BA1A1A]/25'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-[12px] font-bold underline cursor-pointer"
          >
            Fermer
          </button>
        </div>
      )}

      {/* Two-Column Split: 10 Official Articles + Version History */}
      <div className="print-grid-reset grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section
          dir={docLang === 'ar' ? 'rtl' : 'ltr'}
          className="lg:col-span-8 bg-white border border-[#E4BEB9] rounded-lg p-6 flex flex-col gap-4 print-only-sheet print-conditions-sheet"
        >
          <header className="conditions-header flex items-center justify-between gap-2 pb-3 border-b border-[#E4BEB9]">
            <div>
              <span className="font-headline text-[13px] font-bold text-[#93000B] block">
                {OFFICIAL_CONDITIONS_HEADER.company} · BLIDA
              </span>
              <h2 className="conditions-title font-title text-[20px] font-bold text-[#1B1B1E]">
                {headerTitle}
              </h2>
              <p className="conditions-intro text-[13px] text-[#5B403D] mt-1">{headerIntro}</p>
            </div>
            {selectedVersion?.isPublished && (
              <span className="no-print shrink-0 inline-flex items-center px-2.5 py-1 rounded-full bg-[#DCFCE7] text-[#14532D] font-label text-[11px] font-semibold">
                Actif sur le site client · v{selectedVersion.versionNumber}
              </span>
            )}
          </header>

          <div className="conditions-articles-grid flex flex-col gap-4">
            {editableArticles.map((art, idx) => {
              const titleField =
                docLang === 'ar' ? 'titleAr' : docLang === 'en' ? 'titleEn' : 'titleFr';
              const bodyField =
                docLang === 'ar' ? 'bodyAr' : docLang === 'en' ? 'bodyEn' : 'bodyFr';

              return (
                <div
                  key={art.number}
                  className="conditions-article-card p-4 rounded-lg bg-[#F6F2F7] border border-[#E4BEB9] flex flex-col gap-2"
                >
                  {role === 'manager' ? (
                    <>
                      <div className="conditions-article-editor no-print flex flex-col gap-2">
                        <input
                          value={art[titleField]}
                          onChange={(e) => updateArticleField(idx, titleField, e.target.value)}
                          className="font-title text-[15px] font-bold text-[#93000B] bg-white rounded border border-[#E4BEB9] px-3 py-1.5"
                        />
                        <textarea
                          rows={3}
                          value={art[bodyField]}
                          onChange={(e) => updateArticleField(idx, bodyField, e.target.value)}
                          className="text-[13px] text-[#1B1B1E] bg-white rounded border border-[#E4BEB9] px-3 py-2 leading-relaxed"
                        />
                      </div>
                      <div className="conditions-article-print hidden print:flex flex-col gap-1">
                        <h3 className="conditions-article-title font-title text-[15px] font-bold text-[#93000B]">
                          {art[titleField]}
                        </h3>
                        <p className="conditions-article-body text-[13px] text-[#1B1B1E] leading-relaxed">
                          {art[bodyField]}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <h3 className="conditions-article-title font-title text-[15px] font-bold text-[#93000B]">
                        {art[titleField]}
                      </h3>
                      <p className="conditions-article-body text-[13px] text-[#1B1B1E] leading-relaxed">
                        {art[bodyField]}
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* ÉQUIPEMENTS À RESTITUER AVEC LE VÉHICULE — Printable Checklist */}
          <div className="conditions-equipment-section mt-1 p-4 rounded-lg border-2 border-[#1e293b] bg-[#f8fafc] flex flex-col gap-2.5">
            <h3 className="conditions-equipment-title font-title text-[14px] font-extrabold text-[#93000B] tracking-wide uppercase">
              {docLang === 'ar'
                ? 'المعدات الواجب إرجاعها مع المركبة — ÉQUIPEMENTS À RESTITUER AVEC LE VÉHICULE'
                : docLang === 'en'
                  ? 'EQUIPMENT TO RETURN WITH THE VEHICLE — ÉQUIPEMENTS À RESTITUER AVEC LE VÉHICULE'
                  : 'ÉQUIPEMENTS À RESTITUER AVEC LE VÉHICULE'}
            </h3>
            <div className="conditions-equipment-grid grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { fr: 'Documents', ar: 'الوثائق', en: 'Documents' },
                { fr: 'Gilet', ar: 'سترة السلامة', en: 'Safety Vest' },
                { fr: 'Triangle', ar: 'مثلث التنبيه', en: 'Warning Triangle' },
                { fr: 'Extincteur', ar: 'مطفأة الحريق', en: 'Extinguisher' },
                { fr: 'Roue de secours', ar: 'العجلة الاحتياطية', en: 'Spare Wheel' },
                { fr: 'Cric', ar: 'الرافعة', en: 'Jack' },
                { fr: 'Manivelle', ar: 'مفتاح العجلات', en: 'Wheel Wrench' },
              ].map((eq) => (
                <div
                  key={eq.fr}
                  className="conditions-equipment-item flex items-center gap-2 bg-white border border-[#cbd5e1] rounded px-2.5 py-1.5"
                >
                  <span
                    className="conditions-equipment-box inline-block w-3.5 h-3.5 border-[1.5px] border-[#111827] bg-white rounded-[2px] shrink-0"
                    aria-hidden="true"
                  />
                  <span className="font-semibold text-[#1B1B1E] text-[12px] leading-tight">
                    {docLang === 'ar'
                      ? `${eq.fr} (${eq.ar})`
                      : docLang === 'en'
                        ? `${eq.fr} (${eq.en})`
                        : eq.fr}
                  </span>
                </div>
              ))}
            </div>
            <p className="conditions-equipment-warning text-[12px] font-bold text-[#dc2626] pt-1 border-t border-[#E4BEB9]">
              {docLang === 'ar'
                ? "في حالة ضياع أي من هذه المعدات، تتحملون كامل المسؤولية. · En cas de perte de l'un de ces équipements, vous devez en assumer la responsabilité."
                : docLang === 'en'
                  ? "In case of loss of any of this equipment, you must assume full responsibility. · En cas de perte de l'un de ces équipements, vous devez en assumer la responsabilité."
                  : "En cas de perte de l'un de ces équipements, vous devez en assumer la responsabilité."}
            </p>
          </div>

          {/* Signatures (Gauche: Signature de l'agence | Droite: Signature du locataire) */}
          <div
            dir="ltr"
            className="conditions-signatures-grid mt-1 grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            <div className="conditions-signature-box p-3.5 rounded-lg border border-[#1e293b] bg-[#f8fafc] flex flex-col gap-1.5 text-left">
              <h3 className="conditions-signature-title font-title text-[13px] font-bold text-[#93000B]">
                Signature de l&apos;agence
              </h3>
              <p className="conditions-signature-note text-[12px] font-semibold text-[#1B1B1E]">
                <span dir="ltr">Lu et approuvé</span>{' '}
                <bdi dir="rtl">(قرأت ووافقت)</bdi>
              </p>
              <div
                className="conditions-sig-space h-24 rounded bg-white"
                aria-label="Zone de signature et cachet de l'agence"
              />
            </div>

            <div className="conditions-signature-box p-3.5 rounded-lg border border-[#1e293b] bg-[#f8fafc] flex flex-col gap-1.5 text-left">
              <h3 className="conditions-signature-title font-title text-[13px] font-bold text-[#93000B]">
                Signature du locataire
              </h3>
              <p className="conditions-signature-note text-[12px] font-semibold text-[#1B1B1E]">
                <span dir="ltr">Lu et approuvé</span>{' '}
                <bdi dir="rtl">(قرأت ووافقت)</bdi>
              </p>
              <div
                className="conditions-sig-space h-24 rounded bg-white"
                aria-label="Zone de signature du locataire"
              />
            </div>
          </div>
        </section>

        {/* Version History Sidebar */}
        <section className="no-print lg:col-span-4 bg-white border border-[#E4BEB9] rounded-lg p-6 flex flex-col gap-4">
          <header className="pb-3 border-b border-[#E4BEB9]">
            <h2 className="font-title text-[18px] font-semibold text-[#1B1B1E]">
              {t.versionHistory}
            </h2>
            <p className="text-[13px] text-[#5B403D]">Traçabilité des acceptations clients</p>
          </header>

          <div className="flex flex-col gap-3">
            {versions.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setSelectedVersionId(v.id);
                  setEditableArticles(v.articlesJson);
                }}
                className={`text-left p-3 rounded-lg border cursor-pointer ${
                  selectedVersionId === v.id
                    ? 'bg-[#F6F2F7] border-[#93000B]'
                    : 'bg-white border-[#E4BEB9] hover:bg-[#F6F2F7]'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-label text-[13px] font-semibold text-[#1B1B1E]">
                    Version {v.versionNumber}
                  </span>
                  <span
                    className={`font-label text-[11px] font-semibold ${
                      v.isPublished ? 'text-[#15803D]' : 'text-[#5B403D]'
                    }`}
                  >
                    {v.isPublished ? 'Publiée' : 'Archivée'}
                  </span>
                </div>
                <p className="text-[12px] text-[#5B403D] tabular-nums">
                  {formatDate(v.createdAt)} · {v.acceptancesCount} acceptations
                </p>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
