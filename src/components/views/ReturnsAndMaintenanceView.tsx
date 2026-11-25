import React, { useEffect, useState } from 'react';
import { TRANSLATIONS, type Lang } from '../../i18n/translations.ts';
import { apiFetch, formatDate, formatDateTime, formatDzd, formatKm } from '../../lib/api.ts';
import type {
  ContractItem,
  MaintenanceAlertItem,
  MaintenanceItem,
  ReturnItem,
  VehicleItem,
} from '../../types.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

interface Props {
  lang: Lang;
  canDeleteMaintenance?: boolean;
  contracts: ContractItem[];
  vehicles: VehicleItem[];
  returns: ReturnItem[];
  maintenanceRecords: MaintenanceItem[];
  maintenanceAlerts: MaintenanceAlertItem[];
  preselectedContractId?: number | null;
  preselectedVehicleId?: number | null;
  onClearPreselect: () => void;
  onRefresh: () => void | Promise<void>;
}

export const ReturnsAndMaintenanceView: React.FC<Props> = ({
  lang,
  canDeleteMaintenance = true,
  contracts,
  vehicles,
  returns,
  maintenanceRecords,
  maintenanceAlerts,
  preselectedContractId,
  preselectedVehicleId,
  onClearPreselect,
  onRefresh,
}) => {
  const t = TRANSLATIONS[lang];
  const activeContracts = contracts.filter(
    (c) => c.status === 'confirmed' || c.status === 'active',
  );

  // Return Inspection State
  const [contractId, setContractId] = useState<number>(
    preselectedContractId || activeContracts[0]?.id || 0,
  );
  const [returnedAt, setReturnedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [returnMileage, setReturnMileage] = useState<number>(0);
  const [fuelLevel, setFuelLevel] = useState('4/4');
  const [damageFeeDzd, setDamageFeeDzd] = useState(0);
  const [fuelCleaningFeeDzd, setFuelCleaningFeeDzd] = useState(0);
  const [collectedAmountDzd, setCollectedAmountDzd] = useState(0);
  const [refundDepositDzd, setRefundDepositDzd] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [conditionNotes, setConditionNotes] = useState('');
  const [returnError, setReturnError] = useState('');
  const [submittingReturn, setSubmittingReturn] = useState(false);

  // Maintenance Modal State
  const [maintModalOpen, setMaintModalOpen] = useState(false);
  const [maintVehicleId, setMaintVehicleId] = useState<number>(
    preselectedVehicleId || vehicles[0]?.id || 0,
  );
  const [maintType, setMaintType] = useState<'graissage' | 'bougies' | 'kit_chaine' | 'other'>(
    'graissage',
  );
  const [maintDate, setMaintDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [mileageAtService, setMileageAtService] = useState<number>(0);
  const [costDzd, setCostDzd] = useState<number>(0);
  const [maintNotes, setMaintNotes] = useState('');
  const [markCompletedImmediately, setMarkCompletedImmediately] = useState(false);
  const [maintError, setMaintError] = useState('');
  const [savingMaint, setSavingMaint] = useState(false);

  // Complete Maintenance Modal
  const [completingItem, setCompletingItem] = useState<MaintenanceItem | null>(null);
  const [completeCost, setCompleteCost] = useState<number>(0);
  const [completeMileage, setCompleteMileage] = useState<number>(0);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState('');

  // Delete Maintenance state
  const [confirmMaint, setConfirmMaint] = useState<MaintenanceItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Quick Confirm Return Dialog state
  const [quickReturnTarget, setQuickReturnTarget] = useState<ContractItem | null>(null);
  const [quickReturnedAt, setQuickReturnedAt] = useState(() =>
    new Date().toISOString().slice(0, 16),
  );
  const [quickReturnMileage, setQuickReturnMileage] = useState<number>(0);
  const [quickReturnFuel, setQuickReturnFuel] = useState('4/4');
  const [quickReturnNotes, setQuickReturnNotes] = useState('');
  const [quickReturnError, setQuickReturnError] = useState('');
  const [submittingQuickReturn, setSubmittingQuickReturn] = useState(false);

  useEffect(() => {
    if (preselectedContractId) {
      setContractId(preselectedContractId);
      const found = activeContracts.find((c) => c.id === preselectedContractId);
      if (found) setReturnMileage(found.departureMileage);
      onClearPreselect();
    } else if (
      activeContracts.length > 0 &&
      (!contractId || !activeContracts.some((c) => c.id === contractId))
    ) {
      setContractId(activeContracts[0].id);
      setReturnMileage(activeContracts[0].departureMileage);
    } else if (activeContracts.length === 0 && contractId !== 0) {
      setContractId(0);
    }
  }, [preselectedContractId, activeContracts, contractId, onClearPreselect]);

  useEffect(() => {
    if (preselectedVehicleId) {
      setMaintVehicleId(preselectedVehicleId);
      const v = vehicles.find((item) => item.id === preselectedVehicleId);
      if (v) setMileageAtService(v.currentMileage);
      setMaintModalOpen(true);
      onClearPreselect();
    } else if (
      vehicles.length > 0 &&
      (!maintVehicleId || !vehicles.some((v) => v.id === maintVehicleId))
    ) {
      setMaintVehicleId(vehicles[0].id);
      setMileageAtService(vehicles[0].currentMileage);
    }
  }, [preselectedVehicleId, vehicles, maintVehicleId, onClearPreselect]);

  const selectedContract = activeContracts.find((c) => c.id === contractId) || null;

  // Live calculation matching Art. 01 & Art. 02
  const lateCalc = (() => {
    if (!selectedContract) return { lateHours: 0, extraDays: 0, lateFeeDzd: 0 };
    const expected = new Date(selectedContract.endAt).getTime();
    const actual = new Date(returnedAt).getTime();
    const diffHours = Math.max(0, (actual - expected) / (1000 * 60 * 60));
    const lateHours = Math.round(diffHours * 10) / 10;
    let extraDays = 0;
    if (diffHours > 6) extraDays = 1;
    else if (diffHours > 3) extraDays = 0.5;
    return {
      lateHours,
      extraDays,
      lateFeeDzd: Math.round(extraDays * selectedContract.dailyPriceDzd),
    };
  })();

  const distanceCalc = (() => {
    if (!selectedContract) return { allowedKm: 0, drivenKm: 0, extraKm: 0, extraKmFeeDzd: 0 };
    const allowedKm = Math.max(1, selectedContract.durationDays) * 350;
    const drivenKm = Math.max(0, returnMileage - selectedContract.departureMileage);
    const extraKm = Math.max(0, drivenKm - allowedKm);
    return {
      allowedKm,
      drivenKm,
      extraKm,
      extraKmFeeDzd: extraKm * 50,
    };
  })();

  const totalExtraFees =
    lateCalc.lateFeeDzd + distanceCalc.extraKmFeeDzd + damageFeeDzd + fuelCleaningFeeDzd;
  const remainingDueAtReturn = selectedContract
    ? Math.max(0, selectedContract.totalAmountDzd - selectedContract.amountPaidDzd) + totalExtraFees
    : 0;

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContract || submittingReturn) return;
    setReturnError('');
    if (!returnedAt) {
      setReturnError('La date et heure de retour sont obligatoires.');
      return;
    }
    if (!Number.isFinite(returnMileage) || returnMileage < selectedContract.departureMileage) {
      setReturnError(
        `Le kilométrage retour doit être supérieur ou égal au départ (${selectedContract.departureMileage} km).`,
      );
      return;
    }
    if (damageFeeDzd < 0 || fuelCleaningFeeDzd < 0 || collectedAmountDzd < 0 || refundDepositDzd < 0) {
      setReturnError('Les montants saisis ne peuvent pas être négatifs.');
      return;
    }
    setSubmittingReturn(true);
    try {
      await apiFetch('/api/returns', {
        method: 'POST',
        body: JSON.stringify({
          contractId: selectedContract.id,
          returnedAt: new Date(returnedAt).toISOString(),
          returnMileage,
          fuelLevel,
          conditionNotes: conditionNotes.trim(),
          damageFeeDzd,
          fuelCleaningFeeDzd,
          collectedAmountDzd,
          refundDepositDzd,
          paymentMethod,
        }),
      });
      setConditionNotes('');
      setDamageFeeDzd(0);
      setFuelCleaningFeeDzd(0);
      setCollectedAmountDzd(0);
      setRefundDepositDzd(0);
      await onRefresh();
      setFeedback({
        type: 'success',
        text: `Retour enregistré et contrat ${selectedContract.contractNumber} clôturé.`,
      });
    } catch (err) {
      setReturnError(err instanceof Error ? err.message : 'Erreur lors de la validation du retour');
    } finally {
      setSubmittingReturn(false);
    }
  };

  const handleCreateMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingMaint) return;
    setMaintError('');
    const targetVId = maintVehicleId || vehicles[0]?.id;
    if (!targetVId) {
      setMaintError('Veuillez sélectionner un véhicule.');
      return;
    }
    if (!maintDate) {
      setMaintError("La date d'intervention est obligatoire.");
      return;
    }
    if (!Number.isFinite(mileageAtService) || mileageAtService < 0) {
      setMaintError('Le kilométrage ne peut pas être négatif.');
      return;
    }
    if (!Number.isFinite(costDzd) || costDzd < 0) {
      setMaintError('Le coût ne peut pas être négatif.');
      return;
    }
    setSavingMaint(true);
    try {
      await apiFetch('/api/maintenance', {
        method: 'POST',
        body: JSON.stringify({
          vehicleId: targetVId,
          maintenanceType: maintType,
          maintenanceDate: maintDate,
          mileageAtService,
          costDzd,
          notes: maintNotes.trim(),
          markCompletedImmediately,
        }),
      });
      setMaintModalOpen(false);
      setMaintNotes('');
      setCostDzd(0);
      await onRefresh();
      setFeedback({ type: 'success', text: 'Intervention de maintenance enregistrée.' });
    } catch (err) {
      setMaintError(err instanceof Error ? err.message : 'Erreur maintenance');
    } finally {
      setSavingMaint(false);
    }
  };

  const handleCompleteMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completingItem || completing) return;
    setCompleteError('');
    if (!Number.isFinite(completeMileage) || completeMileage < 0) {
      setCompleteError('Le kilométrage final ne peut pas être négatif.');
      return;
    }
    if (!Number.isFinite(completeCost) || completeCost < 0) {
      setCompleteError('Le coût final ne peut pas être négatif.');
      return;
    }
    setCompleting(true);
    try {
      await apiFetch(`/api/maintenance/${completingItem.id}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          costDzd: completeCost,
          mileageAtService: completeMileage,
        }),
      });
      setCompletingItem(null);
      await onRefresh();
      setFeedback({ type: 'success', text: 'Entretien clôturé et véhicule remis en service.' });
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : 'Erreur lors de la clôture');
    } finally {
      setCompleting(false);
    }
  };

  const labelForMaintType = (type: string) => {
    if (type === 'graissage') return 'Graissage (10 000 km)';
    if (type === 'bougies') return 'Bougies (25 000 km)';
    if (type === 'kit_chaine') return 'Kit chaîne (50 000 km)';
    return 'Autre entretien';
  };

  const handleDeleteMaintenance = async () => {
    if (!confirmMaint) return;
    setDeleting(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{ message?: string }>(`/api/maintenance/${confirmMaint.id}`, {
        method: 'DELETE',
      });
      setFeedback({
        type: 'success',
        text: res.message || 'Fiche entretien supprimée.',
      });
      onRefresh();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur suppression entretien',
      });
    } finally {
      setDeleting(false);
      setConfirmMaint(null);
    }
  };

  const openQuickReturnDialog = (ct: ContractItem) => {
    setQuickReturnTarget(ct);
    setQuickReturnedAt(new Date().toISOString().slice(0, 16));
    setQuickReturnMileage(ct.departureMileage);
    setQuickReturnFuel(ct.departureFuelLevel || '4/4');
    setQuickReturnNotes('');
    setQuickReturnError('');
  };

  const handleConfirmQuickReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickReturnTarget || submittingQuickReturn) return;
    setQuickReturnError('');
    if (!quickReturnedAt) {
      setQuickReturnError('La date et heure de retour sont obligatoires.');
      return;
    }
    if (!Number.isFinite(quickReturnMileage) || quickReturnMileage < quickReturnTarget.departureMileage) {
      setQuickReturnError(
        `Le kilométrage retour doit être supérieur ou égal au départ (${quickReturnTarget.departureMileage} km).`,
      );
      return;
    }
    setSubmittingQuickReturn(true);
    try {
      await apiFetch('/api/returns', {
        method: 'POST',
        body: JSON.stringify({
          contractId: quickReturnTarget.id,
          returnedAt: new Date(quickReturnedAt).toISOString(),
          returnMileage: quickReturnMileage,
          fuelLevel: quickReturnFuel,
          conditionNotes: quickReturnNotes.trim(),
        }),
      });
      const num = quickReturnTarget.contractNumber;
      setQuickReturnTarget(null);
      await onRefresh();
      setFeedback({
        type: 'success',
        text: `Retour confirmé : contrat ${num} déplacé vers Terminé et véhicule libéré.`,
      });
    } catch (err) {
      setQuickReturnError(
        err instanceof Error ? err.message : 'Erreur lors de la confirmation du retour.',
      );
    } finally {
      setSubmittingQuickReturn(false);
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

      {/* Confirmed Contracts Awaiting Vehicle Return */}
      <section className="bg-white border border-[#E4BEB9] rounded-lg p-5 flex flex-col gap-3">
        <header className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E4BEB9]">
          <div>
            <h2 className="font-title text-[17px] font-semibold text-[#1B1B1E]">
              Contrats confirmés en attente de retour ({activeContracts.length})
            </h2>
            <p className="text-[12px] text-[#5B403D]">
              Confirmez le retour du véhicule pour clôturer le contrat vers Terminé et libérer le véhicule.
            </p>
          </div>
        </header>

        {activeContracts.length === 0 ? (
          <p className="py-5 text-center text-[13px] text-[#5B403D]">
            Aucun contrat confirmé en attente de retour pour le moment.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeContracts.map((ct) => {
              const isSelected = ct.id === contractId;
              const isOverdue = new Date(ct.endAt).getTime() < Date.now();
              return (
                <div
                  key={ct.id}
                  className={`p-3.5 rounded-lg border flex flex-col justify-between gap-3 ${
                    isSelected
                      ? 'border-[#93000B] bg-[#FBF8FC]'
                      : 'border-[#E4BEB9] bg-white hover:bg-[#FBF8FC]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[13px] font-bold text-[#93000B]">
                          {ct.contractNumber}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            isOverdue
                              ? 'bg-[#FFDAD6] text-[#93000A]'
                              : 'bg-[#DCFCE7] text-[#14532D]'
                          }`}
                        >
                          {isOverdue ? 'En retard' : 'Confirmé'}
                        </span>
                      </div>
                      <p className="text-[13px] font-semibold text-[#1B1B1E] truncate mt-0.5">
                        {ct.customer?.fullName || 'Client'}{' '}
                        {ct.customer?.phone ? `· ${ct.customer.phone}` : ''}
                      </p>
                      <p className="text-[12px] text-[#5B403D] truncate">
                        {ct.vehicle?.brand} {ct.vehicle?.model} ·{' '}
                        <span className="font-mono">{ct.vehicle?.registrationNumber}</span>
                      </p>
                      <p className="text-[11px] text-[#5B403D] tabular-nums mt-0.5">
                        {formatDateTime(ct.startAt)} → {formatDateTime(ct.endAt)} · Départ{' '}
                        {formatKm(ct.departureMileage)} · {ct.pickupLocation || 'Blida'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E4BEB9]/70">
                    <button
                      type="button"
                      onClick={() => {
                        setContractId(ct.id);
                        setReturnMileage(ct.departureMileage);
                        setFuelLevel(ct.departureFuelLevel || '4/4');
                      }}
                      className="text-[12px] font-semibold text-[#1B1B1E] underline cursor-pointer"
                    >
                      Calcul détaillé Art. 01/02
                    </button>
                    <button
                      type="button"
                      onClick={() => openQuickReturnDialog(ct)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#15803D] text-white hover:bg-[#166534] font-label text-[12px] font-semibold cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[15px]">task_alt</span>
                      {t.confirmReturnBtn}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Vehicle Return Inspection Form */}
        <section className="lg:col-span-6 bg-white border border-[#E4BEB9] rounded-lg p-6 flex flex-col gap-4">
          <header className="flex items-center justify-between gap-2 pb-3 border-b border-[#E4BEB9]">
            <div>
              <h2 className="font-title text-[18px] font-semibold text-[#1B1B1E]">
                {t.recordReturn}
              </h2>
              <p className="text-[12px] text-[#5B403D]">
                {t.lateRuleSummary} · {t.kmRuleSummary}
              </p>
            </div>
            {selectedContract && (
              <span className="shrink-0 font-mono text-[13px] font-semibold text-[#5B403D] tabular-nums">
                Départ : {formatKm(selectedContract.departureMileage)}
              </span>
            )}
          </header>

          {activeContracts.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-[#5B403D]">
              Aucun contrat actif ou à clôturer pour le moment.
            </p>
          ) : (
            <form noValidate onSubmit={handleReturnSubmit} className="flex flex-col gap-4">
              {returnError && (
                <div className="p-3 rounded bg-[#FFDAD6] text-[#93000A] text-[13px]">
                  {returnError}
                </div>
              )}

              <label className="flex flex-col gap-1">
                <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                  Contrat à clôturer *
                </span>
                <select
                  value={contractId}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setContractId(id);
                    const found = activeContracts.find((c) => c.id === id);
                    if (found) setReturnMileage(found.departureMileage);
                  }}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                >
                  {activeContracts.map((ct) => (
                    <option key={ct.id} value={ct.id}>
                      {ct.contractNumber} · {ct.vehicle?.brand} {ct.vehicle?.model} (
                      {ct.vehicle?.registrationNumber}) — {ct.customer?.fullName}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1">
                  <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                    Date et heure retour *
                  </span>
                  <input
                    type="datetime-local"
                    required
                    value={returnedAt}
                    onChange={(e) => setReturnedAt(e.target.value)}
                    className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                    Kilométrage retour *
                  </span>
                  <input
                    type="number"
                    required
                    min={selectedContract?.departureMileage || 0}
                    value={returnMileage}
                    onChange={(e) => setReturnMileage(Number(e.target.value))}
                    className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[13px] tabular-nums"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                    Niveau carburant
                  </span>
                  <select
                    value={fuelLevel}
                    onChange={(e) => setFuelLevel(e.target.value)}
                    className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                  >
                    <option value="4/4">Plein (4/4)</option>
                    <option value="3/4">3/4</option>
                    <option value="1/2">1/2</option>
                    <option value="1/4">1/4</option>
                    <option value="0/4">Réserve</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                    Mode règlement
                  </span>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                  >
                    <option value="cash">Espèces (Caisse)</option>
                    <option value="card">Carte CIB / Edahabia</option>
                    <option value="transfer">Virement bancaire</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                    Frais dommages (DZD)
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={damageFeeDzd}
                    onChange={(e) => setDamageFeeDzd(Number(e.target.value))}
                    className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[13px] tabular-nums"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                    Frais carburant / nettoyage (DZD)
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={fuelCleaningFeeDzd}
                    onChange={(e) => setFuelCleaningFeeDzd(Number(e.target.value))}
                    className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[13px] tabular-nums"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                    Montant encaissé au retour (DZD)
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={collectedAmountDzd}
                    onChange={(e) => setCollectedAmountDzd(Number(e.target.value))}
                    className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[13px] tabular-nums"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                    Caution restituée (DZD)
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={refundDepositDzd}
                    onChange={(e) => setRefundDepositDzd(Number(e.target.value))}
                    className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[13px] tabular-nums"
                  />
                </label>
              </div>

              {/* Automatic Official Art. 01 & Art. 02 Breakdown */}
              {selectedContract && (
                <div className="p-3.5 rounded-lg bg-[#F6F2F7] border border-[#E4BEB9] flex flex-col gap-2 text-[12px]">
                  <div className="grid grid-cols-2 gap-3 pb-2 border-b border-[#E4BEB9]">
                    <div>
                      <span className="text-[#5B403D] block">État au départ</span>
                      <span className="font-semibold text-[#1B1B1E]">
                        {selectedContract.departureFuelLevel} ·{' '}
                        {formatKm(selectedContract.departureMileage)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#5B403D] block">Distance parcourue / allouée</span>
                      <span className="font-semibold text-[#1B1B1E] tabular-nums">
                        {formatKm(distanceCalc.drivenKm)} / {formatKm(distanceCalc.allowedKm)}
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-between tabular-nums">
                    <span>
                      Art. 01 Retard ({lateCalc.lateHours}h · +{lateCalc.extraDays} j)
                    </span>
                    <span className="font-mono font-semibold">{formatDzd(lateCalc.lateFeeDzd)}</span>
                  </div>
                  <div className="flex justify-between tabular-nums">
                    <span>Art. 02 Km extra ({distanceCalc.extraKm} km × 50 DZD)</span>
                    <span className="font-mono font-semibold">
                      {formatDzd(distanceCalc.extraKmFeeDzd)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-[#E4BEB9] font-semibold text-[13px] text-[#93000B] tabular-nums">
                    <span>Solde total à percevoir (contrat + suppléments)</span>
                    <span className="font-mono">{formatDzd(remainingDueAtReturn)}</span>
                  </div>
                </div>
              )}

              <label className="flex flex-col gap-1">
                <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                  Observations / Rayures / État au retour
                </span>
                <textarea
                  rows={2}
                  value={conditionNotes}
                  onChange={(e) => setConditionNotes(e.target.value)}
                  placeholder="Noter tout dommage ou remarque..."
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>

              <button
                type="submit"
                disabled={submittingReturn}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] font-label text-[13px] font-semibold cursor-pointer disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">check_circle</span>
                {submittingReturn ? 'Traitement...' : t.validateReturn}
              </button>
            </form>
          )}
        </section>

        {/* Right: Mileage Maintenance Reminders (10k / 25k / 50k) & Workshop Actions */}
        <section className="lg:col-span-6 bg-white border border-[#E4BEB9] rounded-lg p-6 flex flex-col gap-4">
          <header className="flex items-center justify-between gap-2 pb-3 border-b border-[#E4BEB9]">
            <div>
              <h2 className="font-title text-[18px] font-semibold text-[#1B1B1E]">
                Rappels de maintenance
              </h2>
              <p className="text-[12px] text-[#5B403D]">
                Graissage 10 000 km · Bougies 25 000 km · Kit chaîne 50 000 km
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const firstV = vehicles[0];
                if (firstV) {
                  setMaintVehicleId(firstV.id);
                  setMileageAtService(firstV.currentMileage);
                }
                setMaintModalOpen(true);
              }}
              className="shrink-0 px-3 py-1.5 rounded bg-[#111114] text-white font-label text-[12px] font-semibold cursor-pointer hover:bg-[#303033]"
            >
              + Entretien
            </button>
          </header>

          {/* Active In-Progress Maintenance Items (lock vehicle status) */}
          {maintenanceRecords.filter((m) => m.status === 'in_progress').length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="font-label text-[11px] font-semibold uppercase text-[#93000A]">
                Interventions en atelier (Véhicule immobilisé)
              </span>
              {maintenanceRecords
                .filter((m) => m.status === 'in_progress')
                .map((m) => (
                  <div
                    key={m.id}
                    className="p-3.5 rounded-lg bg-[#FFDAD6] border border-[#E4BEB9] flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <span className="font-label text-[13px] font-semibold text-[#93000A] block">
                        {labelForMaintType(m.maintenanceType)} · {m.vehicle?.brand} {m.vehicle?.model}
                      </span>
                      <span className="text-[12px] text-[#93000A] tabular-nums">
                        {m.vehicle?.registrationNumber} · {formatDate(m.maintenanceDate)} ·{' '}
                        {formatKm(m.mileageAtService)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setCompletingItem(m);
                          setCompleteCost(m.costDzd);
                          setCompleteMileage(m.mileageAtService);
                          setCompleteError('');
                        }}
                        className="px-3 py-1.5 rounded bg-[#15803D] text-white font-label text-[12px] font-semibold cursor-pointer"
                      >
                        Terminer
                      </button>
                      {canDeleteMaintenance && (
                        <button
                          type="button"
                          onClick={() => setConfirmMaint(m)}
                          className="px-2 py-1.5 rounded border border-[#BA1A1A] bg-white text-[#BA1A1A] hover:bg-[#FFDAD6] font-label text-[12px] font-semibold cursor-pointer"
                          title="Supprimer entretien"
                        >
                          <span className="material-symbols-outlined text-[15px] align-middle">delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* Mileage Threshold Alerts */}
          <div className="flex flex-col gap-2.5 max-h-[380px] overflow-y-auto">
            {maintenanceAlerts.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-[#5B403D]">
                Aucun véhicule enregistré pour le suivi kilométrique.
              </p>
            ) : (
              maintenanceAlerts.map((a, idx) => (
                <div
                  key={`${a.vehicleId}-${a.maintenanceType}-${idx}`}
                  className={`p-3.5 rounded-lg border border-[#E4BEB9] flex items-center justify-between gap-3 ${
                    a.state === 'overdue' || a.state === 'in_progress'
                      ? 'bg-[#FFDAD6] text-[#93000A]'
                      : a.state === 'approaching'
                        ? 'bg-[#FEF3C7] text-[#78350F]'
                        : 'bg-[#F6F2F7] text-[#1B1B1E]'
                  }`}
                >
                  <div className="min-w-0">
                    <span className="font-label text-[13px] font-semibold block">
                      {labelForMaintType(a.maintenanceType)} · {a.vehicleName}
                    </span>
                    <span className="text-[12px] tabular-nums block">
                      {a.registrationNumber || a.plate} · Actuel : {formatKm(a.currentMileage)} ·
                      Seuil : {formatKm(a.nextServiceMileage)}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 px-2.5 py-1 rounded-full font-label text-[11px] font-semibold tabular-nums ${
                      a.state === 'in_progress'
                        ? 'bg-[#BA1A1A] text-white'
                        : a.state === 'overdue'
                          ? 'bg-[#BA1A1A] text-white'
                          : a.state === 'approaching'
                            ? 'bg-[#B45309] text-white'
                            : 'bg-[#DCFCE7] text-[#14532D]'
                    }`}
                  >
                    {a.state === 'in_progress'
                      ? 'En atelier'
                      : a.state === 'overdue'
                        ? `Dépassé +${Math.abs(a.remainingKm).toLocaleString('fr-FR')} km`
                        : a.state === 'approaching'
                          ? `Dans ${a.remainingKm.toLocaleString('fr-FR')} km`
                          : 'À jour'}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Recent Returns & Completed Maintenance History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-[#E4BEB9] rounded-lg overflow-hidden">
          <header className="px-4 py-3 border-b border-[#E4BEB9] bg-[#F6F2F7]">
            <h3 className="font-title text-[15px] font-semibold text-[#1B1B1E]">
              Historique des retours ({returns.length})
            </h3>
          </header>
          <div className="divide-y divide-[#E4BEB9] max-h-72 overflow-y-auto">
            {returns.length === 0 ? (
              <p className="p-6 text-center text-[13px] text-[#5B403D]">Aucun retour enregistré.</p>
            ) : (
              returns.map((r) => (
                <div key={r.id} className="p-4 flex items-center justify-between gap-2 text-[13px]">
                  <div>
                    <span className="font-mono font-semibold text-[#1B1B1E] block">
                      {r.contract?.contractNumber} · {r.vehicle?.brand} {r.vehicle?.model}
                    </span>
                    <span className="text-[12px] text-[#5B403D] tabular-nums">
                      {formatDateTime(r.returnedAt)} · {formatKm(r.returnMileage)} (
                      {r.drivenKm} km parcourus)
                    </span>
                  </div>
                  <span className="font-mono font-semibold text-[#93000B] tabular-nums">
                    +{formatDzd(r.totalAdditionalFeeDzd)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="bg-white border border-[#E4BEB9] rounded-lg overflow-hidden">
          <header className="px-4 py-3 border-b border-[#E4BEB9] bg-[#F6F2F7]">
            <h3 className="font-title text-[15px] font-semibold text-[#1B1B1E]">
              Journal de maintenance ({maintenanceRecords.length})
            </h3>
          </header>
          <div className="divide-y divide-[#E4BEB9] max-h-72 overflow-y-auto">
            {maintenanceRecords.length === 0 ? (
              <p className="p-6 text-center text-[13px] text-[#5B403D]">
                Aucune intervention enregistrée.
              </p>
            ) : (
              maintenanceRecords.map((m) => (
                <div key={m.id} className="p-4 flex items-center justify-between gap-2 text-[13px]">
                  <div>
                    <span className="font-semibold text-[#1B1B1E] block">
                      {labelForMaintType(m.maintenanceType)} · {m.vehicle?.brand} {m.vehicle?.model}
                    </span>
                    <span className="text-[12px] text-[#5B403D] tabular-nums">
                      {formatDate(m.maintenanceDate)} · {formatKm(m.mileageAtService)} → Prochain{' '}
                      {formatKm(m.nextServiceMileage)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="font-mono font-semibold text-[#1B1B1E] block tabular-nums">
                        {formatDzd(m.costDzd)}
                      </span>
                      <span className="text-[11px] font-semibold text-[#5B403D]">
                        {m.status === 'completed' ? 'Terminé' : 'En cours'}
                      </span>
                    </div>
                    {canDeleteMaintenance && (
                      <button
                        type="button"
                        onClick={() => setConfirmMaint(m)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#BA1A1A] text-[#BA1A1A] hover:bg-[#FFDAD6] text-[11px] font-semibold cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[13px]">delete</span>
                        Supprimer
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Add Maintenance Modal */}
      {maintModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 border border-[#E4BEB9]">
            <div className="flex items-center justify-between pb-3 border-b border-[#E4BEB9] mb-4">
              <h3 className="font-headline text-[18px] font-bold text-[#1B1B1E]">
                Enregistrer un entretien véhicule
              </h3>
              <button
                type="button"
                onClick={() => setMaintModalOpen(false)}
                className="w-8 h-8 rounded border border-[#E4BEB9] flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {maintError && (
              <div className="mb-3 p-3 rounded bg-[#FFDAD6] text-[#93000A] text-[13px]">
                {maintError}
              </div>
            )}

            <form noValidate onSubmit={handleCreateMaintenance} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-label text-[12px] font-semibold">Véhicule *</span>
                <select
                  value={maintVehicleId}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setMaintVehicleId(id);
                    const v = vehicles.find((item) => item.id === id);
                    if (v) setMileageAtService(v.currentMileage);
                  }}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                >
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.brand} {v.model} ({v.registrationNumber}) — {formatKm(v.currentMileage)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="font-label text-[12px] font-semibold">Type d'entretien</span>
                  <select
                    value={maintType}
                    onChange={(e) =>
                      setMaintType(
                        e.target.value as 'graissage' | 'bougies' | 'kit_chaine' | 'other',
                      )
                    }
                    className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                  >
                    <option value="graissage">Graissage (10 000 km)</option>
                    <option value="bougies">Bougies (25 000 km)</option>
                    <option value="kit_chaine">Kit chaîne (50 000 km)</option>
                    <option value="other">Autre intervention</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-label text-[12px] font-semibold">Date</span>
                  <input
                    type="date"
                    value={maintDate}
                    onChange={(e) => setMaintDate(e.target.value)}
                    className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-label text-[12px] font-semibold">Kilométrage</span>
                  <input
                    type="number"
                    min={0}
                    value={mileageAtService}
                    onChange={(e) => setMileageAtService(Number(e.target.value))}
                    className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[13px]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-label text-[12px] font-semibold">Coût (DZD)</span>
                  <input
                    type="number"
                    min={0}
                    value={costDzd}
                    onChange={(e) => setCostDzd(Number(e.target.value))}
                    className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[13px]"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1">
                <span className="font-label text-[12px] font-semibold">Notes</span>
                <textarea
                  rows={2}
                  value={maintNotes}
                  onChange={(e) => setMaintNotes(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>

              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={markCompletedImmediately}
                  onChange={(e) => setMarkCompletedImmediately(e.target.checked)}
                />
                <span>Entretien déjà terminé (sinon le véhicule passe « En maintenance »)</span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMaintModalOpen(false)}
                  className="px-4 py-2 rounded border border-[#E4BEB9] text-[13px] font-semibold cursor-pointer"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={savingMaint}
                  className="px-4 py-2 rounded bg-[#93000B] text-white text-[13px] font-semibold cursor-pointer"
                >
                  {savingMaint ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Complete In-Progress Maintenance Modal */}
      {completingItem && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            noValidate
            onSubmit={handleCompleteMaintenance}
            className="bg-white rounded-xl max-w-md w-full p-6 border border-[#E4BEB9] flex flex-col gap-4"
          >
            <h3 className="font-headline text-[18px] font-bold text-[#1B1B1E]">
              Clôturer l'entretien & remettre en service
            </h3>
            {completeError && (
              <div className="p-3 rounded bg-[#FFDAD6] text-[#93000A] text-[13px] font-semibold">
                {completeError}
              </div>
            )}
            <label className="flex flex-col gap-1">
              <span className="font-label text-[12px] font-semibold">Kilométrage final</span>
              <input
                type="number"
                value={completeMileage}
                onChange={(e) => setCompleteMileage(Number(e.target.value))}
                className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-label text-[12px] font-semibold">Coût final (DZD)</span>
              <input
                type="number"
                min={0}
                value={completeCost}
                onChange={(e) => setCompleteCost(Number(e.target.value))}
                className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[13px]"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCompletingItem(null)}
                className="px-4 py-2 rounded border border-[#E4BEB9] text-[13px] font-semibold cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={completing}
                className="px-4 py-2 rounded bg-[#15803D] text-white text-[13px] font-semibold cursor-pointer disabled:opacity-50"
              >
                {completing ? 'Validation...' : "Confirmer fin d'entretien"}
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Quick Confirm Return Modal */}
      {quickReturnTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            noValidate
            onSubmit={handleConfirmQuickReturn}
            className="bg-white rounded-xl max-w-md w-full p-6 border border-[#E4BEB9] flex flex-col gap-4"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#E4BEB9] pb-3">
              <div>
                <h3 className="font-headline text-[18px] font-bold text-[#1B1B1E]">
                  Confirmer le retour véhicule ?
                </h3>
                <p className="font-mono text-[12px] font-bold text-[#93000B] mt-0.5">
                  {quickReturnTarget.contractNumber} · {quickReturnTarget.customer?.fullName}
                </p>
                <p className="text-[12px] text-[#5B403D]">
                  {quickReturnTarget.vehicle?.brand} {quickReturnTarget.vehicle?.model} (
                  {quickReturnTarget.vehicle?.registrationNumber})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQuickReturnTarget(null)}
                className="w-8 h-8 rounded border border-[#E4BEB9] flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {quickReturnError && (
              <div className="p-3 rounded bg-[#FFDAD6] text-[#93000A] text-[12px] font-semibold">
                {quickReturnError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="font-label text-[12px] font-semibold">
                  Date et heure du retour effectif *
                </span>
                <input
                  type="datetime-local"
                  required
                  value={quickReturnedAt}
                  onChange={(e) => setQuickReturnedAt(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-label text-[12px] font-semibold">
                  Kilométrage retour (Départ {quickReturnTarget.departureMileage} km)
                </span>
                <input
                  type="number"
                  min={quickReturnTarget.departureMileage}
                  value={quickReturnMileage}
                  onChange={(e) => setQuickReturnMileage(Number(e.target.value))}
                  className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[13px]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-label text-[12px] font-semibold">Niveau carburant</span>
                <select
                  value={quickReturnFuel}
                  onChange={(e) => setQuickReturnFuel(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                >
                  <option value="4/4">Plein (4/4)</option>
                  <option value="3/4">3/4</option>
                  <option value="1/2">1/2</option>
                  <option value="1/4">1/4</option>
                  <option value="0/4">Réserve</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="font-label text-[12px] font-semibold">Observations retour</span>
                <textarea
                  rows={2}
                  value={quickReturnNotes}
                  onChange={(e) => setQuickReturnNotes(e.target.value)}
                  placeholder="État du véhicule au retour..."
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>
            </div>

            <p className="text-[12px] text-[#5B403D]">
              Le contrat sera marqué comme « Terminé », déplacé vers la section Terminé et le véhicule redeviendra disponible.
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setQuickReturnTarget(null)}
                className="px-4 py-2 rounded border border-[#E4BEB9] text-[13px] font-semibold cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={submittingQuickReturn}
                className="px-4 py-2 rounded bg-[#15803D] text-white hover:bg-[#166534] text-[13px] font-semibold cursor-pointer disabled:opacity-50"
              >
                {submittingQuickReturn ? 'Validation...' : t.confirmReturnBtn}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmMaint)}
        title="Supprimer cette fiche d'entretien ?"
        targetLabel={
          confirmMaint
            ? `${labelForMaintType(confirmMaint.maintenanceType)} · ${confirmMaint.vehicle?.registrationNumber || ''}`
            : ''
        }
        message="Si cet entretien est lié à une dépense comptable, la fiche sera archivée tout en préservant la caisse. Sinon elle sera supprimée et le véhicule redeviendra disponible."
        confirmText="Supprimer"
        loading={deleting}
        onConfirm={handleDeleteMaintenance}
        onCancel={() => setConfirmMaint(null)}
      />
    </div>
  );
};
