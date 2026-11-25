import React, { useEffect, useState } from 'react';
import { TRANSLATIONS, type Lang } from '../../i18n/translations.ts';
import { apiFetch, authorizedFileUrl, formatDzd, formatKm, formatDate } from '../../lib/api.ts';
import type { VehicleDocumentItem, VehicleItem } from '../../types.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

interface Props {
  lang: Lang;
  role: 'manager' | 'employee';
  canDeleteVehicles?: boolean;
  canDeleteDocuments?: boolean;
  vehicles: VehicleItem[];
  onRefresh: () => void | Promise<void>;
  onGoToMaintenance: (vehicleId: number) => void;
  onGoToReturn: (contractId: number) => void;
}

export const FleetView: React.FC<Props> = ({
  lang,
  role,
  canDeleteVehicles = role === 'manager',
  canDeleteDocuments = role === 'manager',
  vehicles,
  onRefresh,
  onGoToMaintenance,
  onGoToReturn,
}) => {
  const t = TRANSLATIONS[lang];
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filteredVehicles, setFilteredVehicles] = useState<VehicleItem[]>(vehicles);

  // Add/Edit Vehicle Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<VehicleItem | null>(null);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [color, setColor] = useState('');
  const [plate, setPlate] = useState('');
  const [price, setPrice] = useState(6000);
  const [mileage, setMileage] = useState(0);
  const [fuelType, setFuelType] = useState('Essence');
  const [transmission, setTransmission] = useState('Manuelle');
  const [seats, setSeats] = useState(5);
  const [chassisNumber, setChassisNumber] = useState('');
  const [engineSeries, setEngineSeries] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Documents Modal
  const [docsVehicle, setDocsVehicle] = useState<VehicleItem | null>(null);
  const [docsList, setDocsList] = useState<VehicleDocumentItem[]>([]);
  const [docType, setDocType] = useState('assurance');
  const [docName, setDocName] = useState('Assurance');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [expiryDate, setExpiryDate] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [noExpiry, setNoExpiry] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [renewDocId, setRenewDocId] = useState<number | null>(null);
  const [docError, setDocError] = useState('');
  const [uploadingDoc, setUploadingDoc] = useState(false);

  // Delete confirmation & feedback state
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmVehicle, setConfirmVehicle] = useState<VehicleItem | null>(null);
  const [confirmDoc, setConfirmDoc] = useState<VehicleDocumentItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!startDate && !endDate && !search) {
      setFilteredVehicles(vehicles);
      return;
    }
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    if (startDate && endDate) {
      qs.set('startDate', startDate);
      qs.set('endDate', endDate);
    }
    apiFetch<{ vehicles: VehicleItem[] }>(`/api/vehicles?${qs.toString()}`)
      .then((res) => setFilteredVehicles(res.vehicles))
      .catch(() => {});
  }, [vehicles, search, startDate, endDate]);

  const openAdd = () => {
    setEditingVehicle(null);
    setBrand('');
    setModel('');
    setYear(new Date().getFullYear());
    setColor('');
    setPlate('');
    setPrice(6000);
    setMileage(0);
    setFuelType('Essence');
    setTransmission('Manuelle');
    setSeats(5);
    setChassisNumber('');
    setEngineSeries('');
    setPhotoFile(null);
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (v: VehicleItem) => {
    setEditingVehicle(v);
    setBrand(v.brand);
    setModel(v.model);
    setYear(v.year);
    setColor(v.color);
    setPlate(v.registrationNumber);
    setPrice(v.dailyPriceDzd);
    setMileage(v.currentMileage);
    setFuelType(v.fuelType);
    setTransmission(v.transmission);
    setSeats(v.seats);
    setChassisNumber(v.chassisNumber || '');
    setEngineSeries(v.engineSeries || '');
    setPhotoFile(null);
    setFormError('');
    setModalOpen(true);
  };

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setFormError('');
    if (!brand.trim()) {
      setFormError('La marque du véhicule est obligatoire.');
      return;
    }
    if (!model.trim()) {
      setFormError('Le modèle du véhicule est obligatoire.');
      return;
    }
    if (!plate.trim()) {
      setFormError("Le numéro d'immatriculation unique est obligatoire.");
      return;
    }
    if (!color.trim()) {
      setFormError('La couleur du véhicule est obligatoire.');
      return;
    }
    if (!Number.isFinite(year) || year < 1980 || year > new Date().getFullYear() + 2) {
      setFormError('Veuillez saisir une année valide.');
      return;
    }
    if (!Number.isFinite(price) || price < 100) {
      setFormError('Le prix journalier doit être d’au moins 100 DZD.');
      return;
    }
    if (!Number.isFinite(mileage) || mileage < 0) {
      setFormError('Le kilométrage ne peut pas être négatif.');
      return;
    }
    if (!editingVehicle && !photoFile) {
      setFormError('La photo du véhicule est obligatoire.');
      return;
    }

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('brand', brand.trim());
      fd.append('model', model.trim());
      fd.append('year', String(year));
      fd.append('color', color.trim());
      fd.append('registrationNumber', plate.trim().toUpperCase());
      fd.append('dailyPriceDzd', String(price));
      fd.append('currentMileage', String(mileage));
      fd.append('fuelType', fuelType);
      fd.append('transmission', transmission);
      fd.append('seats', String(seats));
      fd.append('chassisNumber', chassisNumber.trim());
      fd.append('engineSeries', engineSeries.trim());
      if (photoFile) fd.append('photo', photoFile);

      if (editingVehicle) {
        if (editingVehicle.version !== undefined) {
          fd.append('version', String(editingVehicle.version));
        }
        await apiFetch(`/api/vehicles/${editingVehicle.id}`, { method: 'PUT', body: fd });
      } else {
        await apiFetch('/api/vehicles', { method: 'POST', body: fd });
      }
      setModalOpen(false);
      await onRefresh();
      setFeedback({
        type: 'success',
        text: editingVehicle
          ? `Véhicule ${plate.trim().toUpperCase()} mis à jour.`
          : `Véhicule ${brand.trim()} ${model.trim()} (${plate.trim().toUpperCase()}) ajouté.`,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const loadVehicleDocs = async (v: VehicleItem) => {
    setDocsVehicle(v);
    setDocError('');
    setRenewDocId(null);
    setDocsList([]);
    try {
      const res = await apiFetch<{ documents: VehicleDocumentItem[] }>(
        `/api/vehicles/${v.id}/documents`,
      );
      setDocsList(res.documents || []);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Erreur lors du chargement des documents.');
    }
  };

  const handleIssueDateChange = (val: string) => {
    setIssueDate(val);
    if (!noExpiry && docType !== 'carte_grise' && val) {
      const d = new Date(`${val}T00:00:00Z`);
      if (!Number.isNaN(d.getTime())) {
        d.setUTCFullYear(d.getUTCFullYear() + 1);
        setExpiryDate(d.toISOString().slice(0, 10));
      }
    }
  };

  const handleDocTypeChange = (val: string) => {
    setDocType(val);
    const labels: Record<string, string> = {
      assurance: 'Assurance',
      controle_technique: 'Contrôle technique',
      carte_grise: 'Carte grise',
      vignette: 'Vignette',
      other: 'Autre document',
    };
    setDocName(labels[val] || val);
    if (val === 'carte_grise') {
      setNoExpiry(true);
      setExpiryDate('');
    } else {
      setNoExpiry(false);
      if (issueDate) {
        const d = new Date(`${issueDate}T00:00:00Z`);
        if (!Number.isNaN(d.getTime())) {
          d.setUTCFullYear(d.getUTCFullYear() + 1);
          setExpiryDate(d.toISOString().slice(0, 10));
        }
      }
    }
  };

  const handleUploadDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docsVehicle || uploadingDoc) return;
    if (!docName.trim()) {
      setDocError('Le nom du document est obligatoire.');
      return;
    }
    if (!issueDate) {
      setDocError("La date d'émission est obligatoire.");
      return;
    }
    if (!docFile) {
      setDocError('Veuillez sélectionner un fichier PDF ou image.');
      return;
    }
    setDocError('');
    setUploadingDoc(true);
    try {
      const fd = new FormData();
      fd.append('docType', docType);
      fd.append('docName', docName.trim());
      fd.append('issueDate', issueDate);
      fd.append('expiryDate', noExpiry ? '' : expiryDate);
      fd.append('noExpiry', String(noExpiry));
      if (renewDocId) fd.append('replaceDocId', String(renewDocId));
      fd.append('file', docFile);

      await apiFetch(`/api/vehicles/${docsVehicle.id}/documents`, {
        method: 'POST',
        body: fd,
      });
      setDocFile(null);
      setRenewDocId(null);
      await loadVehicleDocs(docsVehicle);
      await onRefresh();
      setFeedback({ type: 'success', text: `Document « ${docName.trim()} » enregistré.` });
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Erreur upload document');
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleDeleteVehicle = async () => {
    if (!confirmVehicle) return;
    setDeleting(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{ message?: string }>(`/api/vehicles/${confirmVehicle.id}`, {
        method: 'DELETE',
      });
      setFeedback({
        type: 'success',
        text: res.message || `Véhicule ${confirmVehicle.registrationNumber} supprimé.`,
      });
      onRefresh();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur lors de la suppression du véhicule.',
      });
    } finally {
      setDeleting(false);
      setConfirmVehicle(null);
    }
  };

  const handleDeleteDoc = async () => {
    if (!confirmDoc || !docsVehicle) return;
    setDeleting(true);
    setDocError('');
    try {
      await apiFetch(`/api/vehicles/${docsVehicle.id}/documents/${confirmDoc.id}`, {
        method: 'DELETE',
      });
      await loadVehicleDocs(docsVehicle);
      onRefresh();
      setFeedback({ type: 'success', text: `Document « ${confirmDoc.docName} » supprimé.` });
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Erreur suppression document');
    } finally {
      setDeleting(false);
      setConfirmDoc(null);
    }
  };

  const displayed = filteredVehicles.filter((v) =>
    startDate && endDate ? v.availableForRange : true,
  );

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
      {/* Toolbar */}
      <section className="bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-[#F6F2F7] border border-[#E4BEB9] rounded px-3 py-2">
            <span className="material-symbols-outlined text-[18px] text-[#5B403D]">search</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.searchFleetPlaceholder}
              className="bg-transparent border-0 p-0 text-[13px] text-[#1B1B1E] placeholder:text-[#8F6F6C] focus:outline-none w-56"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="font-label text-[11px] font-semibold text-[#5B403D]">
              {t.availabilityFilter}
            </span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded border border-[#E4BEB9] bg-white px-2.5 py-1.5 text-[13px]"
            />
            <span className="text-[13px] text-[#5B403D]">{t.toDate}</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded border border-[#E4BEB9] bg-white px-2.5 py-1.5 text-[13px]"
            />
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                }}
                className="text-[12px] text-[#93000B] font-semibold underline cursor-pointer"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] font-label text-[13px] font-semibold cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          <span>{t.addVehicle}</span>
        </button>
      </section>

      {/* Grid */}
      {displayed.length === 0 ? (
        <div className="bg-white border border-[#E4BEB9] rounded-lg p-12 text-center">
          <span className="material-symbols-outlined text-[40px] text-[#8F6F6C] block mb-2">
            garage
          </span>
          <p className="font-title text-[16px] font-semibold text-[#1B1B1E]">
            0 véhicule dans le parc automobile
          </p>
          <p className="text-[13px] text-[#5B403D] mt-1">{t.mandatoryPhotoPlate}</p>
        </div>
      ) : (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          {displayed.map((v) => {
            const isAvailable = v.computedStatus === 'available';
            const statusLabel =
              v.computedStatus === 'available'
                ? t.statusAvailable
                : v.computedStatus === 'reserved'
                  ? t.statusReserved
                  : v.computedStatus === 'rented'
                    ? t.statusRented
                    : t.statusMaintenance;

            return (
              <article
                key={v.id}
                className="h-full bg-white border border-[#E4BEB9] rounded-lg overflow-hidden flex flex-col justify-between"
              >
                <div>
                  <div className="relative">
                    <img
                      src={authorizedFileUrl(v.photoUrl)}
                      alt={`${v.brand} ${v.model}`}
                      className="w-full h-48 object-cover bg-[#F0EDF1]"
                    />
                    <span
                      className={`absolute top-3 right-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-label text-[11px] font-semibold ${
                        isAvailable
                          ? 'bg-[#DCFCE7] text-[#14532D]'
                          : 'bg-[#FFDAD6] text-[#93000A]'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isAvailable ? 'bg-[#15803D]' : 'bg-[#BA1A1A]'
                        }`}
                      />
                      {statusLabel}
                    </span>
                  </div>

                  <div className="p-4 flex flex-col gap-2">
                    <header className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-title text-[18px] font-semibold text-[#1B1B1E]">
                          {v.brand} {v.model}
                        </h3>
                        <p className="font-mono text-[13px] font-semibold text-[#5B403D] tabular-nums">
                          {v.registrationNumber}
                        </p>
                      </div>
                      <span className="font-title text-[15px] font-semibold text-[#93000B] tabular-nums">
                        {formatDzd(v.dailyPriceDzd)}/j
                      </span>
                    </header>
                    <p className="text-[13px] text-[#5B403D] tabular-nums">
                      {v.year} · {v.color} · {formatKm(v.currentMileage)} · {v.fuelType}
                    </p>
                    {v.computedStatus === 'reserved' && v.activeReservation && (
                      <p className="font-label text-[12px] font-semibold text-[#BA1A1A] tabular-nums">
                        {t.statusReserved} : {formatDate(v.activeReservation.startDate)} →{' '}
                        {formatDate(v.activeReservation.endDate)}
                      </p>
                    )}
                    {v.computedStatus === 'rented' && v.activeContract && (
                      <p className="font-label text-[12px] font-semibold text-[#BA1A1A] tabular-nums">
                        Retour prévu : {formatDate(v.activeContract.endAt)}
                      </p>
                    )}
                  </div>
                </div>

                <footer className="px-4 py-3 bg-[#F6F2F7] border-t border-[#E4BEB9] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => loadVehicleDocs(v)}
                      className={`px-2.5 py-1.5 rounded border border-[#E4BEB9] bg-white hover:bg-[#F0EDF1] font-label text-[11px] font-semibold cursor-pointer ${
                        v.docAlertCount > 0 ? 'text-[#BA1A1A] border-[#BA1A1A]' : 'text-[#1B1B1E]'
                      }`}
                    >
                      {t.documentsBtn}
                      {v.docAlertCount > 0 ? ` (${v.docAlertCount})` : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => onGoToMaintenance(v.id)}
                      className="px-2.5 py-1.5 rounded border border-[#E4BEB9] bg-white text-[#1B1B1E] hover:bg-[#F0EDF1] font-label text-[11px] font-semibold cursor-pointer"
                    >
                      {t.maintenanceBtn}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {v.computedStatus === 'rented' && v.activeContract && (
                      <button
                        type="button"
                        onClick={() => onGoToReturn(v.activeContract!.id)}
                        className="px-3 py-1.5 rounded bg-[#111114] text-white font-label text-[11px] font-semibold cursor-pointer"
                      >
                        Retour
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEdit(v)}
                      className="px-3 py-1.5 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] font-label text-[11px] font-semibold cursor-pointer"
                    >
                      {t.editVehicle}
                    </button>
                    {canDeleteVehicles && (
                      <button
                        type="button"
                        onClick={() => setConfirmVehicle(v)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-[#BA1A1A] bg-white text-[#BA1A1A] hover:bg-[#FFDAD6] font-label text-[11px] font-semibold cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[14px]">delete</span>
                        Supprimer
                      </button>
                    )}
                  </div>
                </footer>
              </article>
            );
          })}
        </section>
      )}

      {/* Add / Edit Vehicle Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-[#E4BEB9] rounded-xl max-w-2xl w-full p-6 flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#E4BEB9] pb-3">
              <h3 className="font-headline text-[20px] font-bold text-[#1B1B1E]">
                {editingVehicle ? `${t.editVehicle} · ${editingVehicle.registrationNumber}` : t.addVehicle}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="w-8 h-8 rounded border border-[#E4BEB9] flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form noValidate onSubmit={handleSaveVehicle} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Marque *</span>
                <input
                  required
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="Renault, Dacia, VW..."
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Modèle *</span>
                <input
                  required
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Clio 5, Stepway..."
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Immatriculation (unique) *</span>
                <input
                  required
                  value={plate}
                  onChange={(e) => setPlate(e.target.value)}
                  placeholder="04582-119-09"
                  className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Année *</span>
                <input
                  required
                  type="number"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Couleur *</span>
                <input
                  required
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="Blanc, Noir..."
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Prix / jour (DZD) *</span>
                <input
                  required
                  type="number"
                  min={100}
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Kilométrage actuel *</span>
                <input
                  required
                  type="number"
                  min={0}
                  value={mileage}
                  onChange={(e) => setMileage(Number(e.target.value))}
                  className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Carburant</span>
                <select
                  value={fuelType}
                  onChange={(e) => setFuelType(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                >
                  <option value="Essence">Essence</option>
                  <option value="Diesel">Diesel</option>
                  <option value="GPL">GPL</option>
                  <option value="Hybride">Hybride</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Boîte</span>
                <select
                  value={transmission}
                  onChange={(e) => setTransmission(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                >
                  <option value="Manuelle">Manuelle</option>
                  <option value="Automatique">Automatique</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Places</span>
                <input
                  type="number"
                  min={2}
                  max={9}
                  value={seats}
                  onChange={(e) => setSeats(Number(e.target.value))}
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">N° Châssis (optionnel)</span>
                <input
                  value={chassisNumber}
                  onChange={(e) => setChassisNumber(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold">Série moteur (optionnel)</span>
                <input
                  value={engineSeries}
                  onChange={(e) => setEngineSeries(e.target.value)}
                  className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-[12px] font-semibold">
                  Photo du véhicule {editingVehicle ? '(laisser vide pour conserver)' : '*'}
                </span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp"
                  onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                  className="text-[12px]"
                />
              </label>

              {formError && (
                <p className="sm:col-span-2 text-[13px] font-semibold text-[#BA1A1A] bg-[#FFDAD6] px-3 py-2 rounded">
                  {formError}
                </p>
              )}

              <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
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
                  className="px-5 py-2 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] text-[13px] font-semibold cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Enregistrement...' : t.saveVehicle}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Vehicle Documents Modal (Assurance, Contrôle technique, Carte grise, Vignette) */}
      {docsVehicle && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-[#E4BEB9] rounded-xl max-w-4xl w-full p-6 flex flex-col gap-5 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#E4BEB9] pb-3">
              <div>
                <h3 className="font-headline text-[20px] font-bold text-[#1B1B1E]">
                  {t.vehicleDocsTitle} · {docsVehicle.brand} {docsVehicle.model}
                </h3>
                <p className="font-mono text-[13px] text-[#5B403D]">
                  {docsVehicle.registrationNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDocsVehicle(null)}
                className="w-8 h-8 rounded border border-[#E4BEB9] flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Upload / Renew Form */}
            <form
              noValidate
              onSubmit={handleUploadDoc}
              className="p-4 rounded-lg bg-[#F6F2F7] border border-[#E4BEB9] grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
            >
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold">Type</span>
                <select
                  value={docType}
                  onChange={(e) => handleDocTypeChange(e.target.value)}
                  className="rounded border border-[#E4BEB9] bg-white px-2.5 py-2 text-[12px]"
                >
                  <option value="assurance">{t.docAssurance}</option>
                  <option value="controle_technique">{t.docControle}</option>
                  <option value="carte_grise">{t.docCarteGrise}</option>
                  <option value="vignette">{t.docVignette}</option>
                  <option value="other">{t.docOther}</option>
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold">Nom du document</span>
                <input
                  required
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                  className="rounded border border-[#E4BEB9] bg-white px-2.5 py-2 text-[12px]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold">Date d'émission</span>
                <input
                  required
                  type="date"
                  value={issueDate}
                  onChange={(e) => handleIssueDateChange(e.target.value)}
                  className="rounded border border-[#E4BEB9] bg-white px-2.5 py-2 text-[12px]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold flex items-center justify-between">
                  <span>Expiration</span>
                  <label className="inline-flex items-center gap-1 font-normal cursor-pointer">
                    <input
                      type="checkbox"
                      checked={noExpiry}
                      onChange={(e) => setNoExpiry(e.target.checked)}
                    />
                    Permanent
                  </label>
                </span>
                <input
                  type="date"
                  disabled={noExpiry}
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="rounded border border-[#E4BEB9] bg-white px-2.5 py-2 text-[12px] disabled:opacity-50"
                />
              </label>

              <div className="flex flex-col gap-1">
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                  className="text-[11px]"
                />
                <button
                  type="submit"
                  disabled={uploadingDoc}
                  className="px-3 py-2 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] font-label text-[12px] font-semibold cursor-pointer disabled:opacity-50"
                >
                  {uploadingDoc ? 'Envoi...' : renewDocId ? t.renewDoc : t.addDocument}
                </button>
              </div>
              {docError && (
                <p className="sm:col-span-5 text-[12px] font-semibold text-[#BA1A1A]">
                  {docError}
                </p>
              )}
            </form>

            {/* Documents List (Current + Historical) */}
            <div className="flex flex-col gap-2.5">
              {docsList.length === 0 ? (
                <p className="text-center py-6 text-[13px] text-[#5B403D]">
                  Aucun document enregistré pour ce véhicule.
                </p>
              ) : (
                docsList.map((d) => {
                  const colorCls = !d.isCurrent
                    ? 'bg-[#F0EDF1] text-[#5B403D] opacity-70'
                    : d.computed.color === 'red'
                      ? 'bg-[#FFDAD6] text-[#93000A]'
                      : d.computed.color === 'orange'
                        ? 'bg-[#FEF3C7] text-[#78350F]'
                        : 'bg-[#DCFCE7] text-[#14532D]';

                  return (
                    <div
                      key={d.id}
                      className={`p-3.5 rounded-lg border border-[#E4BEB9] flex flex-wrap items-center justify-between gap-3 ${
                        !d.isCurrent ? 'bg-[#F0EDF1]/60' : 'bg-white'
                      }`}
                    >
                      <div>
                        <span className="font-label text-[13px] font-semibold text-[#1B1B1E] block">
                          {d.docName} {!d.isCurrent && '(Historique renouvelé)'}
                        </span>
                        <span className="text-[12px] text-[#5B403D] tabular-nums">
                          Émis : {d.issueDate} ·{' '}
                          {d.expiryDate ? `Expire : ${d.expiryDate}` : 'Permanent'} · Ajouté :{' '}
                          {formatDate(d.uploadedAt)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className={`px-2.5 py-1 rounded-full font-label text-[11px] font-semibold ${colorCls}`}>
                          {!d.isCurrent
                            ? 'Archivé'
                            : d.computed.status === 'expired'
                              ? `${t.docExpired} (${Math.abs(d.computed.remainingDays || 0)} j)`
                              : d.computed.status === 'approaching'
                                ? `${d.computed.remainingDays} j restants`
                                : t.docValid}
                        </span>
                        <a
                          href={authorizedFileUrl(d.fileUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1 rounded border border-[#E4BEB9] bg-white text-[11px] font-semibold hover:bg-[#F6F2F7]"
                        >
                          {t.viewDoc}
                        </a>
                        {d.isCurrent && (
                          <button
                            type="button"
                            onClick={() => {
                              setRenewDocId(d.id);
                              handleDocTypeChange(d.docType);
                              setDocName(d.docName);
                            }}
                            className="px-2.5 py-1 rounded bg-[#111114] text-white text-[11px] font-semibold cursor-pointer"
                          >
                            {t.renewDoc}
                          </button>
                        )}
                        {canDeleteDocuments && (
                          <button
                            type="button"
                            onClick={() => setConfirmDoc(d)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#BA1A1A] text-[#BA1A1A] hover:bg-[#FFDAD6] text-[11px] font-semibold cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[13px]">delete</span>
                            Supprimer
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmVehicle)}
        title="Supprimer ce véhicule ?"
        targetLabel={
          confirmVehicle
            ? `${confirmVehicle.brand} ${confirmVehicle.model} · ${confirmVehicle.registrationNumber}`
            : ''
        }
        message="Si ce véhicule possède des contrats clôturés ou des écritures comptables, il sera archivé de façon sécurisée pour préserver l'historique financier. S'il est actif ou réservé, la suppression sera refusée."
        confirmText="Supprimer"
        loading={deleting}
        onConfirm={handleDeleteVehicle}
        onCancel={() => setConfirmVehicle(null)}
      />

      <ConfirmDialog
        open={Boolean(confirmDoc)}
        title="Supprimer ce document véhicule ?"
        targetLabel={confirmDoc ? `${confirmDoc.docName} (${confirmDoc.issueDate})` : ''}
        message="Le document sera retiré du dossier actif de ce véhicule et ne déclenchera plus d'alertes d'expiration."
        confirmText="Supprimer"
        loading={deleting}
        onConfirm={handleDeleteDoc}
        onCancel={() => setConfirmDoc(null)}
      />
    </div>
  );
};
