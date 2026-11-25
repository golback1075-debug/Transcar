import React, { useEffect, useState } from 'react';
import { apiFetch, formatDate, formatDzd } from '../../lib/api.ts';
import type { CustomerItem, ReservationItem, VehicleItem } from '../../types.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

interface Props {
  reservations: ReservationItem[];
  vehicles: VehicleItem[];
  customers: CustomerItem[];
  canDeleteReservations?: boolean;
  onRefresh: () => void | Promise<void>;
  onConvertToContract: (reservation: ReservationItem) => void;
}

export const ReservationsView: React.FC<Props> = ({
  reservations,
  vehicles,
  customers,
  canDeleteReservations = true,
  onRefresh,
  onConvertToContract,
}) => {
  const [vehicleId, setVehicleId] = useState<number>(vehicles[0]?.id || 0);
  const [customerId, setCustomerId] = useState<number>(customers[0]?.id || 0);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(
    new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [confirmRes, setConfirmRes] = useState<ReservationItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (vehicles.length > 0 && (!vehicleId || !vehicles.some((v) => v.id === vehicleId))) {
      setVehicleId(vehicles[0].id);
    }
  }, [vehicles, vehicleId]);

  useEffect(() => {
    if (customers.length > 0 && (!customerId || !customers.some((c) => c.id === customerId))) {
      setCustomerId(customers[0].id);
    }
  }, [customers, customerId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError('');
    const targetVehicleId = vehicleId || vehicles[0]?.id;
    const targetCustomerId = customerId || customers[0]?.id;
    if (!targetVehicleId) {
      setError('Veuillez sélectionner un véhicule.');
      return;
    }
    if (!targetCustomerId) {
      setError('Veuillez sélectionner un client.');
      return;
    }
    if (!startDate || !endDate) {
      setError('Les dates de départ et de retour sont obligatoires.');
      return;
    }
    if (new Date(`${endDate}T18:00:00Z`).getTime() <= new Date(`${startDate}T09:00:00Z`).getTime()) {
      setError('La date de retour doit être postérieure à la date de départ.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/reservations', {
        method: 'POST',
        body: JSON.stringify({
          vehicleId: targetVehicleId,
          customerId: targetCustomerId,
          startDate: `${startDate}T09:00:00Z`,
          endDate: `${endDate}T18:00:00Z`,
          notes: notes.trim(),
        }),
      });
      setNotes('');
      await onRefresh();
      setFeedback({ type: 'success', text: 'Réservation enregistrée avec succès.' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la création de la réservation.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteReservation = async () => {
    if (!confirmRes) return;
    setDeleting(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{ message?: string }>(`/api/reservations/${confirmRes.id}`, {
        method: 'DELETE',
      });
      setFeedback({
        type: 'success',
        text: res.message || `Réservation ${confirmRes.reservationCode} supprimée.`,
      });
      onRefresh();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur lors de la suppression.',
      });
    } finally {
      setDeleting(false);
      setConfirmRes(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
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
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <section className="lg:col-span-4 bg-white border border-[#E4BEB9] rounded-lg p-6 flex flex-col gap-4">
        <header className="border-b border-[#E4BEB9] pb-3">
          <h2 className="font-title text-[18px] font-semibold text-[#1B1B1E]">
            Nouvelle réservation
          </h2>
          <p className="text-[12px] text-[#5B403D]">
            Vérification transactionnelle anti-chevauchement
          </p>
        </header>

        <form noValidate onSubmit={handleCreate} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold">Véhicule *</span>
            <select
              required
              value={vehicleId || vehicles[0]?.id || ''}
              onChange={(e) => setVehicleId(Number(e.target.value))}
              className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
            >
              {vehicles.length === 0 && <option value="">Aucun véhicule</option>}
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.brand} {v.model} · {v.registrationNumber} ({formatDzd(v.dailyPriceDzd)}/j)
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold">Client *</span>
            <select
              required
              value={customerId || customers[0]?.id || ''}
              onChange={(e) => setCustomerId(Number(e.target.value))}
              className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
            >
              {customers.length === 0 && <option value="">Aucun client</option>}
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName} · {c.phone}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold">Départ *</span>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold">Retour *</span>
              <input
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold">Notes</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
            />
          </label>

          {error && (
            <p className="text-[13px] font-semibold text-[#BA1A1A] bg-[#FFDAD6] px-3 py-2 rounded">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving || vehicles.length === 0 || customers.length === 0}
            className="px-4 py-2.5 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] font-label text-[13px] font-semibold cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Enregistrement...' : 'Confirmer la réservation'}
          </button>
        </form>
      </section>

      <section className="lg:col-span-8 bg-white border border-[#E4BEB9] rounded-lg overflow-hidden">
        <header className="px-5 py-4 border-b border-[#E4BEB9] flex items-center justify-between">
          <h2 className="font-title text-[18px] font-semibold text-[#1B1B1E]">
            Réservations ({reservations.length})
          </h2>
        </header>

        <table className="w-full text-left border-collapse">
          <thead className="bg-[#F6F2F7] border-b border-[#E4BEB9]">
            <tr>
              <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase">
                Code & Source
              </th>
              <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase">
                Client & Véhicule
              </th>
              <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase">
                Période & Montant
              </th>
              <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E4BEB9]">
            {reservations.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-[13px] text-[#5B403D]">
                  0 réservation enregistrée.
                </td>
              </tr>
            ) : (
              reservations.map((r) => (
                <tr key={r.id} className="hover:bg-[#F6F2F7]">
                  <td className="px-4 py-3">
                    <span className="font-mono text-[13px] font-semibold block">
                      {r.reservationCode}
                    </span>
                    <span className="inline-flex px-2 py-0.5 rounded bg-[#F0EDF1] text-[11px] font-semibold">
                      {r.source === 'website' ? 'Site Web' : 'Agence'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-[13px] block">
                      {r.customer?.fullName || '—'}
                    </span>
                    <span className="text-[12px] text-[#5B403D]">
                      {r.vehicle ? `${r.vehicle.brand} ${r.vehicle.model} (${r.vehicle.registrationNumber})` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    <span className="text-[12px] block">
                      {formatDate(r.startDate)} → {formatDate(r.endDate)}
                    </span>
                    <span className="font-mono text-[12px] font-semibold text-[#93000B]">
                      {formatDzd(r.totalAmountDzd)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      {r.status === 'confirmed' && (
                        <>
                          <button
                            type="button"
                            onClick={() => onConvertToContract(r)}
                            className="px-2.5 py-1 rounded bg-[#93000B] text-white text-[11px] font-semibold cursor-pointer"
                          >
                            Créer contrat
                          </button>
                          <button
                            type="button"
                            disabled={cancellingId === r.id}
                            onClick={async () => {
                              setCancellingId(r.id);
                              setFeedback(null);
                              try {
                                await apiFetch(`/api/reservations/${r.id}/status`, {
                                  method: 'PUT',
                                  body: JSON.stringify({ status: 'cancelled', version: r.version }),
                                });
                                await onRefresh();
                                setFeedback({
                                  type: 'success',
                                  text: `Réservation ${r.reservationCode} annulée.`,
                                });
                              } catch (err) {
                                setFeedback({
                                  type: 'error',
                                  text:
                                    err instanceof Error
                                      ? err.message
                                      : "Erreur lors de l'annulation.",
                                });
                              } finally {
                                setCancellingId(null);
                              }
                            }}
                            className="px-2.5 py-1 rounded border border-[#E4BEB9] text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                          >
                            {cancellingId === r.id ? 'Annulation...' : 'Annuler'}
                          </button>
                        </>
                      )}
                      {r.status !== 'confirmed' && (
                        <span className="px-2.5 py-1 rounded-full bg-[#F0EDF1] text-[11px] font-semibold">
                          {r.status}
                        </span>
                      )}
                      {canDeleteReservations && (
                        <button
                          type="button"
                          onClick={() => setConfirmRes(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#BA1A1A] text-[#BA1A1A] hover:bg-[#FFDAD6] text-[11px] font-semibold cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[13px]">delete</span>
                          Supprimer
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>

    <ConfirmDialog
      open={Boolean(confirmRes)}
      title="Supprimer cette réservation ?"
      targetLabel={
        confirmRes
          ? `${confirmRes.reservationCode} · ${confirmRes.customer?.fullName || ''}`
          : ''
      }
      message="Cette réservation sera retirée de la base de données. Si elle a déjà été convertie en contrat actif, la suppression sera refusée."
      confirmText="Supprimer"
      loading={deleting}
      onConfirm={handleDeleteReservation}
      onCancel={() => setConfirmRes(null)}
    />
    </div>
  );
};
