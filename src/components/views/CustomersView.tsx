import React, { useEffect, useRef, useState } from 'react';
import { TRANSLATIONS, type Lang } from '../../i18n/translations.ts';
import { apiFetch, authorizedFileUrl, formatDate, formatDzd } from '../../lib/api.ts';
import type { CustomerItem } from '../../types.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

interface Props {
  lang: Lang;
  canDeleteCustomers?: boolean;
  canDeleteDocuments?: boolean;
  customers: CustomerItem[];
  onRefresh: () => void | Promise<void>;
}

export const CustomersView: React.FC<Props> = ({
  lang,
  canDeleteCustomers = true,
  canDeleteDocuments = true,
  customers,
  onRefresh,
}) => {
  const t = TRANSLATIONS[lang];
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(customers[0]?.id ?? null);

  // Add / Edit Customer Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerItem | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [address, setAddress] = useState('');
  const [idType, setIdType] = useState('CNI');
  const [idNumber, setIdNumber] = useState('');
  const [idIssuedBy, setIdIssuedBy] = useState('');
  const [country, setCountry] = useState('Algérie');
  const [licenceNumber, setLicenceNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Licence Upload / Preview state
  const [uploadingSide, setUploadingSide] = useState<'front' | 'back' | null>(null);
  const [licenceError, setLicenceError] = useState('');
  const [previewDoc, setPreviewDoc] = useState<{ title: string; url: string } | null>(null);
  const frontInputRef = useRef<HTMLInputElement>(null);
  const backInputRef = useRef<HTMLInputElement>(null);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmDeleteCustomer, setConfirmDeleteCustomer] = useState<CustomerItem | null>(null);
  const [confirmDeleteLicenceSide, setConfirmDeleteLicenceSide] = useState<'front' | 'back' | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = customers.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.fullName.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      (c.licenceNumber || '').toLowerCase().includes(q) ||
      (c.idNumber || '').toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    if (!selectedId && filtered.length > 0) {
      setSelectedId(filtered[0].id);
    } else if (selectedId && !customers.some((c) => c.id === selectedId)) {
      setSelectedId(customers[0]?.id ?? null);
    }
  }, [customers, filtered, selectedId]);

  const selected = customers.find((c) => c.id === selectedId) || null;

  const openCreateModal = () => {
    setEditingCustomer(null);
    setFullName('');
    setPhone('');
    setEmail('');
    setDateOfBirth('');
    setBirthPlace('');
    setAddress('');
    setIdType('CNI');
    setIdNumber('');
    setIdIssuedBy('');
    setCountry('Algérie');
    setLicenceNumber('');
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (c: CustomerItem) => {
    setEditingCustomer(c);
    setFullName(c.fullName);
    setPhone(c.phone);
    setEmail(c.email || '');
    setDateOfBirth(c.dateOfBirth || '');
    setBirthPlace(c.birthPlace || '');
    setAddress(c.address || '');
    setIdType(c.idType || 'CNI');
    setIdNumber(c.idNumber || '');
    setIdIssuedBy(c.idIssuedBy || '');
    setCountry(c.country || 'Algérie');
    setLicenceNumber(c.licenceNumber || '');
    setFormError('');
    setModalOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setFormError('');
    if (!fullName.trim()) {
      setFormError('Le nom complet du client est obligatoire.');
      return;
    }
    if (!phone.trim()) {
      setFormError('Le numéro de téléphone est obligatoire.');
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFormError("L'adresse e-mail saisie est invalide.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        fullName: fullName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        dateOfBirth,
        birthPlace: birthPlace.trim(),
        address: address.trim(),
        idType,
        idNumber: idNumber.trim(),
        idIssuedBy: idIssuedBy.trim(),
        country: country.trim() || 'Algérie',
        licenceNumber: licenceNumber.trim(),
      };
      if (editingCustomer) {
        await apiFetch(`/api/customers/${editingCustomer.id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...payload, version: editingCustomer.version }),
        });
      } else {
        const res = await apiFetch<{ customer: CustomerItem }>('/api/customers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setSelectedId(res.customer.id);
      }
      setModalOpen(false);
      await onRefresh();
      setFeedback({
        type: 'success',
        text: editingCustomer
          ? `Fiche client ${payload.fullName} mise à jour.`
          : `Client ${payload.fullName} enregistré.`,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erreur lors de l’enregistrement');
    } finally {
      setSaving(false);
    }
  };

  const handleLicenceUpload = async (side: 'front' | 'back', file: File | null) => {
    if (!selected || !file || uploadingSide) return;
    setLicenceError('');
    setUploadingSide(side);
    try {
      const fd = new FormData();
      fd.append(side, file);
      if (selected.licenceNumber) {
        fd.append('licenceNumber', selected.licenceNumber);
      }
      await apiFetch(`/api/customers/${selected.id}/licence`, {
        method: 'POST',
        body: fd,
      });
      await onRefresh();
      setFeedback({
        type: 'success',
        text: `Permis (${side === 'front' ? 'Recto' : 'Verso'}) enregistré pour ${selected.fullName}.`,
      });
    } catch (err) {
      setLicenceError(err instanceof Error ? err.message : 'Erreur lors du téléversement');
    } finally {
      setUploadingSide(null);
      if (frontInputRef.current) frontInputRef.current.value = '';
      if (backInputRef.current) backInputRef.current.value = '';
    }
  };

  const handleDeleteCustomer = async () => {
    if (!confirmDeleteCustomer) return;
    setDeleting(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{ message?: string }>(`/api/customers/${confirmDeleteCustomer.id}`, {
        method: 'DELETE',
      });
      setFeedback({
        type: 'success',
        text: res.message || `Client ${confirmDeleteCustomer.fullName} supprimé.`,
      });
      onRefresh();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur lors de la suppression du client.',
      });
    } finally {
      setDeleting(false);
      setConfirmDeleteCustomer(null);
    }
  };

  const handleDeleteLicenceSide = async () => {
    if (!selected || !confirmDeleteLicenceSide) return;
    setDeleting(true);
    setLicenceError('');
    try {
      await apiFetch(`/api/customers/${selected.id}/licence/${confirmDeleteLicenceSide}`, {
        method: 'DELETE',
      });
      setFeedback({
        type: 'success',
        text: `Fichier permis (${confirmDeleteLicenceSide === 'front' ? 'Recto' : 'Verso'}) supprimé.`,
      });
      onRefresh();
    } catch (err) {
      setLicenceError(err instanceof Error ? err.message : 'Erreur suppression fichier');
    } finally {
      setDeleting(false);
      setConfirmDeleteLicenceSide(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {feedback && (
        <div
          className={`p-3 rounded-lg border text-[13px] font-medium flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'bg-[#DCFCE7] text-[#14532D] border-[#15803D]/25'
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
      {/* Search & Add Customer Bar */}
      <section className="bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 bg-[#F6F2F7] border border-[#E4BEB9] rounded px-3 py-2 flex-1 min-w-[240px] max-w-md">
          <span className="material-symbols-outlined text-[18px] text-[#5B403D]">search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchCustomerPlaceholder}
            className="bg-transparent border-0 p-0 text-[13px] text-[#1B1B1E] placeholder:text-[#8F6F6C] focus:ring-0 focus:outline-none w-full"
          />
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] font-label text-[13px] font-semibold cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">person_add</span>
          {t.newCustomer}
        </button>
      </section>

      {/* Master-Detail Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Customer Directory */}
        <section className="lg:col-span-6 bg-white border border-[#E4BEB9] rounded-lg overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#F6F2F7] border-b border-[#E4BEB9]">
              <tr>
                <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase">
                  Client
                </th>
                <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase">
                  Permis
                </th>
                <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase text-right">
                  Locations
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4BEB9]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-[13px] text-[#5B403D]">
                    Aucun client enregistré pour le moment.
                  </td>
                </tr>
              ) : (
                filtered.map((c) => {
                  const hasFront = Boolean(c.licenceFrontUrl);
                  const hasBack = Boolean(c.licenceBackUrl);
                  const isComplete = hasFront && hasBack;
                  const isPartial = hasFront !== hasBack;
                  const isSelected = selected?.id === c.id;

                  return (
                    <tr
                      key={c.id}
                      onClick={() => setSelectedId(c.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-[#FFDAD6]/40' : 'hover:bg-[#F6F2F7]'
                      }`}
                    >
                      <td className="px-4 py-3.5">
                        <span className="font-title text-[15px] font-semibold text-[#1B1B1E] block">
                          {c.fullName}
                        </span>
                        <span className="text-[13px] text-[#5B403D] tabular-nums">
                          {c.phone} {c.address ? `· ${c.address}` : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        {isComplete ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#DCFCE7] text-[#14532D] font-label text-[11px] font-semibold">
                            Complet (R/V)
                          </span>
                        ) : isPartial ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#FEF3C7] text-[#78350F] font-label text-[11px] font-semibold">
                            {hasFront ? 'Verso manquant' : 'Recto manquant'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#FFDAD6] text-[#93000A] font-label text-[11px] font-semibold">
                            Manquant
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className="font-mono text-[13px] font-semibold text-[#1B1B1E] tabular-nums">
                          {c.contractsCount}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>

        {/* Right: Selected Customer Profile & Dedicated Permis de conduire */}
        <section className="lg:col-span-6 bg-white border border-[#E4BEB9] rounded-lg p-6 flex flex-col gap-5">
          {!selected ? (
            <div className="py-12 text-center text-[13px] text-[#5B403D]">
              Sélectionnez ou créez un client pour gérer ses informations et son permis de conduire.
            </div>
          ) : (
            <>
              <header className="flex items-start justify-between gap-3 pb-3 border-b border-[#E4BEB9]">
                <div>
                  <h2 className="font-headline text-[22px] font-semibold text-[#1B1B1E]">
                    {selected.fullName}
                  </h2>
                  <p className="text-[13px] text-[#5B403D] tabular-nums">
                    {selected.dateOfBirth ? `Né(e) le ${selected.dateOfBirth}` : 'Date naissance N/D'}
                    {selected.birthPlace ? ` à ${selected.birthPlace}` : ''}
                    {selected.idNumber ? ` · ${selected.idType || 'CNI'} N° ${selected.idNumber}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditModal(selected)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#E4BEB9] text-[#1B1B1E] hover:bg-[#F6F2F7] font-label text-[12px] font-semibold cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                    Modifier
                  </button>
                  {canDeleteCustomers && (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteCustomer(selected)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-[#BA1A1A] text-[#BA1A1A] hover:bg-[#FFDAD6] font-label text-[12px] font-semibold cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                      Supprimer
                    </button>
                  )}
                </div>
              </header>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[13px]">
                <div>
                  <span className="font-label text-[11px] font-semibold text-[#5B403D] block">
                    Téléphone
                  </span>
                  <span className="text-[#1B1B1E] tabular-nums">{selected.phone}</span>
                </div>
                <div>
                  <span className="font-label text-[11px] font-semibold text-[#5B403D] block">
                    E-mail
                  </span>
                  <span className="text-[#1B1B1E]">{selected.email || '—'}</span>
                </div>
                <div>
                  <span className="font-label text-[11px] font-semibold text-[#5B403D] block">
                    Délivrée par / Pays
                  </span>
                  <span className="text-[#1B1B1E]">
                    {selected.idIssuedBy || '—'} · {selected.country || 'Algérie'}
                  </span>
                </div>
                <div>
                  <span className="font-label text-[11px] font-semibold text-[#5B403D] block">
                    Adresse
                  </span>
                  <span className="text-[#1B1B1E]">{selected.address || '—'}</span>
                </div>
              </div>

              {/* Dedicated Permis de conduire Upload Section */}
              <div className="p-4 rounded-lg bg-[#F6F2F7] border border-[#E4BEB9] flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-title text-[15px] font-semibold text-[#1B1B1E] flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[18px] text-[#93000B]">
                      badge
                    </span>
                    {t.drivingLicenceBtn} (PDF / JPG / PNG)
                  </span>
                  <span className="font-mono text-[13px] font-semibold text-[#5B403D] tabular-nums">
                    {selected.licenceNumber || 'N° permis non renseigné'}
                  </span>
                </div>

                {licenceError && (
                  <p className="text-[12px] text-[#93000A] bg-[#FFDAD6] px-3 py-1.5 rounded">
                    {licenceError}
                  </p>
                )}

                <input
                  ref={frontInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => handleLicenceUpload('front', e.target.files?.[0] || null)}
                />
                <input
                  ref={backInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => handleLicenceUpload('back', e.target.files?.[0] || null)}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Front Side */}
                  <div className="p-3 rounded bg-white border border-[#E4BEB9] flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                        {t.frontSide}
                      </span>
                      <span
                        className={`font-label text-[11px] font-semibold ${
                          selected.licenceFrontUrl ? 'text-[#15803D]' : 'text-[#BA1A1A]'
                        }`}
                      >
                        {selected.licenceFrontUrl ? 'Enregistré' : 'Absent'}
                      </span>
                    </div>

                    {selected.licenceFrontUrl ? (
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewDoc({
                            title: `${selected.fullName} — Permis (${t.frontSide})`,
                            url: authorizedFileUrl(selected.licenceFrontUrl),
                          })
                        }
                        className="h-24 rounded bg-[#F0EDF1] flex flex-col items-center justify-center gap-1 text-[#00497F] hover:bg-[#EAE7EB] cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[24px]">visibility</span>
                        <span className="text-[12px] font-semibold">Consulter le fichier</span>
                      </button>
                    ) : (
                      <div className="h-24 rounded bg-[#F0EDF1] flex items-center justify-center text-[#5B403D] text-[12px]">
                        Aucun document
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={uploadingSide === 'front'}
                        onClick={() => frontInputRef.current?.click()}
                        className="flex-1 py-1.5 rounded border border-[#E4BEB9] text-[#1B1B1E] hover:bg-[#F6F2F7] font-label text-[12px] font-semibold cursor-pointer disabled:opacity-50"
                      >
                        {uploadingSide === 'front'
                          ? 'Envoi...'
                          : selected.licenceFrontUrl
                            ? t.replace
                            : t.upload}
                      </button>
                      {selected.licenceFrontUrl && canDeleteDocuments && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteLicenceSide('front')}
                          className="px-2.5 py-1.5 rounded border border-[#BA1A1A] text-[#BA1A1A] hover:bg-[#FFDAD6] font-label text-[12px] font-semibold cursor-pointer"
                          title="Supprimer recto"
                        >
                          <span className="material-symbols-outlined text-[15px] align-middle">delete</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Back Side */}
                  <div className="p-3 rounded bg-white border border-[#E4BEB9] flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                        {t.backSide}
                      </span>
                      <span
                        className={`font-label text-[11px] font-semibold ${
                          selected.licenceBackUrl ? 'text-[#15803D]' : 'text-[#BA1A1A]'
                        }`}
                      >
                        {selected.licenceBackUrl ? 'Enregistré' : 'Absent'}
                      </span>
                    </div>

                    {selected.licenceBackUrl ? (
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewDoc({
                            title: `${selected.fullName} — Permis (${t.backSide})`,
                            url: authorizedFileUrl(selected.licenceBackUrl),
                          })
                        }
                        className="h-24 rounded bg-[#F0EDF1] flex flex-col items-center justify-center gap-1 text-[#00497F] hover:bg-[#EAE7EB] cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[24px]">visibility</span>
                        <span className="text-[12px] font-semibold">Consulter le fichier</span>
                      </button>
                    ) : (
                      <div className="h-24 rounded bg-[#F0EDF1] flex items-center justify-center text-[#5B403D] text-[12px]">
                        Aucun document
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={uploadingSide === 'back'}
                        onClick={() => backInputRef.current?.click()}
                        className="flex-1 py-1.5 rounded border border-[#E4BEB9] text-[#1B1B1E] hover:bg-[#F6F2F7] font-label text-[12px] font-semibold cursor-pointer disabled:opacity-50"
                      >
                        {uploadingSide === 'back'
                          ? 'Envoi...'
                          : selected.licenceBackUrl
                            ? t.replace
                            : t.upload}
                      </button>
                      {selected.licenceBackUrl && canDeleteDocuments && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteLicenceSide('back')}
                          className="px-2.5 py-1.5 rounded border border-[#BA1A1A] text-[#BA1A1A] hover:bg-[#FFDAD6] font-label text-[12px] font-semibold cursor-pointer"
                          title="Supprimer verso"
                        >
                          <span className="material-symbols-outlined text-[15px] align-middle">delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Rental History */}
              <div className="flex flex-col gap-2">
                <span className="font-title text-[15px] font-semibold text-[#1B1B1E]">
                  {t.recentHistory} ({selected.rentalHistory.length})
                </span>
                {selected.rentalHistory.length === 0 ? (
                  <p className="text-[13px] text-[#5B403D]">Aucun contrat enregistré pour ce client.</p>
                ) : (
                  <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
                    {selected.rentalHistory.map((ct) => (
                      <div
                        key={ct.id}
                        className="p-3 rounded border border-[#E4BEB9] flex items-center justify-between gap-2"
                      >
                        <div>
                          <span className="font-mono text-[13px] font-semibold text-[#1B1B1E] block">
                            {ct.contractNumber}
                          </span>
                          <span className="text-[12px] text-[#5B403D] tabular-nums">
                            {formatDate(ct.startAt)} - {formatDate(ct.endAt)} ·{' '}
                            {formatDzd(ct.totalAmountDzd)}
                          </span>
                        </div>
                        <span
                          className={`shrink-0 font-label text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                            ct.status === 'completed'
                              ? 'bg-[#DCFCE7] text-[#14532D]'
                              : ct.status === 'confirmed' || ct.status === 'active'
                                ? 'bg-[#FEF3C7] text-[#78350F]'
                                : 'bg-[#F0EDF1] text-[#1B1B1E]'
                          }`}
                        >
                          {ct.status === 'completed'
                            ? 'Terminé'
                            : ct.status === 'confirmed' || ct.status === 'active'
                              ? 'Confirmé'
                              : ct.status === 'pending' || ct.status === 'upcoming'
                                ? 'En attente'
                                : ct.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* Add/Edit Customer Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6 border border-[#E4BEB9] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#E4BEB9] mb-4">
              <h3 className="font-headline text-[18px] font-bold text-[#1B1B1E]">
                {editingCustomer ? `Modifier ${editingCustomer.fullName}` : t.newCustomer}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="w-8 h-8 rounded border border-[#E4BEB9] flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded bg-[#FFDAD6] text-[#93000A] text-[13px]">
                {formError}
              </div>
            )}

            <form noValidate onSubmit={handleSaveCustomer} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                  Nom et prénom *
                </span>
                <input
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                  Téléphone *
                </span>
                <input
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px] tabular-nums"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                  E-mail
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                  Date de naissance
                </span>
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                  Lieu de naissance
                </span>
                <input
                  value={birthPlace}
                  onChange={(e) => setBirthPlace(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                  Type de pièce d'identité
                </span>
                <select
                  value={idType}
                  onChange={(e) => setIdType(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                >
                  <option value="CNI">Carte Nationale d'Identité (CNI)</option>
                  <option value="Passeport">Passeport</option>
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                  Numéro pièce d'identité
                </span>
                <input
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px] font-mono"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                  Délivrée par
                </span>
                <input
                  value={idIssuedBy}
                  onChange={(e) => setIdIssuedBy(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                  Numéro de permis de conduire
                </span>
                <input
                  value={licenceNumber}
                  onChange={(e) => setLicenceNumber(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px] font-mono"
                />
              </label>

              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                  Adresse complète
                </span>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>

              <div className="sm:col-span-2 flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded border border-[#E4BEB9] text-[13px] font-semibold cursor-pointer"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded bg-[#93000B] text-white text-[13px] font-semibold hover:bg-[#B91C1C] cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Protected Document Viewer Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-3xl w-full h-[85vh] flex flex-col overflow-hidden border border-[#E4BEB9]">
            <header className="px-5 py-3 border-b border-[#E4BEB9] flex items-center justify-between">
              <span className="font-title text-[15px] font-semibold text-[#1B1B1E]">
                {previewDoc.title}
              </span>
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="w-8 h-8 rounded border border-[#E4BEB9] flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </header>
            <div className="flex-1 bg-[#F0EDF1] p-4 flex items-center justify-center overflow-auto">
              <iframe
                src={previewDoc.url}
                title={previewDoc.title}
                className="w-full h-full rounded border border-[#E4BEB9] bg-white"
              />
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(confirmDeleteCustomer)}
        title="Supprimer ce client ?"
        targetLabel={
          confirmDeleteCustomer
            ? `${confirmDeleteCustomer.fullName} · ${confirmDeleteCustomer.phone}`
            : ''
        }
        message="Si ce client a des contrats ou réservations historiques, son dossier sera archivé de manière sécurisée afin de préserver la comptabilité. S'il possède un contrat actif, la suppression sera bloquée."
        confirmText="Supprimer"
        loading={deleting}
        onConfirm={handleDeleteCustomer}
        onCancel={() => setConfirmDeleteCustomer(null)}
      />

      <ConfirmDialog
        open={Boolean(confirmDeleteLicenceSide)}
        title="Supprimer le fichier du permis de conduire ?"
        targetLabel={
          selected
            ? `${selected.fullName} — ${confirmDeleteLicenceSide === 'front' ? 'Recto' : 'Verso'}`
            : ''
        }
        message="Cette face du permis de conduire sera supprimée de la fiche client."
        confirmText="Supprimer"
        loading={deleting}
        onConfirm={handleDeleteLicenceSide}
        onCancel={() => setConfirmDeleteLicenceSide(null)}
      />
    </div>
  );
};
