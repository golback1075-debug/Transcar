import React, { useEffect, useState } from 'react';
import { TRANSLATIONS, type Lang } from '../../i18n/translations.ts';
import {
  apiFetch,
  authorizedFileUrl,
  formatDate,
  formatDzd,
  triggerPdfPrint,
} from '../../lib/api.ts';
import { triggerOnePagePrint } from '../../lib/printFit.ts';
import { peekNextOfflineContractNumber } from '../../lib/offlineStore.ts';
import type {
  ContractItem,
  CustomerItem,
  ReservationItem,
  VehicleItem,
} from '../../types.ts';
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
  canDeleteContracts?: boolean;
  contracts: ContractItem[];
  nextContractNumber?: string;
  vehicles: VehicleItem[];
  customers: CustomerItem[];
  prefillReservation: ReservationItem | null;
  onClearPrefill: () => void;
  onRefresh: () => void | Promise<void>;
}

export const ContractsView: React.FC<Props> = ({
  lang,
  role,
  contracts,
  nextContractNumber,
  vehicles,
  customers,
  prefillReservation,
  onClearPrefill,
  onRefresh,
}) => {
  const t = TRANSLATIONS[lang];
  const isManager = role === 'manager';
  const pendingContracts = contracts.filter(
    (c) => c.status === 'pending' || c.status === 'upcoming',
  );
  const [selectedContract, setSelectedContract] = useState<ContractItem | null>(
    pendingContracts[0] || null,
  );
  const [showLicenceModal, setShowLicenceModal] = useState(false);

  // Creation form state
  const [customerId, setCustomerId] = useState<number>(customers[0]?.id || 0);
  const [vehicleId, setVehicleId] = useState<number>(vehicles[0]?.id || 0);
  const [reservationId, setReservationId] = useState<number | null>(null);
  const [startAt, setStartAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [endAt, setEndAt] = useState(() =>
    new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16),
  );
  const [depositDzd, setDepositDzd] = useState(30000);
  const [amountPaidDzd, setAmountPaidDzd] = useState(0);
  const [departureFuelLevel, setDepartureFuelLevel] = useState('4/4');
  const [departureMileage, setDepartureMileage] = useState<number>(
    vehicles[0]?.currentMileage ?? 0,
  );
  const [maxMileageLimit, setMaxMileageLimit] = useState('');
  const [pickupLocation, setPickupLocation] = useState('Blida');
  const [returnLocation, setReturnLocation] = useState('Blida');
  const [earlyReturnDate, setEarlyReturnDate] = useState('');
  const [earlyReturnTime, setEarlyReturnTime] = useState('');
  const [earlyReturnLocation, setEarlyReturnLocation] = useState('');
  const [extensionFromDate, setExtensionFromDate] = useState('');
  const [extensionUntilDate, setExtensionUntilDate] = useState('');
  const [extensionExitTime, setExtensionExitTime] = useState('');
  const [extensionEntryTime, setExtensionEntryTime] = useState('');
  const [driverCustomerId, setDriverCustomerId] = useState<number | null>(null);
  const [driverName, setDriverName] = useState('');
  const [driverDob, setDriverDob] = useState('');
  const [driverIdNumber, setDriverIdNumber] = useState('');
  const [driverLicenceNumber, setDriverLicenceNumber] = useState('');
  const [driverCountry, setDriverCountry] = useState('');
  const [driverAddress, setDriverAddress] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [contractNumberInput, setContractNumberInput] = useState('');
  const [previewDraftSheet, setPreviewDraftSheet] = useState(false);
  const [sheetLang, setSheetLang] = useState<'ar' | 'fr'>('ar');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [extendDate, setExtendDate] = useState('');
  const [extending, setExtending] = useState(false);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState('cash');
  const [payError, setPayError] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  // Edit contract modal state
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

  // Inline Add New Client modal (saves directly into existing Clients DB)
  const [addClientTarget, setAddClientTarget] = useState<'create' | 'edit' | null>(null);
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

  const [confirmTarget, setConfirmTarget] = useState<ContractItem | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContractItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrCopied, setQrCopied] = useState(false);
  const [qrDownloading, setQrDownloading] = useState(false);

  const displayedNextContractNumber =
    nextContractNumber || peekNextOfflineContractNumber();

  useEffect(() => {
    if (prefillReservation) {
      setCustomerId(prefillReservation.customerId);
      setVehicleId(prefillReservation.vehicleId);
      setReservationId(prefillReservation.id);
      setStartAt(new Date(prefillReservation.startDate).toISOString().slice(0, 16));
      setEndAt(new Date(prefillReservation.endDate).toISOString().slice(0, 16));
      const v = vehicles.find((item) => item.id === prefillReservation.vehicleId);
      if (v) setDepartureMileage(v.currentMileage);
      onClearPrefill();
    }
  }, [prefillReservation, vehicles, onClearPrefill]);

  useEffect(() => {
    if ((!customerId || !customers.some((c) => c.id === customerId)) && customers.length > 0) {
      setCustomerId(customers[0].id);
    }
  }, [customers, customerId]);

  useEffect(() => {
    if ((!vehicleId || !vehicles.some((v) => v.id === vehicleId)) && vehicles.length > 0) {
      setVehicleId(vehicles[0].id);
      setDepartureMileage(vehicles[0].currentMileage);
    }
  }, [vehicles, vehicleId]);

  useEffect(() => {
    const pending = contracts.filter((c) => c.status === 'pending' || c.status === 'upcoming');
    if (pending.length === 0) {
      if (selectedContract !== null) setSelectedContract(null);
      return;
    }
    if (!selectedContract) {
      setSelectedContract(pending[0]);
      return;
    }
    const updated = pending.find((c) => c.id === selectedContract.id);
    setSelectedContract(updated || pending[0]);
  }, [contracts]);

  const visibleContracts = pendingContracts;

  const chosenVehicle = vehicles.find((v) => v.id === (vehicleId || vehicles[0]?.id));
  const chosenCustomer = customers.find((c) => c.id === (customerId || customers[0]?.id));
  const calcDays = Math.max(
    1,
    Math.ceil(
      (new Date(endAt).getTime() - new Date(startAt).getTime()) / (24 * 60 * 60 * 1000),
    ) || 1,
  );
  const calcTotal = calcDays * (chosenVehicle?.dailyPriceDzd || 0);
  const calcRemaining = Math.max(0, calcTotal - amountPaidDzd);

  const chosenDriverCustomer = driverCustomerId
    ? customers.find((c) => c.id === driverCustomerId) || null
    : null;

  const applyCreateDriverClient = (c: CustomerItem | null) => {
    if (!c) {
      setDriverCustomerId(null);
      setDriverName('');
      setDriverDob('');
      setDriverIdNumber('');
      setDriverLicenceNumber('');
      setDriverCountry('');
      setDriverAddress('');
      setDriverPhone('');
      return;
    }
    setDriverCustomerId(c.id);
    setDriverName(c.fullName);
    setDriverDob([c.dateOfBirth, c.birthPlace].filter(Boolean).join(' · '));
    setDriverIdNumber(c.idNumber || '');
    setDriverLicenceNumber(c.licenceNumber || '');
    setDriverCountry(c.country || 'Algérie');
    setDriverAddress(c.address || '');
    setDriverPhone(c.phone || '');
    setPreviewDraftSheet(true);
  };

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

  const openAddClientModal = (target: 'create' | 'edit', prefillName: string) => {
    setAddClientTarget(target);
    setNewClientFullName(prefillName);
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
  };

  const handleSaveNewClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingNewClient || !addClientTarget) return;
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
      if (addClientTarget === 'create') {
        applyCreateDriverClient(res.customer);
      } else {
        applyEditDriverClient(res.customer);
      }
      setAddClientTarget(null);
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

  const manualTrimmed = contractNumberInput.trim();
  const parsedDraftMaxKm =
    maxMileageLimit.trim() !== '' && Number.isFinite(Number(maxMileageLimit))
      ? Math.round(Number(maxMileageLimit))
      : null;
  const draftPreviewContract: ContractItem | null =
    chosenCustomer && chosenVehicle
      ? {
          id: 0,
          contractNumber: manualTrimmed || displayedNextContractNumber,
          reservationId,
          vehicleId: chosenVehicle.id,
          customerId: chosenCustomer.id,
          driverCustomerId,
          driverName: driverName.trim(),
          driverDob: driverDob.trim(),
          driverIdNumber: driverIdNumber.trim(),
          driverLicenceNumber: driverLicenceNumber.trim(),
          driverCountry: driverCountry.trim(),
          driverAddress: driverAddress.trim(),
          driverPhone: driverPhone.trim(),
          startAt: Number.isNaN(new Date(startAt).getTime())
            ? new Date().toISOString()
            : new Date(startAt).toISOString(),
          endAt: Number.isNaN(new Date(endAt).getTime())
            ? new Date(Date.now() + 3 * 86400000).toISOString()
            : new Date(endAt).toISOString(),
          durationDays: calcDays,
          dailyPriceDzd: chosenVehicle.dailyPriceDzd,
          totalAmountDzd: calcTotal,
          depositDzd: Number.isFinite(depositDzd) ? depositDzd : 0,
          amountPaidDzd: Number.isFinite(amountPaidDzd) ? amountPaidDzd : 0,
          departureMileage: Number.isFinite(departureMileage)
            ? departureMileage
            : chosenVehicle.currentMileage,
          maxMileageLimit: parsedDraftMaxKm,
          departureFuelLevel,
          departureNotes: '',
          departureDamageJson: [],
          status: 'pending',
          pickupLocation: pickupLocation.trim() || 'Blida',
          returnLocation: returnLocation.trim() || 'Blida',
          extensionFromDate: extensionFromDate.trim(),
          extensionUntilDate: extensionUntilDate.trim(),
          extensionExitTime: extensionExitTime.trim(),
          extensionEntryTime: extensionEntryTime.trim(),
          earlyReturnDate: earlyReturnDate.trim(),
          earlyReturnTime: earlyReturnTime.trim(),
          earlyReturnLocation: earlyReturnLocation.trim(),
          version: 1,
          createdAt: new Date().toISOString(),
          vehicle: chosenVehicle,
          customer: chosenCustomer,
          driverCustomer: chosenDriverCustomer,
          returnRecord: null,
        }
      : null;

  const displayedSheetContract =
    previewDraftSheet && draftPreviewContract ? draftPreviewContract : selectedContract;

  const handleCreateContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    setError('');
    setFeedback(null);

    const effCustomerId = customerId || customers[0]?.id;
    const effVehicleId = vehicleId || vehicles[0]?.id;
    if (!effCustomerId || !effVehicleId) {
      setError('Veuillez sélectionner un client et un véhicule.');
      return;
    }
    const manualContractNumber = contractNumberInput.trim();
    if (manualContractNumber.length > 64) {
      setError('Le numéro de contrat ne doit pas dépasser 64 caractères.');
      return;
    }
    if (
      manualContractNumber &&
      contracts.some(
        (c) => c.contractNumber.trim().toLowerCase() === manualContractNumber.toLowerCase(),
      )
    ) {
      setError('Ce numéro de contrat existe déjà. Veuillez saisir un numéro unique.');
      return;
    }
    const startObj = new Date(startAt);
    const endObj = new Date(endAt);
    if (Number.isNaN(startObj.getTime()) || Number.isNaN(endObj.getTime()) || endObj <= startObj) {
      setError('La date et heure de retour doivent être postérieures au départ.');
      return;
    }
    if (!Number.isFinite(departureMileage) || departureMileage < 0) {
      setError('Le kilométrage de départ doit être supérieur ou égal à 0.');
      return;
    }
    const maxKmTrimmed = maxMileageLimit.trim();
    const maxKmVal = maxKmTrimmed === '' ? null : Number(maxKmTrimmed);
    if (maxKmVal !== null && (!Number.isFinite(maxKmVal) || maxKmVal < 0)) {
      setError('Le kilométrage maximal autorisé doit être supérieur ou égal à 0.');
      return;
    }
    if (!Number.isFinite(depositDzd) || depositDzd < 0 || !Number.isFinite(amountPaidDzd) || amountPaidDzd < 0) {
      setError('La caution et le montant versé doivent être positifs ou nuls.');
      return;
    }

    setCreating(true);
    try {
      const res = await apiFetch<{ contract: ContractItem }>('/api/contracts', {
        method: 'POST',
        body: JSON.stringify({
          ...(manualContractNumber ? { contractNumber: manualContractNumber } : {}),
          customerId: effCustomerId,
          vehicleId: effVehicleId,
          reservationId,
          startAt: startObj.toISOString(),
          endAt: endObj.toISOString(),
          depositDzd,
          amountPaidDzd,
          departureFuelLevel,
          departureMileage,
          maxMileageLimit: maxKmVal !== null ? Math.round(maxKmVal) : null,
          pickupLocation: pickupLocation.trim() || 'Blida',
          returnLocation: returnLocation.trim() || 'Blida',
          earlyReturnDate: earlyReturnDate.trim(),
          earlyReturnTime: earlyReturnTime.trim(),
          earlyReturnLocation: earlyReturnLocation.trim(),
          extensionFromDate: extensionFromDate.trim(),
          extensionUntilDate: extensionUntilDate.trim(),
          extensionExitTime: extensionExitTime.trim(),
          extensionEntryTime: extensionEntryTime.trim(),
          driverCustomerId,
          driverName: driverName.trim(),
          driverDob: driverDob.trim(),
          driverIdNumber: driverIdNumber.trim(),
          driverLicenceNumber: driverLicenceNumber.trim(),
          driverCountry: driverCountry.trim(),
          driverAddress: driverAddress.trim(),
          driverPhone: driverPhone.trim(),
        }),
      });
      setReservationId(null);
      applyCreateDriverClient(null);
      setContractNumberInput('');
      setMaxMileageLimit('');
      setEarlyReturnDate('');
      setEarlyReturnTime('');
      setEarlyReturnLocation('');
      setExtensionFromDate('');
      setExtensionUntilDate('');
      setExtensionExitTime('');
      setExtensionEntryTime('');
      setPreviewDraftSheet(false);
      setAmountPaidDzd(0);
      await onRefresh();
      const updatedList = await apiFetch<{ contracts: ContractItem[] }>('/api/contracts');
      const full = updatedList.contracts.find((c) => c.id === res.contract.id) || res.contract;
      setSelectedContract(full);
      setFeedback({
        type: 'success',
        text: `Contrat officiel ${full.contractNumber} créé (en attente de confirmation).`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la création du contrat');
    } finally {
      setCreating(false);
    }
  };

  const openEditContractModal = (ct: ContractItem) => {
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
    if (!editingContract || savingEdit) return;
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
    if (!Number.isFinite(editMileage) || editMileage < 0 || !Number.isFinite(editDepositDzd) || editDepositDzd < 0) {
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
        text: `Contrat ${nextNum} mis à jour.`,
      });
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Impossible de modifier le contrat.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmContract = async () => {
    if (!confirmTarget || confirming) return;
    setConfirming(true);
    setFeedback(null);
    try {
      await apiFetch(`/api/contracts/${confirmTarget.id}/confirm`, {
        method: 'POST',
      });
      const confirmedNumber = confirmTarget.contractNumber;
      if (selectedContract?.id === confirmTarget.id) {
        setSelectedContract(null);
      }
      await onRefresh();
      setFeedback({
        type: 'success',
        text: `Contrat ${confirmedNumber} confirmé et transféré vers Retours véhicules.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Impossible de confirmer le contrat.',
      });
    } finally {
      setConfirming(false);
      setConfirmTarget(null);
    }
  };

  const handleDeleteContract = async () => {
    if (!deleteTarget || deleting) return;
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

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContract || savingPayment) return;
    setPayError('');
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      setPayError('Veuillez saisir un montant supérieur à 0 DZD.');
      return;
    }
    setSavingPayment(true);
    try {
      await apiFetch(`/api/contracts/${selectedContract.id}/payment`, {
        method: 'POST',
        body: JSON.stringify({ amountDzd: payAmount, paymentMethod: payMethod }),
      });
      setPayModalOpen(false);
      setPayAmount(0);
      setFeedback({ type: 'success', text: `Paiement de ${formatDzd(payAmount)} enregistré.` });
      await onRefresh();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Erreur paiement');
    } finally {
      setSavingPayment(false);
    }
  };

  const handleExtendContract = async () => {
    if (!selectedContract || extending) return;
    setFeedback(null);
    if (!extendDate) {
      setFeedback({ type: 'error', text: 'Veuillez choisir une nouvelle date de retour pour prolonger.' });
      return;
    }
    const newEnd = new Date(extendDate);
    if (Number.isNaN(newEnd.getTime()) || newEnd <= new Date(selectedContract.endAt)) {
      setFeedback({
        type: 'error',
        text: 'La date de prolongation doit être postérieure au retour actuel.',
      });
      return;
    }
    setExtending(true);
    try {
      await apiFetch(`/api/contracts/${selectedContract.id}/extend`, {
        method: 'POST',
        body: JSON.stringify({ newEndAt: newEnd.toISOString() }),
      });
      setExtendDate('');
      await onRefresh();
      setFeedback({
        type: 'success',
        text: `Contrat ${selectedContract.contractNumber} prolongé jusqu'au ${formatDate(newEnd)}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Impossible de prolonger le contrat.',
      });
    } finally {
      setExtending(false);
    }
  };

  const selectedQrUrl =
    selectedContract?.digitalAccessToken
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
      {/* Header Bar */}
      <section className="no-print bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="px-3.5 py-2 rounded font-label text-[13px] font-semibold bg-[#111114] text-white">
            Contrats à confirmer ({visibleContracts.length})
          </span>
          <span className="text-[12px] text-[#5B403D]">
            Confirmez un contrat pour l’envoyer vers Retours véhicules et verrouiller le véhicule.
          </span>
        </div>

        {displayedSheetContract && (
          <div className="flex flex-wrap items-center gap-2">
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
              onClick={() => triggerPdfPrint(`${displayedSheetContract.contractNumber}.pdf`)}
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
        {/* Left Column: Contract Creation Form + Historical List */}
        <div className="no-print lg:col-span-5 flex flex-col gap-6">
          <section className="bg-white border border-[#E4BEB9] rounded-lg p-5 flex flex-col gap-4">
            <header className="border-b border-[#E4BEB9] pb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-title text-[18px] font-semibold text-[#1B1B1E]">
                  {t.newContract}
                </h2>
                <p className="text-[12px] text-[#5B403D]">
                  Calcul automatique de durée, montant et solde
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span className="text-[10px] font-label uppercase text-[#5B403D] block">
                  N° Contrat auto
                </span>
                <span
                  data-testid="next-contract-number"
                  className="inline-block font-mono text-[12px] font-bold text-[#93000B] bg-[#F6F2F7] border border-[#E4BEB9] px-2.5 py-1 rounded"
                >
                  {displayedNextContractNumber}
                </span>
              </div>
            </header>

            <form noValidate onSubmit={handleCreateContract} className="flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-[12px] font-semibold">N° CONTRAT</span>
                  <input
                    type="text"
                    value={contractNumberInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setContractNumberInput(val);
                      setPreviewDraftSheet(val.trim().length > 0);
                    }}
                    placeholder={displayedNextContractNumber}
                    className="rounded border border-[#E4BEB9] px-2.5 py-2 font-mono text-[13px]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold">Client *</span>
                  <select
                    required
                    value={customerId || customers[0]?.id || ''}
                    onChange={(e) => setCustomerId(Number(e.target.value))}
                    className="rounded border border-[#E4BEB9] px-2.5 py-2 text-[13px]"
                  >
                    {customers.length === 0 && <option value="">Aucun client</option>}
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName} · {c.phone}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold">Véhicule *</span>
                  <select
                    required
                    value={vehicleId || vehicles[0]?.id || ''}
                    onChange={(e) => {
                      const vid = Number(e.target.value);
                      setVehicleId(vid);
                      const v = vehicles.find((x) => x.id === vid);
                      if (v) setDepartureMileage(v.currentMileage);
                    }}
                    className="rounded border border-[#E4BEB9] px-2.5 py-2 text-[13px]"
                  >
                    {vehicles.length === 0 && <option value="">Aucun véhicule</option>}
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.brand} {v.model} · {v.registrationNumber}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold">Date départ *</span>
                  <input
                    type="datetime-local"
                    required
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    className="rounded border border-[#E4BEB9] px-2.5 py-2 text-[12px]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold">Date retour *</span>
                  <input
                    type="datetime-local"
                    required
                    value={endAt}
                    onChange={(e) => setEndAt(e.target.value)}
                    className="rounded border border-[#E4BEB9] px-2.5 py-2 text-[12px]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold">Km départ</span>
                  <input
                    type="number"
                    min={0}
                    value={departureMileage}
                    onChange={(e) => setDepartureMileage(Number(e.target.value))}
                    className="rounded border border-[#E4BEB9] px-2.5 py-2 font-mono text-[13px]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold">Carburant départ</span>
                  <select
                    value={departureFuelLevel}
                    onChange={(e) => setDepartureFuelLevel(e.target.value)}
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
                    value={depositDzd}
                    onChange={(e) => setDepositDzd(Number(e.target.value))}
                    className="rounded border border-[#E4BEB9] px-2.5 py-2 font-mono text-[13px]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold">Montant versé (DZD)</span>
                  <input
                    type="number"
                    min={0}
                    value={amountPaidDzd}
                    onChange={(e) => setAmountPaidDzd(Number(e.target.value))}
                    className="rounded border border-[#E4BEB9] px-2.5 py-2 font-mono text-[13px]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold">Km max autorisé (KM)</span>
                  <input
                    type="number"
                    min={0}
                    placeholder="Ex: 150000"
                    value={maxMileageLimit}
                    onChange={(e) => setMaxMileageLimit(e.target.value)}
                    className="rounded border border-[#E4BEB9] px-2.5 py-2 font-mono text-[13px]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold">Lieu remise / retour</span>
                  <input
                    value={pickupLocation}
                    onChange={(e) => {
                      setPickupLocation(e.target.value);
                      setReturnLocation(e.target.value);
                    }}
                    className="rounded border border-[#E4BEB9] px-2.5 py-2 text-[13px]"
                  />
                </label>

                {/* Early return & Extension document fields */}
                <div className="sm:col-span-2 rounded border border-[#E4BEB9] bg-[#FBF8FC] p-2.5 flex flex-col gap-2">
                  <span className="text-[11px] font-bold uppercase text-[#93000B]">
                    Retour anticipé &amp; Prolongation (optionnel sur contrat)
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-semibold">Date retour anticipé</span>
                      <input
                        type="text"
                        placeholder="JJ/MM/AAAA"
                        value={earlyReturnDate}
                        onChange={(e) => setEarlyReturnDate(e.target.value)}
                        className="rounded border border-[#E4BEB9] bg-white px-2 py-1.5 text-[12px]"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-semibold">Heure retour anticipé</span>
                      <input
                        type="text"
                        placeholder="HH:MM"
                        value={earlyReturnTime}
                        onChange={(e) => setEarlyReturnTime(e.target.value)}
                        className="rounded border border-[#E4BEB9] bg-white px-2 py-1.5 text-[12px]"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-semibold">Lieu retour anticipé</span>
                      <input
                        type="text"
                        placeholder="Lieu"
                        value={earlyReturnLocation}
                        onChange={(e) => setEarlyReturnLocation(e.target.value)}
                        className="rounded border border-[#E4BEB9] bg-white px-2 py-1.5 text-[12px]"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-semibold">Prolong. du</span>
                      <input
                        type="text"
                        placeholder="JJ/MM/AAAA"
                        value={extensionFromDate}
                        onChange={(e) => setExtensionFromDate(e.target.value)}
                        className="rounded border border-[#E4BEB9] bg-white px-2 py-1.5 text-[12px]"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-semibold">Prolong. au</span>
                      <input
                        type="text"
                        placeholder="JJ/MM/AAAA"
                        value={extensionUntilDate}
                        onChange={(e) => setExtensionUntilDate(e.target.value)}
                        className="rounded border border-[#E4BEB9] bg-white px-2 py-1.5 text-[12px]"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-semibold">Heure sortie</span>
                      <input
                        type="text"
                        placeholder="HH:MM"
                        value={extensionExitTime}
                        onChange={(e) => setExtensionExitTime(e.target.value)}
                        className="rounded border border-[#E4BEB9] bg-white px-2 py-1.5 text-[12px]"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-semibold">Heure entrée</span>
                      <input
                        type="text"
                        placeholder="HH:MM"
                        value={extensionEntryTime}
                        onChange={(e) => setExtensionEntryTime(e.target.value)}
                        className="rounded border border-[#E4BEB9] bg-white px-2 py-1.5 text-[12px]"
                      />
                    </label>
                  </div>
                </div>

                <div className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-[12px] font-semibold">Conducteur (si autre)</span>
                  <DriverClientSelector
                    customers={customers}
                    selectedDriverId={driverCustomerId}
                    fallbackDriverName={driverName}
                    renterCustomerId={customerId || customers[0]?.id}
                    onSelectClient={applyCreateDriverClient}
                    onRequestAddClient={(prefill) => openAddClientModal('create', prefill)}
                  />
                  {driverName.trim() && (
                    <div className="mt-1 px-2.5 py-1.5 rounded bg-[#F6F2F7] border border-[#E4BEB9] text-[11px] text-[#5B403D] flex flex-wrap gap-x-3 gap-y-0.5">
                      <span className="font-semibold text-[#1B1B1E]">{driverName}</span>
                      {driverPhone && <span>Tél: {driverPhone}</span>}
                      {driverIdNumber && <span>Pièce: {driverIdNumber}</span>}
                      {driverLicenceNumber && <span>Permis: {driverLicenceNumber}</span>}
                      {driverAddress && <span>Adresse: {driverAddress}</span>}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[#F6F2F7] border border-[#E4BEB9] grid grid-cols-3 gap-2 text-center">
                <div>
                  <span className="text-[11px] text-[#5B403D] block">Durée</span>
                  <span className="font-semibold text-[13px]">{calcDays} j</span>
                </div>
                <div>
                  <span className="text-[11px] text-[#5B403D] block">Total</span>
                  <span className="font-semibold text-[13px] text-[#93000B] tabular-nums">
                    {formatDzd(calcTotal)}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-[#5B403D] block">Reste</span>
                  <span className="font-semibold text-[13px] text-[#BA1A1A] tabular-nums">
                    {formatDzd(calcRemaining)}
                  </span>
                </div>
              </div>

              {chosenCustomer && (
                <div
                  className={`p-3 rounded-lg flex items-center justify-between text-[12px] ${
                    chosenCustomer.licenceFrontUrl && chosenCustomer.licenceBackUrl
                      ? 'bg-[#DCFCE7] text-[#14532D]'
                      : 'bg-[#FEF3C7] text-[#78350F]'
                  }`}
                >
                  <span className="font-semibold">
                    {chosenCustomer.licenceFrontUrl && chosenCustomer.licenceBackUrl
                      ? 'Permis de conduire recto/verso vérifié'
                      : 'Permis de conduire incomplet'}
                  </span>
                  {(chosenCustomer.licenceFrontUrl || chosenCustomer.licenceBackUrl) && (
                    <button
                      type="button"
                      onClick={() => setShowLicenceModal(true)}
                      className="underline font-semibold cursor-pointer"
                    >
                      Afficher
                    </button>
                  )}
                </div>
              )}

              {error && (
                <p className="text-[12px] font-semibold text-[#BA1A1A] bg-[#FFDAD6] px-3 py-2 rounded">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={creating || vehicles.length === 0 || customers.length === 0}
                className="px-4 py-2.5 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] font-label text-[13px] font-semibold cursor-pointer disabled:opacity-50"
              >
                {creating ? 'Création en cours...' : 'Créer le contrat officiel'}
              </button>
            </form>
          </section>

          {/* Pending Contracts List with Confirmer / Supprimer actions */}
          <section className="bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-col gap-2">
            <h3 className="font-title text-[15px] font-semibold text-[#1B1B1E] pb-2 border-b border-[#E4BEB9]">
              Contrats en attente ({visibleContracts.length})
            </h3>
            {visibleContracts.length === 0 ? (
              <p className="text-[13px] text-[#5B403D] py-4 text-center">
                Aucun contrat en attente de confirmation.
              </p>
            ) : (
              visibleContracts.map((ct) => (
                <div
                  key={ct.id}
                  className={`p-3 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                    !previewDraftSheet && selectedContract?.id === ct.id
                      ? 'border-[#93000B] bg-[#FFDAD6]/30'
                      : 'border-[#E4BEB9] hover:bg-[#F6F2F7]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewDraftSheet(false);
                      setSelectedContract(ct);
                    }}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <span className="font-mono text-[13px] font-semibold block truncate">
                      {ct.contractNumber} · {ct.customer?.fullName}
                    </span>
                    <span className="text-[12px] text-[#5B403D] tabular-nums block">
                      {ct.vehicle?.brand} {ct.vehicle?.model} · {formatDate(ct.startAt)} →{' '}
                      {formatDate(ct.endAt)}
                    </span>
                    <span className="font-mono text-[12px] font-semibold text-[#93000B] tabular-nums">
                      {formatDzd(ct.totalAmountDzd)}
                    </span>
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setConfirmTarget(ct)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#15803D] text-white hover:bg-[#166534] text-[12px] font-semibold cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[15px]">check_circle</span>
                      {t.confirmContractBtn}
                    </button>
                    {isManager && (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(ct)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-[#BA1A1A] text-[#BA1A1A] hover:bg-[#FFDAD6] text-[12px] font-semibold cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[15px]">delete</span>
                        {t.deleteContractBtn}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </section>
        </div>

        {/* Right Column: Official Contract Sheet & Controls */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          {displayedSheetContract ? (
            <>
              {!previewDraftSheet && selectedContract && (
                <div className="no-print bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="font-mono text-[14px] font-bold text-[#93000B]">
                      {selectedContract.contractNumber}
                    </span>
                    <span className="text-[12px] text-[#5B403D] block">
                      Payé : {formatDzd(selectedContract.amountPaidDzd)} / Total :{' '}
                      {formatDzd(selectedContract.totalAmountDzd)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmTarget(selectedContract)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-[#15803D] text-white hover:bg-[#166534] text-[12px] font-semibold cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[15px]">check_circle</span>
                      {t.confirmContractBtn}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowQrModal(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#111114] text-white hover:bg-[#303033] text-[12px] font-semibold cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[15px]">qr_code_2</span>
                      {t.qrCodeBtn}
                    </button>
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
                      onClick={() => {
                        setPayAmount(
                          Math.max(0, selectedContract.totalAmountDzd - selectedContract.amountPaidDzd),
                        );
                        setPayError('');
                        setPayModalOpen(true);
                      }}
                      className="px-3 py-1.5 rounded bg-[#111114] text-white hover:bg-[#303033] text-[12px] font-semibold cursor-pointer"
                    >
                      + Paiement
                    </button>
                    <input
                      type="datetime-local"
                      value={extendDate}
                      onChange={(e) => setExtendDate(e.target.value)}
                      className="rounded border border-[#E4BEB9] px-2 py-1 text-[12px]"
                    />
                    <button
                      type="button"
                      disabled={extending}
                      onClick={handleExtendContract}
                      className="px-3 py-1.5 rounded border border-[#E4BEB9] text-[12px] font-semibold cursor-pointer hover:bg-[#F6F2F7] disabled:opacity-50"
                    >
                      {extending ? 'Prolongation...' : 'Prolonger'}
                    </button>
                    {isManager && (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(selectedContract)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-[#BA1A1A] text-[#BA1A1A] hover:bg-[#FFDAD6] text-[12px] font-semibold cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[15px]">delete</span>
                        {t.deleteContractBtn}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {!previewDraftSheet && selectedContract && (
                <div className="no-print bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    {selectedQrUrl ? (
                      <button
                        type="button"
                        onClick={() => setShowQrModal(true)}
                        title={t.qrAccessTitle}
                        className="p-1.5 rounded-lg border border-[#E4BEB9] bg-white hover:border-[#93000B] transition-colors shrink-0 cursor-pointer"
                      >
                        <ContractQrCode
                          value={selectedQrUrl}
                          size={76}
                          quietMargin={1}
                          label={`${t.qrCodeBtn} ${selectedContract.contractNumber}`}
                        />
                      </button>
                    ) : (
                      <div className="w-[88px] h-[88px] rounded-lg border border-dashed border-[#E4BEB9] bg-[#F6F2F7] flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[28px] text-[#8F6F6C]">
                          qr_code_2
                        </span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <h4 className="font-title text-[14px] font-semibold text-[#1B1B1E]">
                        {t.qrAccessTitle}
                      </h4>
                      <p className="text-[12px] text-[#5B403D] mt-0.5">
                        {selectedQrUrl ? t.qrAccessDesc : t.qrOfflinePending}
                      </p>
                      {selectedQrUrl && (
                        <p
                          dir="ltr"
                          className="font-mono text-[11px] text-[#5B403D] truncate max-w-md mt-1"
                        >
                          {selectedQrUrl}
                        </p>
                      )}
                    </div>
                  </div>

                  {selectedQrUrl && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopyQrLink(selectedQrUrl)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#E4BEB9] text-[12px] font-semibold text-[#1B1B1E] hover:bg-[#F6F2F7] cursor-pointer whitespace-nowrap"
                      >
                        <span className="material-symbols-outlined text-[15px]">
                          {qrCopied ? 'check' : 'content_copy'}
                        </span>
                        {qrCopied ? t.linkCopied : t.copyOfficialLink}
                      </button>
                      <a
                        href={selectedQrUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#E4BEB9] text-[12px] font-semibold text-[#1B1B1E] hover:bg-[#F6F2F7] whitespace-nowrap"
                      >
                        <span className="material-symbols-outlined text-[15px]">open_in_new</span>
                        {t.qrOpenLink}
                      </a>
                      <button
                        type="button"
                        disabled={qrDownloading}
                        onClick={() => handleDownloadQrPng(selectedContract, selectedQrUrl)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] text-[12px] font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      >
                        <span className="material-symbols-outlined text-[15px]">download</span>
                        {t.qrDownloadPng}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <OfficialContractSheet contract={displayedSheetContract} sheetLang={sheetLang} />
            </>
          ) : (
            <div className="no-print bg-white border border-[#E4BEB9] rounded-lg p-12 text-center text-[#5B403D]">
              Créez ou sélectionnez un contrat pour afficher le contrat officiel TRANSCAR Blida.
            </div>
          )}
        </div>
      </div>

      {/* Driving Licence Quick Preview Modal */}
      {showLicenceModal && chosenCustomer && (
        <div className="no-print fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E4BEB9] rounded-xl max-w-2xl w-full p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-[#E4BEB9] pb-3">
              <h3 className="font-title text-[18px] font-semibold">
                Permis de conduire · {chosenCustomer.fullName}
              </h3>
              <button
                type="button"
                onClick={() => setShowLicenceModal(false)}
                className="w-8 h-8 rounded border border-[#E4BEB9] flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <span className="text-[12px] font-semibold block mb-1">Recto</span>
                {chosenCustomer.licenceFrontUrl ? (
                  <a
                    href={authorizedFileUrl(chosenCustomer.licenceFrontUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="block p-3 border border-[#E4BEB9] rounded text-center text-[#93000B] font-semibold"
                  >
                    Ouvrir Recto
                  </a>
                ) : (
                  <span className="text-[12px] text-[#5B403D]">Non fourni</span>
                )}
              </div>
              <div>
                <span className="text-[12px] font-semibold block mb-1">Verso</span>
                {chosenCustomer.licenceBackUrl ? (
                  <a
                    href={authorizedFileUrl(chosenCustomer.licenceBackUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="block p-3 border border-[#E4BEB9] rounded text-center text-[#93000B] font-semibold"
                  >
                    Ouvrir Verso
                  </a>
                ) : (
                  <span className="text-[12px] text-[#5B403D]">Non fourni</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {payModalOpen && selectedContract && (
        <div className="no-print fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            noValidate
            onSubmit={handleAddPayment}
            className="bg-white border border-[#E4BEB9] rounded-xl max-w-md w-full p-6 flex flex-col gap-4"
          >
            <h3 className="font-headline text-[18px] font-bold text-[#1B1B1E]">
              Encaisser un paiement · {selectedContract.contractNumber}
            </h3>
            {payError && (
              <p className="text-[12px] font-semibold text-[#BA1A1A] bg-[#FFDAD6] px-3 py-2 rounded">
                {payError}
              </p>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold">Montant (DZD) *</span>
              <input
                type="number"
                required
                min={1}
                value={payAmount || ''}
                onChange={(e) => setPayAmount(Number(e.target.value))}
                className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold">Mode de paiement</span>
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
              >
                <option value="cash">Espèces</option>
                <option value="card">Carte CIB / Edahabia</option>
                <option value="transfer">Virement</option>
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayModalOpen(false)}
                className="px-4 py-2 rounded border border-[#E4BEB9] text-[13px] font-semibold cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={savingPayment}
                className="px-4 py-2 rounded bg-[#93000B] text-white text-[13px] font-semibold cursor-pointer disabled:opacity-50"
              >
                {savingPayment ? 'Validation...' : 'Valider'}
              </button>
            </div>
          </form>
        </div>
      )}

      {editingContract && (
        <div className="no-print fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            noValidate
            onSubmit={handleSaveContractEdit}
            className="bg-white border border-[#E4BEB9] rounded-xl max-w-lg w-full p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-[#E4BEB9] pb-3">
              <div>
                <h3 className="font-headline text-[18px] font-bold text-[#1B1B1E]">
                  Modifier le contrat
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
                  onRequestAddClient={(prefill) => openAddClientModal('edit', prefill)}
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

      {addClientTarget && (
        <div className="no-print fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E4BEB9] rounded-xl max-w-xl w-full p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#E4BEB9] pb-3">
              <h3 className="font-headline text-[18px] font-bold text-[#1B1B1E]">
                Ajouter un nouveau client (Conducteur)
              </h3>
              <button
                type="button"
                onClick={() => setAddClientTarget(null)}
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
                  onClick={() => setAddClientTarget(null)}
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

      <ConfirmDialog
        open={Boolean(confirmTarget)}
        title="Confirmer ce contrat ?"
        targetLabel={
          confirmTarget
            ? `${confirmTarget.contractNumber} · ${confirmTarget.customer?.fullName || ''} (${confirmTarget.vehicle?.brand || ''} ${confirmTarget.vehicle?.model || ''})`
            : ''
        }
        message="Une fois confirmé, le contrat passera au statut « Confirmé », sera déplacé vers la section Retours véhicules et le véhicule deviendra indisponible pour la période de location."
        confirmText={t.confirmContractBtn}
        loading={confirming}
        onConfirm={handleConfirmContract}
        onCancel={() => setConfirmTarget(null)}
      />

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
    </div>
  );
};
