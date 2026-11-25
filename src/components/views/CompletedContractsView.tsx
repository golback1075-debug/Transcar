import React, { useEffect, useState } from 'react';
import { TRANSLATIONS, type Lang } from '../../i18n/translations.ts';
import {
  apiFetch,
  formatDate,
  formatDateTime,
  formatDzd,
  triggerPdfPrint,
} from '../../lib/api.ts';
import { triggerOnePagePrint } from '../../lib/printFit.ts';
import type { ContractItem, CustomerItem } from '../../types.ts';
import { OfficialContractSheet } from '../OfficialContractSheet.tsx';
import {
  buildContractAccessUrl,
  ContractQrCode,
  generateContractQrPngDataUrl,
} from '../ContractQrCode.tsx';
import { DriverClientSelector } from '../DriverClientSelector.tsx';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

interface Props {
  lang: Lang;
  role: 'manager' | 'employee';
  contracts: ContractItem[];
  customers: CustomerItem[];
  onRefresh: () => void | Promise<void>;
}

export const CompletedContractsView: React.FC<Props> = ({
  lang,
  role,
  contracts,
  customers,
  onRefresh,
}) => {
  const t = TRANSLATIONS[lang];
  const isManager = role === 'manager';

  const completedContracts = contracts.filter((c) => c.status === 'completed');

  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sheetLang, setSheetLang] = useState<'ar' | 'fr'>('ar');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const filteredContracts = completedContracts.filter((ct) => {
    const q = search.trim().toLowerCase();
    if (q) {
      const haystack = [
        ct.contractNumber,
        ct.customer?.fullName,
        ct.customer?.phone,
        ct.driverName,
        ct.vehicle?.brand,
        ct.vehicle?.model,
        ct.vehicle?.registrationNumber,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    const refIso = ct.completedAt || ct.returnRecord?.returnedAt || ct.endAt;
    const refTime = new Date(refIso).getTime();
    if (fromDate) {
      const fromTime = new Date(`${fromDate}T00:00:00`).getTime();
      if (!Number.isNaN(fromTime) && refTime < fromTime) return false;
    }
    if (toDate) {
      const toTime = new Date(`${toDate}T23:59:59.999`).getTime();
      if (!Number.isNaN(toTime) && refTime > toTime) return false;
    }
    return true;
  });

  const [selectedContract, setSelectedContract] = useState<ContractItem | null>(
    filteredContracts[0] || null,
  );

  useEffect(() => {
    if (filteredContracts.length === 0) {
      if (selectedContract !== null) setSelectedContract(null);
      return;
    }
    if (!selectedContract) {
      setSelectedContract(filteredContracts[0]);
      return;
    }
    const updated = filteredContracts.find((c) => c.id === selectedContract.id);
    setSelectedContract(updated || filteredContracts[0]);
  }, [contracts, search, fromDate, toDate]);

  // Manager-only Edit Contract modal state
  const [editingContract, setEditingContract] = useState<ContractItem | null>(null);
  const [editContractNumber, setEditContractNumber] = useState('');
  const [editDriverCustomerId, setEditDriverCustomerId] = useState<number | null>(null);
  const [editDriverName, setEditDriverName] = useState('');
  const [editDriverDob, setEditDriverDob] = useState('');
  const [editDriverIdNumber, setEditDriverIdNumber] = useState('');
  const [editDriverLicenceNumber, setEditDriverLicenceNumber] = useState('');
  const [editDriverCountry, setEditDriverCountry] = useState('');
  const [editDriverAddress, setEditDriverAddress] = useState('');
  const [editDriverPhone, setEditDriverPhone] = useState('');
  const [editPickupLocation, setEditPickupLocation] = useState('Blida');
  const [editReturnLocation, setEditReturnLocation] = useState('Blida');
  const [editFuelLevel, setEditFuelLevel] = useState('4/4');
  const [editMileage, setEditMileage] = useState(0);
  const [editMaxMileageLimit, setEditMaxMileageLimit] = useState('');
  const [editDepositDzd, setEditDepositDzd] = useState(0);
  const [editStartAt, setEditStartAt] = useState('');
  const [editEndAt, setEditEndAt] = useState('');
  const [editEarlyReturnDate, setEditEarlyReturnDate] = useState('');
  const [editEarlyReturnTime, setEditEarlyReturnTime] = useState('');
  const [editEarlyReturnLocation, setEditEarlyReturnLocation] = useState('');
  const [editExtensionFromDate, setEditExtensionFromDate] = useState('');
  const [editExtensionUntilDate, setEditExtensionUntilDate] = useState('');
  const [editExtensionExitTime, setEditExtensionExitTime] = useState('');
  const [editExtensionEntryTime, setEditExtensionEntryTime] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Inline Add Client modal (shared Clients database)
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [newClientFullName, setNewClientFullName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientDob, setNewClientDob] = useState('');
  const [newClientBirthPlace, setNewClientBirthPlace] = useState('');
  const [newClientAddress, setNewClientAddress] = useState('');
  const [newClientIdType, setNewClientIdType] = useState('CNI');
  const [newClientIdNumber, setNewClientIdNumber] = useState('');
  const [newClientIdIssuedBy, setNewClientIdIssuedBy] = useState('');
  const [newClientCountry, setNewClientCountry] = useState('Algérie');
  const [newClientLicenceNumber, setNewClientLicenceNumber] = useState('');
  const [newClientError, setNewClientError] = useState('');
  const [savingNewClient, setSavingNewClient] = useState(false);

  // Manager-only Delete state
  const [deleteTarget, setDeleteTarget] = useState<ContractItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // QR modal state
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrCopied, setQrCopied] = useState(false);
  const [qrDownloading, setQrDownloading] = useState(false);

  const applyEditDriverClient = (c: CustomerItem | null) => {
    if (!c) {
      setEditDriverCustomerId(null);
      setEditDriverName('');
      setEditDriverDob('');
      setEditDriverIdNumber('');
      setEditDriverLicenceNumber('');
      setEditDriverCountry('');
      setEditDriverAddress('');
      setEditDriverPhone('');
      return;
    }
    setEditDriverCustomerId(c.id);
    setEditDriverName(c.fullName);
    setEditDriverDob([c.dateOfBirth, c.birthPlace].filter(Boolean).join(' · '));
    setEditDriverIdNumber(c.idNumber || '');
    setEditDriverLicenceNumber(c.licenceNumber || '');
    setEditDriverCountry(c.country || 'Algérie');
    setEditDriverAddress(c.address || '');
    setEditDriverPhone(c.phone || '');
  };

  const openEditContractModal = (ct: ContractItem) => {
    if (!isManager) return;
    setEditingContract(ct);
    setEditContractNumber(ct.contractNumber);
    const matchedDriver = ct.driverCustomerId
      ? customers.find((c) => c.id === ct.driverCustomerId) || null
      : ct.driverName
        ? customers.find(
            (c) =>
              (ct.driverIdNumber && c.idNumber && c.idNumber === ct.driverIdNumber) ||
              c.fullName.trim().toLowerCase() === ct.driverName.trim().toLowerCase(),
          ) || null
        : null;
    setEditDriverCustomerId(ct.driverCustomerId ?? matchedDriver?.id ?? null);
    setEditDriverName(ct.driverName || matchedDriver?.fullName || '');
    setEditDriverDob(
      ct.driverDob ||
        (matchedDriver
          ? [matchedDriver.dateOfBirth, matchedDriver.birthPlace].filter(Boolean).join(' · ')
          : ''),
    );
    setEditDriverIdNumber(ct.driverIdNumber || matchedDriver?.idNumber || '');
    setEditDriverLicenceNumber(ct.driverLicenceNumber || matchedDriver?.licenceNumber || '');
    setEditDriverCountry(ct.driverCountry || matchedDriver?.country || '');
    setEditDriverAddress(ct.driverAddress || matchedDriver?.address || '');
    setEditDriverPhone(ct.driverPhone || matchedDriver?.phone || '');
    setEditPickupLocation(ct.pickupLocation || 'Blida');
    setEditReturnLocation(ct.returnLocation || 'Blida');
    setEditFuelLevel(ct.departureFuelLevel || '4/4');
    setEditMileage(ct.departureMileage);
    setEditMaxMileageLimit(
      ct.maxMileageLimit !== null && ct.maxMileageLimit !== undefined
        ? String(ct.maxMileageLimit)
        : '',
    );
    setEditDepositDzd(ct.depositDzd);
    setEditStartAt(new Date(ct.startAt).toISOString().slice(0, 16));
    setEditEndAt(new Date(ct.endAt).toISOString().slice(0, 16));
    setEditEarlyReturnDate(ct.earlyReturnDate || '');
    setEditEarlyReturnTime(ct.earlyReturnTime || '');
    setEditEarlyReturnLocation(ct.earlyReturnLocation || '');
    setEditExtensionFromDate(ct.extensionFromDate || '');
    setEditExtensionUntilDate(ct.extensionUntilDate || '');
    setEditExtensionExitTime(ct.extensionExitTime || '');
    setEditExtensionEntryTime(ct.extensionEntryTime || '');
    setEditNotes(ct.departureNotes || '');
    setEditError('');
  };

  const handleSaveContractEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isManager || !editingContract || savingEdit) return;
    setEditError('');
    const nextNum = editContractNumber.trim();
    if (!nextNum) {
      setEditError('Le numéro de contrat est obligatoire.');
      return;
    }
    if (nextNum.length > 64) {
      setEditError('Le numéro de contrat ne doit pas dépasser 64 caractères.');
      return;
    }
    if (
      nextNum.toLowerCase() !== editingContract.contractNumber.trim().toLowerCase() &&
      contracts.some(
        (c) =>
          c.id !== editingContract.id &&
          c.contractNumber.trim().toLowerCase() === nextNum.toLowerCase(),
      )
    ) {
      setEditError('Ce numéro de contrat existe déjà. Veuillez saisir un numéro unique.');
      return;
    }
    const startObj = new Date(editStartAt);
    const endObj = new Date(editEndAt);
    if (Number.isNaN(startObj.getTime()) || Number.isNaN(endObj.getTime()) || endObj <= startObj) {
      setEditError('La date de retour doit être postérieure au départ.');
      return;
    }
    if (
      !Number.isFinite(editMileage) ||
      editMileage < 0 ||
      !Number.isFinite(editDepositDzd) ||
      editDepositDzd < 0
    ) {
      setEditError('Kilométrage ou caution invalide.');
      return;
    }
    const editMaxTrimmed = editMaxMileageLimit.trim();
    const editMaxVal = editMaxTrimmed === '' ? null : Number(editMaxTrimmed);
    if (editMaxVal !== null && (!Number.isFinite(editMaxVal) || editMaxVal < 0)) {
      setEditError('Le kilométrage maximal autorisé doit être positif ou nul.');
      return;
    }

    setSavingEdit(true);
    try {
      await apiFetch(`/api/contracts/${editingContract.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          version: editingContract.version,
          contractNumber: nextNum,
          driverCustomerId: editDriverCustomerId,
          driverName: editDriverName.trim(),
          driverDob: editDriverDob.trim(),
          driverIdNumber: editDriverIdNumber.trim(),
          driverLicenceNumber: editDriverLicenceNumber.trim(),
          driverCountry: editDriverCountry.trim(),
          driverAddress: editDriverAddress.trim(),
          driverPhone: editDriverPhone.trim(),
          pickupLocation: editPickupLocation.trim() || 'Blida',
          returnLocation: editReturnLocation.trim() || 'Blida',
          departureFuelLevel: editFuelLevel,
          departureMileage: editMileage,
          maxMileageLimit: editMaxVal !== null ? Math.round(editMaxVal) : null,
          depositDzd: editDepositDzd,
          startAt: startObj.toISOString(),
          endAt: endObj.toISOString(),
          earlyReturnDate: editEarlyReturnDate.trim(),
          earlyReturnTime: editEarlyReturnTime.trim(),
          earlyReturnLocation: editEarlyReturnLocation.trim(),
          extensionFromDate: editExtensionFromDate.trim(),
          extensionUntilDate: editExtensionUntilDate.trim(),
          extensionExitTime: editExtensionExitTime.trim(),
          extensionEntryTime: editExtensionEntryTime.trim(),
          departureNotes: editNotes.trim(),
        }),
      });
      setEditingContract(null);
      await onRefresh();
      setFeedback({
        type: 'success',
        text: `Contrat terminé ${nextNum} mis à jour.`,
      });
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Impossible de modifier le contrat.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSaveNewClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingNewClient) return;
    setNewClientError('');
    if (!newClientFullName.trim()) {
      setNewClientError('Le nom complet du client est obligatoire.');
      return;
    }
    if (!newClientPhone.trim()) {
      setNewClientError('Le numéro de téléphone est obligatoire.');
      return;
    }
    if (newClientEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newClientEmail.trim())) {
      setNewClientError("L'adresse e-mail saisie est invalide.");
      return;
    }
    setSavingNewClient(true);
    try {
      const payload = {
        fullName: newClientFullName.trim(),
        phone: newClientPhone.trim(),
        email: newClientEmail.trim(),
        dateOfBirth: newClientDob,
        birthPlace: newClientBirthPlace.trim(),
        address: newClientAddress.trim(),
        idType: newClientIdType,
        idNumber: newClientIdNumber.trim(),
        idIssuedBy: newClientIdIssuedBy.trim(),
        country: newClientCountry.trim() || 'Algérie',
        licenceNumber: newClientLicenceNumber.trim(),
      };
      const res = await apiFetch<{ customer: CustomerItem }>('/api/customers', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await onRefresh();
      applyEditDriverClient(res.customer);
      setAddClientOpen(false);
      setFeedback({
        type: 'success',
        text: `Client ${res.customer.fullName} ajouté à la base Clients et sélectionné comme conducteur.`,
      });
    } catch (err) {
      setNewClientError(err instanceof Error ? err.message : 'Erreur lors de la création du client.');
    } finally {
      setSavingNewClient(false);
    }
  };

  const handleDeleteContract = async () => {
    if (!isManager || !deleteTarget || deleting) return;
    setDeleting(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{ message?: string }>(`/api/contracts/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      setFeedback({
        type: 'success',
        text: res.message || `Contrat ${deleteTarget.contractNumber} supprimé définitivement.`,
      });
      if (selectedContract?.id === deleteTarget.id) {
        setSelectedContract(null);
      }
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Suppression impossible.',
      });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const selectedQrUrl = selectedContract?.digitalAccessToken
    ? buildContractAccessUrl(selectedContract.digitalAccessToken)
    : '';

  const handleCopyQrLink = async (url: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setQrCopied(true);
      window.setTimeout(() => setQrCopied(false), 2200);
    } catch {
      setFeedback({
        type: 'error',
        text: 'Impossible de copier automatiquement le lien. Copiez-le depuis la fenêtre QR.',
      });
    }
  };

  const handleDownloadQrPng = async (ct: ContractItem, url: string) => {
    if (!url || qrDownloading) return;
    setQrDownloading(true);
    try {
      const dataUrl = await generateContractQrPngDataUrl(url, 512);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${ct.contractNumber}-QR.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      setFeedback({
        type: 'error',
        text: 'Impossible de générer l’image PNG du QR code.',
      });
    } finally {
      setQrDownloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {feedback && (
        <div
          className={`no-print p-3 rounded-lg border text-[13px] font-medium flex items-center justify-between gap-2 ${
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

      {/* Search & Date Filter + Sheet Print Controls */}
      <section className="no-print bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
          <span className="px-3.5 py-2 rounded font-label text-[13px] font-semibold bg-[#111114] text-white shrink-0">
            Contrats terminés ({filteredContracts.length})
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="N° contrat, client, conducteur, véhicule..."
            className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px] flex-1 min-w-[200px]"
          />
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="text-[#5B403D] font-semibold">Du</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded border border-[#E4BEB9] px-2.5 py-1.5 text-[12px]"
            />
            <span className="text-[#5B403D] font-semibold">Au</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded border border-[#E4BEB9] px-2.5 py-1.5 text-[12px]"
            />
            {(search || fromDate || toDate) && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setFromDate('');
                  setToDate('');
                }}
                className="px-2.5 py-1.5 rounded border border-[#E4BEB9] text-[12px] font-semibold hover:bg-[#F6F2F7] cursor-pointer"
              >
                Réinitialiser
              </button>
            )}
          </div>
        </div>

        {selectedContract && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="inline-flex rounded border border-[#E4BEB9] overflow-hidden text-[12px] font-semibold">
              <button
                type="button"
                onClick={() => setSheetLang('ar')}
                className={`px-2.5 py-2 cursor-pointer ${
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
                className={`px-2.5 py-2 cursor-pointer ${
                  sheetLang === 'fr'
                    ? 'bg-[#111114] text-white'
                    : 'bg-white text-[#1B1B1E] hover:bg-[#F6F2F7]'
                }`}
              >
                FR
              </button>
            </div>
            <button
              type="button"
              onClick={() => triggerPdfPrint(`${selectedContract.contractNumber}.pdf`)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded bg-[#111114] text-white hover:bg-[#303033] font-label text-[13px] font-semibold cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
              {t.downloadPdf}
            </button>
            <button
              type="button"
              onClick={() => triggerOnePagePrint()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] font-label text-[13px] font-semibold cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">print</span>
              {t.printContract}
            </button>
          </div>
        )}
      </section>

      <div className="print-grid-reset grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Completed Contracts List */}
        <section className="no-print lg:col-span-5 bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-col gap-2.5">
          <header className="pb-2 border-b border-[#E4BEB9] flex items-center justify-between gap-2">
            <h3 className="font-title text-[15px] font-semibold text-[#1B1B1E]">
              Historique des contrats clôturés ({filteredContracts.length})
            </h3>
            {!isManager && (
              <span className="text-[11px] font-semibold text-[#5B403D]">
                Modification / suppression réservées au Gérant
              </span>
            )}
          </header>

          {filteredContracts.length === 0 ? (
            <p className="text-[13px] text-[#5B403D] py-8 text-center">
              Aucun contrat terminé ne correspond à votre recherche.
            </p>
          ) : (
            filteredContracts.map((ct) => {
              const returnedAtValue = ct.completedAt || ct.returnRecord?.returnedAt || ct.endAt;
              return (
                <div
                  key={ct.id}
                  className={`p-3 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                    selectedContract?.id === ct.id
                      ? 'border-[#93000B] bg-[#FFDAD6]/30'
                      : 'border-[#E4BEB9] hover:bg-[#F6F2F7]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedContract(ct)}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[13px] font-semibold text-[#1B1B1E]">
                        {ct.contractNumber} · {ct.customer?.fullName}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EAE7EB] text-[#1B1B1E]">
                        Terminé
                      </span>
                    </div>
                    <span className="text-[12px] text-[#5B403D] block">
                      {ct.vehicle?.brand} {ct.vehicle?.model} ({ct.vehicle?.registrationNumber})
                    </span>
                    <span className="text-[11px] text-[#5B403D] tabular-nums block">
                      {formatDate(ct.startAt)} → {formatDate(ct.endAt)} · Retour :{' '}
                      {formatDateTime(returnedAtValue)}
                    </span>
                    <span className="font-mono text-[12px] font-semibold text-[#93000B] tabular-nums">
                      {formatDzd(ct.totalAmountDzd)}
                    </span>
                  </button>

                  {isManager && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedContract(ct);
                          openEditContractModal(ct);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-[#E4BEB9] bg-white text-[#1B1B1E] hover:bg-[#F6F2F7] text-[12px] font-semibold cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[15px]">edit</span>
                        Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(ct)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-[#BA1A1A] bg-white text-[#BA1A1A] hover:bg-[#FFDAD6] text-[12px] font-semibold cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[15px]">delete</span>
                        {t.deleteContractBtn}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>

        {/* Right Column: Official Contract Sheet & Actions */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          {selectedContract ? (
            <>
              <div className="no-print bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="font-mono text-[14px] font-bold text-[#93000B]">
                    {selectedContract.contractNumber}
                  </span>
                  <span className="text-[12px] text-[#5B403D] block">
                    Clôturé le{' '}
                    {formatDateTime(
                      selectedContract.completedAt ||
                        selectedContract.returnRecord?.returnedAt ||
                        selectedContract.endAt,
                    )}{' '}
                    · Total : {formatDzd(selectedContract.totalAmountDzd)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowQrModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#111114] text-white hover:bg-[#303033] text-[12px] font-semibold cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[15px]">qr_code_2</span>
                    {t.qrCodeBtn}
                  </button>
                  {isManager && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditContractModal(selectedContract)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-[#E4BEB9] text-[#1B1B1E] hover:bg-[#F6F2F7] text-[12px] font-semibold cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[15px]">edit</span>
                        Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(selectedContract)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-[#BA1A1A] text-[#BA1A1A] hover:bg-[#FFDAD6] text-[12px] font-semibold cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[15px]">delete</span>
                        {t.deleteContractBtn}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <OfficialContractSheet contract={selectedContract} sheetLang={sheetLang} />
            </>
          ) : (
            <div className="no-print bg-white border border-[#E4BEB9] rounded-lg p-12 text-center text-[#5B403D]">
              Sélectionnez un contrat terminé pour consulter, imprimer ou exporter le document officiel.
            </div>
          )}
        </div>
      </div>

      {/* Manager-Only Edit Completed Contract Modal */}
      {isManager && editingContract && (
        <div className="no-print fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            noValidate
            onSubmit={handleSaveContractEdit}
            className="bg-white border border-[#E4BEB9] rounded-xl max-w-lg w-full p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-[#E4BEB9] pb-3">
              <div>
                <h3 className="font-headline text-[18px] font-bold text-[#1B1B1E]">
                  Modifier le contrat terminé
                </h3>
                <span className="font-mono text-[12px] font-bold text-[#93000B]">
                  N° {editContractNumber.trim() || editingContract.contractNumber}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setEditingContract(null)}
                className="w-8 h-8 rounded border border-[#E4BEB9] flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {editError && (
              <p className="text-[12px] font-semibold text-[#BA1A1A] bg-[#FFDAD6] px-3 py-2 rounded">
                {editError}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-[12px] font-semibold">N° CONTRAT *</span>
                <input
                  type="text"
                  required
                  value={editContractNumber}
                  onChange={(e) => setEditContractNumber(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-2.5 py-2 font-mono text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Date départ *</span>
                <input
                  type="datetime-local"
                  value={editStartAt}
                  onChange={(e) => setEditStartAt(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-2.5 py-2 text-[12px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Date retour *</span>
                <input
                  type="datetime-local"
                  value={editEndAt}
                  onChange={(e) => setEditEndAt(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-2.5 py-2 text-[12px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Km départ</span>
                <input
                  type="number"
                  min={0}
                  value={editMileage}
                  onChange={(e) => setEditMileage(Number(e.target.value))}
                  className="rounded border border-[#E4BEB9] px-2.5 py-2 font-mono text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Km max autorisé (KM)</span>
                <input
                  type="number"
                  min={0}
                  placeholder="Ex: 150000"
                  value={editMaxMileageLimit}
                  onChange={(e) => setEditMaxMileageLimit(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-2.5 py-2 font-mono text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Carburant départ</span>
                <select
                  value={editFuelLevel}
                  onChange={(e) => setEditFuelLevel(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-2.5 py-2 text-[13px]"
                >
                  <option value="4/4">Plein (4/4)</option>
                  <option value="3/4">3/4</option>
                  <option value="1/2">1/2</option>
                  <option value="1/4">1/4</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Caution (DZD)</span>
                <input
                  type="number"
                  min={0}
                  value={editDepositDzd}
                  onChange={(e) => setEditDepositDzd(Number(e.target.value))}
                  className="rounded border border-[#E4BEB9] px-2.5 py-2 font-mono text-[13px]"
                />
              </label>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-[12px] font-semibold">Conducteur (si autre)</span>
                <DriverClientSelector
                  customers={customers}
                  selectedDriverId={editDriverCustomerId}
                  fallbackDriverName={editDriverName}
                  renterCustomerId={editingContract.customerId}
                  onSelectClient={applyEditDriverClient}
                  onRequestAddClient={(prefill) => {
                    setNewClientFullName(prefill);
                    setNewClientPhone('');
                    setNewClientEmail('');
                    setNewClientDob('');
                    setNewClientBirthPlace('');
                    setNewClientAddress('');
                    setNewClientIdType('CNI');
                    setNewClientIdNumber('');
                    setNewClientIdIssuedBy('');
                    setNewClientCountry('Algérie');
                    setNewClientLicenceNumber('');
                    setNewClientError('');
                    setAddClientOpen(true);
                  }}
                />
                {editDriverName.trim() && (
                  <div className="mt-1 px-2.5 py-1.5 rounded bg-[#F6F2F7] border border-[#E4BEB9] text-[11px] text-[#5B403D] flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="font-semibold text-[#1B1B1E]">{editDriverName}</span>
                    {editDriverPhone && <span>Tél: {editDriverPhone}</span>}
                    {editDriverIdNumber && <span>Pièce: {editDriverIdNumber}</span>}
                    {editDriverLicenceNumber && <span>Permis: {editDriverLicenceNumber}</span>}
                    {editDriverAddress && <span>Adresse: {editDriverAddress}</span>}
                  </div>
                )}
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Lieu remise</span>
                <input
                  value={editPickupLocation}
                  onChange={(e) => setEditPickupLocation(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-2.5 py-2 text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Lieu retour</span>
                <input
                  value={editReturnLocation}
                  onChange={(e) => setEditReturnLocation(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-2.5 py-2 text-[13px]"
                />
              </label>
              <div className="sm:col-span-2 rounded border border-[#E4BEB9] bg-[#FBF8FC] p-2.5 flex flex-col gap-2">
                <span className="text-[11px] font-bold uppercase text-[#93000B]">
                  Retour anticipé &amp; Prolongation
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold">Date retour anticipé</span>
                    <input
                      type="text"
                      value={editEarlyReturnDate}
                      onChange={(e) => setEditEarlyReturnDate(e.target.value)}
                      className="rounded border border-[#E4BEB9] bg-white px-2 py-1.5 text-[12px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold">Heure retour anticipé</span>
                    <input
                      type="text"
                      value={editEarlyReturnTime}
                      onChange={(e) => setEditEarlyReturnTime(e.target.value)}
                      className="rounded border border-[#E4BEB9] bg-white px-2 py-1.5 text-[12px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold">Lieu retour anticipé</span>
                    <input
                      type="text"
                      value={editEarlyReturnLocation}
                      onChange={(e) => setEditEarlyReturnLocation(e.target.value)}
                      className="rounded border border-[#E4BEB9] bg-white px-2 py-1.5 text-[12px]"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold">Prolong. du</span>
                    <input
                      type="text"
                      value={editExtensionFromDate}
                      onChange={(e) => setEditExtensionFromDate(e.target.value)}
                      className="rounded border border-[#E4BEB9] bg-white px-2 py-1.5 text-[12px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold">Prolong. au</span>
                    <input
                      type="text"
                      value={editExtensionUntilDate}
                      onChange={(e) => setEditExtensionUntilDate(e.target.value)}
                      className="rounded border border-[#E4BEB9] bg-white px-2 py-1.5 text-[12px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold">Heure sortie</span>
                    <input
                      type="text"
                      value={editExtensionExitTime}
                      onChange={(e) => setEditExtensionExitTime(e.target.value)}
                      className="rounded border border-[#E4BEB9] bg-white px-2 py-1.5 text-[12px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold">Heure entrée</span>
                    <input
                      type="text"
                      value={editExtensionEntryTime}
                      onChange={(e) => setEditExtensionEntryTime(e.target.value)}
                      className="rounded border border-[#E4BEB9] bg-white px-2 py-1.5 text-[12px]"
                    />
                  </label>
                </div>
              </div>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-[12px] font-semibold">Notes départ</span>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-2.5 py-2 text-[13px]"
                />
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingContract(null)}
                className="px-4 py-2 rounded border border-[#E4BEB9] text-[13px] font-semibold cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="px-4 py-2 rounded bg-[#93000B] text-white text-[13px] font-semibold cursor-pointer disabled:opacity-50"
              >
                {savingEdit ? 'Enregistrement...' : 'Enregistrer les modifications'}
              </button>
            </div>
          </form>
        </div>
      )}

      {addClientOpen && (
        <div className="no-print fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E4BEB9] rounded-xl max-w-xl w-full p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#E4BEB9] pb-3">
              <h3 className="font-headline text-[18px] font-bold text-[#1B1B1E]">
                Ajouter un nouveau client (Conducteur)
              </h3>
              <button
                type="button"
                onClick={() => setAddClientOpen(false)}
                className="w-8 h-8 rounded border border-[#E4BEB9] flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {newClientError && (
              <p className="text-[12px] font-semibold text-[#BA1A1A] bg-[#FFDAD6] px-3 py-2 rounded">
                {newClientError}
              </p>
            )}

            <form noValidate onSubmit={handleSaveNewClient} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-[12px] font-semibold">Nom complet *</span>
                <input
                  required
                  value={newClientFullName}
                  onChange={(e) => setNewClientFullName(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Téléphone *</span>
                <input
                  required
                  value={newClientPhone}
                  onChange={(e) => setNewClientPhone(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px] font-mono"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">E-mail</span>
                <input
                  type="email"
                  value={newClientEmail}
                  onChange={(e) => setNewClientEmail(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Date de naissance</span>
                <input
                  type="date"
                  value={newClientDob}
                  onChange={(e) => setNewClientDob(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Lieu de naissance</span>
                <input
                  value={newClientBirthPlace}
                  onChange={(e) => setNewClientBirthPlace(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Type de pièce d&apos;identité</span>
                <select
                  value={newClientIdType}
                  onChange={(e) => setNewClientIdType(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                >
                  <option value="CNI">Carte Nationale d&apos;Identité (CNI)</option>
                  <option value="Passeport">Passeport</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Numéro pièce d&apos;identité</span>
                <input
                  value={newClientIdNumber}
                  onChange={(e) => setNewClientIdNumber(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px] font-mono"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Délivrée par</span>
                <input
                  value={newClientIdIssuedBy}
                  onChange={(e) => setNewClientIdIssuedBy(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Pays</span>
                <input
                  value={newClientCountry}
                  onChange={(e) => setNewClientCountry(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-[12px] font-semibold">Numéro de permis de conduire</span>
                <input
                  value={newClientLicenceNumber}
                  onChange={(e) => setNewClientLicenceNumber(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px] font-mono"
                />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-[12px] font-semibold">Adresse complète</span>
                <input
                  value={newClientAddress}
                  onChange={(e) => setNewClientAddress(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>

              <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAddClientOpen(false)}
                  className="px-4 py-2 rounded border border-[#E4BEB9] text-[13px] font-semibold cursor-pointer"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={savingNewClient}
                  className="px-4 py-2 rounded bg-[#93000B] text-white text-[13px] font-semibold hover:bg-[#B91C1C] cursor-pointer disabled:opacity-50"
                >
                  {savingNewClient ? 'Enregistrement...' : 'Enregistrer le client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showQrModal && selectedContract && (
        <div className="no-print fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E4BEB9] rounded-xl max-w-md w-full p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-[#E4BEB9] pb-3">
              <div>
                <h3 className="font-headline text-[18px] font-bold text-[#1B1B1E]">
                  {t.qrAccessTitle}
                </h3>
                <span className="font-mono text-[12px] font-bold text-[#93000B]">
                  {selectedContract.contractNumber} · {selectedContract.customer?.fullName || ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="w-8 h-8 rounded border border-[#E4BEB9] flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {selectedQrUrl ? (
              <>
                <div className="flex flex-col items-center justify-center gap-3 py-3 bg-[#F6F2F7] rounded-xl border border-[#E4BEB9]">
                  <div className="p-3 bg-white rounded-xl border border-[#E4BEB9] shadow-xs">
                    <ContractQrCode
                      value={selectedQrUrl}
                      size={220}
                      quietMargin={2}
                      label={`${t.qrCodeBtn} ${selectedContract.contractNumber}`}
                    />
                  </div>
                  <span className="font-mono text-[12px] font-bold text-[#1B1B1E]">
                    {selectedContract.vehicle?.brand} {selectedContract.vehicle?.model} ·{' '}
                    {selectedContract.vehicle?.registrationNumber}
                  </span>
                </div>

                <p className="text-[12px] text-[#5B403D]">{t.qrAccessDesc}</p>

                <input
                  type="text"
                  readOnly
                  value={selectedQrUrl}
                  onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
                  dir="ltr"
                  className="rounded border border-[#E4BEB9] bg-[#FBF8FC] px-3 py-2 font-mono text-[11px] text-[#1B1B1E]"
                />

                <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleCopyQrLink(selectedQrUrl)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded border border-[#E4BEB9] text-[12px] font-semibold cursor-pointer hover:bg-[#F6F2F7]"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {qrCopied ? 'check' : 'content_copy'}
                    </span>
                    {qrCopied ? t.linkCopied : t.copyOfficialLink}
                  </button>
                  <a
                    href={selectedQrUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded border border-[#E4BEB9] text-[12px] font-semibold hover:bg-[#F6F2F7]"
                  >
                    <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                    {t.qrOpenLink}
                  </a>
                  <button
                    type="button"
                    disabled={qrDownloading}
                    onClick={() => handleDownloadQrPng(selectedContract, selectedQrUrl)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-[#93000B] text-white text-[12px] font-semibold hover:bg-[#B91C1C] cursor-pointer disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[16px]">download</span>
                    {t.qrDownloadPng}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-[13px] text-[#5B403D] py-4">{t.qrOfflinePending}</p>
            )}
          </div>
        </div>
      )}

      {isManager && (
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          title="Supprimer définitivement ce contrat ?"
          targetLabel={
            deleteTarget
              ? `${deleteTarget.contractNumber} · ${deleteTarget.customer?.fullName || ''}`
              : ''
          }
          message="Cette action supprimera définitivement le contrat sélectionné et ses données spécifiques. Le numéro de contrat pourra être réutilisé. Les clients, véhicules et autres enregistrements partagés sont conservés."
          confirmText={t.deleteContractBtn}
          loading={deleting}
          onConfirm={handleDeleteContract}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
};
