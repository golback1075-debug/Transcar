import React, { useEffect, useState } from 'react';
import type { RentalConditionArticle } from '../db/schema.ts';
import { TRANSLATIONS, type Lang } from '../i18n/translations.ts';
import { apiFetch, formatDzd } from '../lib/api.ts';
import { OFFICIAL_CONDITIONS_HEADER } from '../shared/officialConditions.ts';
import { OfflineIndicator } from './OfflineIndicator.tsx';
import { PWAInstallButton } from './PWAInstallButton.tsx';

interface PublicVehicle {
  id: number;
  brand: string;
  model: string;
  year: number;
  color: string;
  dailyPriceDzd: number;
  fuelType: string;
  transmission: string;
  seats: number;
  photoUrl: string;
}

interface Props {
  initialLang?: Lang;
  onOpenAgencyLogin: () => void;
}

export const CustomerBookingSite: React.FC<Props> = ({
  initialLang = 'fr',
  onOpenAgencyLogin,
}) => {
  const [lang, setLang] = useState<Lang>(initialLang);
  const t = TRANSLATIONS[lang];

  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  const plus3 = new Date(today.getTime() + 4 * 86400000);

  const [startDate, setStartDate] = useState(tomorrow.toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(plus3.toISOString().slice(0, 10));
  const [vehicles, setVehicles] = useState<PublicVehicle[]>([]);
  const [loading, setLoading] = useState(true);

  const [conditionsModalOpen, setConditionsModalOpen] = useState(false);
  const [conditionsVersionId, setConditionsVersionId] = useState<number>(1);
  const [conditionsVersionNumber, setConditionsVersionNumber] = useState('1.0');
  const [articles, setArticles] = useState<RentalConditionArticle[]>([]);

  const [selectedVehicle, setSelectedVehicle] = useState<PublicVehicle | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [address, setAddress] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [licenceNumber, setLicenceNumber] = useState('');
  const [licenceFront, setLicenceFront] = useState<File | null>(null);
  const [licenceBack, setLicenceBack] = useState<File | null>(null);
  const [acceptedConditions, setAcceptedConditions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmedCode, setConfirmedCode] = useState<string | null>(null);

  const daysCount = Math.max(
    1,
    Math.ceil(
      (new Date(`${endDate}T18:00:00Z`).getTime() - new Date(`${startDate}T09:00:00Z`).getTime()) /
        86400000,
    ),
  );

  const fetchAvailable = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ startDate, endDate });
      const data = await apiFetch<{ vehicles: PublicVehicle[] }>(
        `/api/public/vehicles?${qs.toString()}`,
      );
      setVehicles(data.vehicles || []);
    } catch {
      setVehicles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAvailable();
    apiFetch<{ id: number; versionNumber: string; articles: RentalConditionArticle[] }>(
      '/api/public/conditions',
    )
      .then((d) => {
        if (d?.id) {
          setConditionsVersionId(d.id);
          setConditionsVersionNumber(d.versionNumber);
          setArticles(d.articles || []);
        }
      })
      .catch(() => {});
  }, []);

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle || submitting) return;
    setSubmitError('');
    if (!fullName.trim()) {
      setSubmitError('Votre nom complet est obligatoire.');
      return;
    }
    if (!phone.trim()) {
      setSubmitError('Votre numéro de téléphone est obligatoire.');
      return;
    }
    if (!startDate || !endDate || new Date(`${endDate}T18:00:00Z`).getTime() <= new Date(`${startDate}T09:00:00Z`).getTime()) {
      setSubmitError('La date de retour doit être postérieure à la date de départ.');
      return;
    }
    if (!licenceFront || !licenceBack) {
      setSubmitError('Les photos recto et verso de votre permis de conduire sont obligatoires.');
      return;
    }
    if (!acceptedConditions) {
      setSubmitError('Vous devez accepter les conditions de location TRANSCAR.');
      return;
    }
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('vehicleId', String(selectedVehicle.id));
      formData.append('startDate', startDate);
      formData.append('endDate', endDate);
      formData.append('fullName', fullName.trim());
      formData.append('phone', phone.trim());
      formData.append('email', email.trim());
      formData.append('dateOfBirth', dateOfBirth);
      formData.append('address', address.trim());
      formData.append('idNumber', idNumber.trim());
      formData.append('licenceNumber', licenceNumber.trim());
      formData.append('conditionsAccepted', String(acceptedConditions));
      formData.append('conditionsVersionId', String(conditionsVersionId));
      formData.append('licenceFront', licenceFront);
      formData.append('licenceBack', licenceBack);

      const res = await fetch('/api/public/reservations', {
        method: 'POST',
        body: formData,
      });
      const text = await res.text();
      let data: { error?: string; reservationCode?: string } = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(res.ok ? 'Réponse serveur invalide' : text);
        }
      }
      if (!res.ok) {
        throw new Error(data.error || 'Erreur lors de la réservation');
      }
      setConfirmedCode(data.reservationCode || 'CONFIRMÉE');
      setSelectedVehicle(null);
      setFullName('');
      setPhone('');
      setEmail('');
      setAddress('');
      setIdNumber('');
      setLicenceNumber('');
      setLicenceFront(null);
      setLicenceBack(null);
      setAcceptedConditions(false);
      await fetchAvailable();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erreur lors de la réservation');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen flex flex-col bg-[#FBF8FC]">
      {/* Customer Website Top Nav */}
      <header className="bg-[#111114] text-white border-b border-[#303033] sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-[#93000B] flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px] text-white" aria-hidden="true">
                directions_car
              </span>
            </div>
            <div>
              <span className="font-headline text-[18px] font-semibold text-white block">
                TRANSCAR
              </span>
              <span className="font-label text-[11px] text-[#DCD9DD] block">
                {t.locationBlida}
              </span>
            </div>
          </div>

          <nav aria-label="Menu client" className="hidden md:flex items-center gap-6">
            <a href="#fleet" className="font-label text-[13px] font-semibold text-white hover:text-[#FFCDC7]">
              {t.availableVehicles}
            </a>
            <a href="#conditions" className="font-label text-[13px] font-semibold text-[#DCD9DD] hover:text-white">
              {t.navConditions}
            </a>
            <button
              type="button"
              onClick={onOpenAgencyLogin}
              className="font-label text-[13px] font-semibold text-[#FFCDC7] hover:text-white cursor-pointer"
            >
              {t.backToAdmin}
            </button>
          </nav>

          <div className="flex flex-wrap items-center gap-2">
            <PWAInstallButton lang={lang} variant="dark" />
            {(['ar', 'fr', 'en'] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`px-2.5 py-1 rounded font-label text-[11px] font-semibold cursor-pointer transition-colors ${
                  lang === l
                    ? 'bg-[#93000B] text-white'
                    : 'bg-[#303033] text-[#DCD9DD] hover:text-white'
                }`}
              >
                {l === 'ar' ? '🇩🇿 العربية' : l === 'fr' ? '🇫🇷 Français' : '🇬🇧 English'}
              </button>
            ))}
          </div>
        </div>
      </header>
      <OfflineIndicator lang={lang} />

      {/* Hero & Availability Checker */}
      <section className="bg-[#111114] text-white py-10 px-6">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-6 flex flex-col gap-4">
            <span className="inline-flex items-center gap-1.5 self-start px-3 py-1 rounded-full bg-[#93000B] text-white font-label text-[11px] font-semibold">
              {t.webTagline}
            </span>
            <h1 className="font-display text-[34px] lg:text-[40px] leading-tight font-bold text-white">
              {t.webHeroTitle}
            </h1>
            <p className="text-[15px] text-[#DCD9DD] max-w-prose">{t.webHeroSub}</p>
          </div>

          <div className="lg:col-span-6 bg-white text-[#1B1B1E] rounded-xl p-6 border border-[#E4BEB9]">
            <h2 className="font-title text-[18px] font-semibold text-[#1B1B1E] mb-4">
              {t.webCheckTitle}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <label className="flex flex-col gap-1.5">
                <span className="font-label text-[13px] font-semibold text-[#1B1B1E]">
                  {t.webStartDate}
                </span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded border border-[#E4BEB9] bg-white px-3 py-2.5 text-[13px] text-[#1B1B1E] focus:border-[#93000B] focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-label text-[13px] font-semibold text-[#1B1B1E]">
                  {t.webEndDate}
                </span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="rounded border border-[#E4BEB9] bg-white px-3 py-2.5 text-[13px] text-[#1B1B1E] focus:border-[#93000B] focus:outline-none"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={fetchAvailable}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] font-label text-[13px] font-semibold cursor-pointer transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                search
              </span>
              {t.webSearchBtn}
            </button>
          </div>
        </div>
      </section>

      {/* Main Fleet Section */}
      <main id="fleet" className="max-w-6xl w-full mx-auto px-6 py-10 flex flex-col gap-6 flex-1">
        {confirmedCode && (
          <div className="p-4 rounded-lg bg-[#DCFCE7] border border-[#15803D] text-[#14532D] flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-[24px]">check_circle</span>
              <div>
                <p className="font-semibold text-[15px]">
                  Réservation confirmée · {confirmedCode}
                </p>
                <p className="text-[13px]">
                  Votre demande et votre permis ont été enregistrés et transmis à l'agence TRANSCAR Blida.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setConfirmedCode(null)}
              className="text-[12px] font-semibold underline cursor-pointer"
            >
              Fermer
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-headline text-[22px] font-semibold text-[#1B1B1E]">
              {t.availableVehicles} ({vehicles.length})
            </h2>
            <p className="text-[13px] text-[#5B403D] tabular-nums">
              {startDate} → {endDate} · {daysCount} j
            </p>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-[#5B403D]">Chargement des disponibilités...</div>
        ) : vehicles.length === 0 ? (
          <div className="bg-white border border-[#E4BEB9] rounded-lg p-10 text-center text-[#5B403D]">
            <span className="material-symbols-outlined text-[36px] text-[#8F6F6C] mb-2 block">
              directions_car
            </span>
            <p className="text-[15px] font-semibold text-[#1B1B1E]">{t.webNoVehicles}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
            {vehicles.map((v) => (
              <article
                key={v.id}
                className="h-full bg-white border border-[#E4BEB9] rounded-lg overflow-hidden flex flex-col justify-between"
              >
                <div>
                  <img
                    src={v.photoUrl}
                    alt={`${v.brand} ${v.model}`}
                    className="w-full h-48 object-cover bg-[#F0EDF1]"
                  />
                  <div className="p-4 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-title text-[18px] font-semibold text-[#1B1B1E]">
                        {v.brand} {v.model}
                      </h3>
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#DCFCE7] text-[#14532D] font-label text-[11px] font-semibold">
                        {t.statusAvailable}
                      </span>
                    </div>
                    <p className="text-[13px] text-[#5B403D]">
                      {v.year} · {v.fuelType} · {v.transmission} · {v.seats} places
                    </p>
                    <p className="font-headline text-[22px] font-semibold text-[#93000B] tabular-nums pt-1">
                      {formatDzd(v.dailyPriceDzd)}{' '}
                      <span className="text-[13px] font-normal text-[#5B403D]">/ jour</span>
                    </p>
                  </div>
                </div>
                <footer className="px-4 py-3 bg-[#F6F2F7] border-t border-[#E4BEB9] flex items-center justify-between">
                  <span className="text-[13px] text-[#5B403D] tabular-nums">
                    Total {daysCount} j : {formatDzd(daysCount * v.dailyPriceDzd)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedVehicle(v);
                      setSubmitError('');
                    }}
                    className="px-4 py-2 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] font-label text-[13px] font-semibold cursor-pointer"
                  >
                    {t.webBookBtn}
                  </button>
                </footer>
              </article>
            ))}
          </div>
        )}

        {/* Conditions Banner */}
        <section
          id="conditions"
          className="bg-[#F6F2F7] border border-[#E4BEB9] rounded-lg p-6 flex flex-wrap items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-[24px] text-[#93000B] mt-0.5">
              verified_user
            </span>
            <div>
              <h3 className="font-title text-[15px] font-semibold text-[#1B1B1E]">
                {t.drivingLicenceBtn} & {t.navConditions} (v{conditionsVersionNumber})
              </h3>
              <p className="text-[13px] text-[#5B403D]">
                Le téléversement du permis (recto/verso) et l'acceptation des 10 articles officiels sont requis pour confirmer toute réservation.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setConditionsModalOpen(true)}
            className="px-4 py-2 rounded border border-[#E4BEB9] bg-white text-[#1B1B1E] hover:bg-[#F0EDF1] font-label text-[13px] font-semibold cursor-pointer"
          >
            {t.webReadConditions}
          </button>
        </section>
      </main>

      <footer className="bg-[#111114] text-[#DCD9DD] py-6 px-6 border-t border-[#303033]">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2 text-[13px]">
          <span>TRANSCAR · Boulevard Larbi Tebessi, Blida, Algérie · 0560 97 05 36</span>
          <span>{t.synced}</span>
        </div>
      </footer>

      {/* Booking Modal */}
      {selectedVehicle && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-[#E4BEB9] rounded-xl max-w-2xl w-full p-6 flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#E4BEB9] pb-3">
              <div>
                <h3 className="font-headline text-[20px] font-bold text-[#1B1B1E]">
                  {selectedVehicle.brand} {selectedVehicle.model}
                </h3>
                <p className="text-[13px] text-[#5B403D] tabular-nums">
                  {startDate} → {endDate} ({daysCount} j · {formatDzd(daysCount * selectedVehicle.dailyPriceDzd)})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedVehicle(null)}
                className="w-8 h-8 rounded border border-[#E4BEB9] flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form noValidate onSubmit={handleBookingSubmit} className="flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold">Nom complet *</span>
                  <input
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold">Téléphone *</span>
                  <input
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold">E-mail</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold">Date de naissance</span>
                  <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold">N° CNI / Passeport</span>
                  <input
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value)}
                    className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold">N° Permis de conduire</span>
                  <input
                    value={licenceNumber}
                    onChange={(e) => setLicenceNumber(e.target.value)}
                    className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                  />
                </label>
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-[12px] font-semibold">Adresse</span>
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold">Permis Recto (PDF/Image) *</span>
                  <input
                    required
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    onChange={(e) => setLicenceFront(e.target.files?.[0] || null)}
                    className="text-[12px]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold">Permis Verso (PDF/Image) *</span>
                  <input
                    required
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    onChange={(e) => setLicenceBack(e.target.files?.[0] || null)}
                    className="text-[12px]"
                  />
                </label>
              </div>

              <label className="flex items-start gap-2 p-3 rounded bg-[#F6F2F7] border border-[#E4BEB9] cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptedConditions}
                  onChange={(e) => setAcceptedConditions(e.target.checked)}
                  className="mt-1"
                />
                <span className="text-[12px] text-[#1B1B1E]">
                  J'ai lu et j'accepte les{' '}
                  <button
                    type="button"
                    onClick={() => setConditionsModalOpen(true)}
                    className="text-[#93000B] font-semibold underline cursor-pointer"
                  >
                    Conditions de location TRANSCAR (v{conditionsVersionNumber})
                  </button>
                  .
                </span>
              </label>

              {submitError && (
                <p className="text-[13px] text-[#BA1A1A] bg-[#FFDAD6] px-3 py-2 rounded font-semibold">
                  {submitError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedVehicle(null)}
                  className="px-4 py-2 rounded border border-[#E4BEB9] text-[13px] font-semibold cursor-pointer"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] text-[13px] font-semibold cursor-pointer disabled:opacity-50"
                >
                  {submitting ? 'Envoi en cours...' : t.webConfirmBooking}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Official Conditions Modal */}
      {conditionsModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E4BEB9] rounded-xl max-w-3xl w-full p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#E4BEB9] pb-3">
              <div>
                <h3 className="font-headline text-[20px] font-bold text-[#1B1B1E]">
                  {lang === 'ar'
                    ? OFFICIAL_CONDITIONS_HEADER.titleAr
                    : lang === 'en'
                      ? OFFICIAL_CONDITIONS_HEADER.titleEn
                      : OFFICIAL_CONDITIONS_HEADER.titleFr}
                </h3>
                <p className="text-[12px] text-[#5B403D]">
                  Version {conditionsVersionNumber} · TRANSCAR Blida
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConditionsModalOpen(false)}
                className="w-8 h-8 rounded border border-[#E4BEB9] flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {articles.map((art) => (
                <div key={art.number} className="p-3 rounded-lg bg-[#F6F2F7] border border-[#E4BEB9]">
                  <h4 className="font-semibold text-[14px] text-[#93000B] mb-1">
                    {lang === 'ar' ? art.titleAr : lang === 'en' ? art.titleEn : art.titleFr}
                  </h4>
                  <p className="text-[13px] text-[#1B1B1E] leading-relaxed">
                    {lang === 'ar' ? art.bodyAr : lang === 'en' ? art.bodyEn : art.bodyFr}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
