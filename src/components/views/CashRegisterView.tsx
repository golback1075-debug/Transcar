import React, { useEffect, useState } from 'react';
import { TRANSLATIONS, type Lang } from '../../i18n/translations.ts';
import { apiFetch, formatDateTime, formatDzd } from '../../lib/api.ts';
import { generateIdempotencyKey } from '../../lib/offlineSync.ts';
import type { FinanceSummary, FinancialTransactionItem, VehicleItem } from '../../types.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

interface Props {
  lang: Lang;
  role?: 'manager' | 'employee';
  vehicles: VehicleItem[];
}

export const CashRegisterView: React.FC<Props> = ({ lang, role = 'manager', vehicles }) => {
  const t = TRANSLATIONS[lang];
  const [summary, setSummary] = useState<FinanceSummary>({
    cashBalance: 0,
    totalIncome: 0,
    totalDepositsHeld: 0,
    totalExpenses: 0,
    totalRefunds: 0,
    totalWithdrawals: 0,
    netProfit: 0,
    dailyTotal: 0,
    monthlyTotal: 0,
  });
  const [transactions, setTransactions] = useState<FinancialTransactionItem[]>([]);
  const [withdrawals, setWithdrawals] = useState<FinancialTransactionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New transaction form
  const [txType, setTxType] = useState<
    'rental_payment' | 'deposit_in' | 'deposit_refund' | 'expense' | 'refund' | 'late_extra_fee'
  >('expense');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [amountDzd, setAmountDzd] = useState<number>(0);
  const [category, setCategory] = useState('Exploitation');
  const [description, setDescription] = useState('');
  const [vehicleId, setVehicleId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  // Manager Withdrawal & Reset Modal state
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawMode, setWithdrawMode] = useState<'partial' | 'reset'>('partial');
  const [withdrawAmount, setWithdrawAmount] = useState<number>(0);
  const [withdrawNotes, setWithdrawNotes] = useState('');
  const [withdrawKey, setWithdrawKey] = useState<string>('');
  const [confirmWithdrawOpen, setConfirmWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  // Delete/archive transaction state
  const [confirmTx, setConfirmTx] = useState<FinancialTransactionItem | null>(null);
  const [deletingTx, setDeletingTx] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{
        summary: FinanceSummary;
        transactions: FinancialTransactionItem[];
        withdrawals?: FinancialTransactionItem[];
      }>('/api/finance/transactions');
      setSummary({
        ...res.summary,
        totalWithdrawals: res.summary.totalWithdrawals ?? 0,
      });
      setTransactions(res.transactions);
      setWithdrawals(
        res.withdrawals || res.transactions.filter((tx) => tx.txType === 'cash_withdrawal'),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur chargement caisse');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    if (!Number.isFinite(amountDzd) || amountDzd <= 0) {
      setError('Veuillez saisir un montant valide supérieur à 0 DZD.');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/api/finance/transactions', {
        method: 'POST',
        body: JSON.stringify({
          txType,
          paymentMethod,
          amountDzd,
          category: category.trim() || 'Exploitation',
          description: description.trim(),
          vehicleId: vehicleId ? Number(vehicleId) : null,
        }),
      });
      setAmountDzd(0);
      setDescription('');
      await loadData();
      setFeedback({ type: 'success', text: 'Opération enregistrée en caisse.' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction invalide');
    } finally {
      setSubmitting(false);
    }
  };

  const openWithdrawalModal = () => {
    setError('');
    setWithdrawMode('partial');
    setWithdrawAmount(summary.cashBalance > 0 ? summary.cashBalance : 0);
    setWithdrawNotes('');
    setWithdrawKey(generateIdempotencyKey());
    setWithdrawModalOpen(true);
  };

  const handleRequestWithdrawConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (summary.cashBalance <= 0) {
      setError('Le solde disponible en caisse est déjà à 0 DZD.');
      return;
    }
    if (withdrawMode === 'partial') {
      if (!withdrawAmount || withdrawAmount <= 0) {
        setError('Veuillez saisir un montant de retrait supérieur à 0 DZD.');
        return;
      }
      if (withdrawAmount > summary.cashBalance) {
        setError('Le montant saisi dépasse le solde disponible en caisse.');
        return;
      }
    }
    setConfirmWithdrawOpen(true);
  };

  const handleExecuteWithdrawal = async () => {
    if (withdrawing) return;
    setWithdrawing(true);
    setError('');
    try {
      const resetToZero = withdrawMode === 'reset';
      const amount = resetToZero ? summary.cashBalance : Math.round(withdrawAmount);
      const res = await apiFetch<{
        transaction: FinancialTransactionItem;
        summary?: FinanceSummary;
      }>('/api/finance/withdrawals', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': withdrawKey || generateIdempotencyKey() },
        body: JSON.stringify({
          amountDzd: amount,
          resetToZero,
          notes: withdrawNotes.trim(),
          paymentMethod: 'cash',
          idempotencyKey: withdrawKey,
        }),
      });
      setConfirmWithdrawOpen(false);
      setWithdrawModalOpen(false);
      setWithdrawNotes('');
      await loadData();
      const newBal = res.summary?.cashBalance ?? (resetToZero ? 0 : summary.cashBalance - amount);
      setFeedback({
        type: 'success',
        text: resetToZero
          ? `Retrait intégral de ${formatDzd(amount)} enregistré. Solde de caisse remis à 0 DZD.`
          : `Retrait de ${formatDzd(amount)} enregistré. Solde restant : ${formatDzd(newBal)}.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du retrait de caisse');
      setConfirmWithdrawOpen(false);
    } finally {
      setWithdrawing(false);
    }
  };

  const handleArchiveTransaction = async () => {
    if (!confirmTx) return;
    setDeletingTx(true);
    try {
      const res = await apiFetch<{ message?: string }>(`/api/finance/transactions/${confirmTx.id}`, {
        method: 'DELETE',
      });
      setFeedback({
        type: 'success',
        text: res.message || 'Écriture archivée avec traçabilité.',
      });
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur lors de la suppression.',
      });
    } finally {
      setDeletingTx(false);
      setConfirmTx(null);
    }
  };

  const txTypeLabel = (type: string) => {
    switch (type) {
      case 'rental_payment':
        return 'Encaissement location';
      case 'late_extra_fee':
        return 'Frais retard / km extra';
      case 'deposit_in':
        return 'Caution reçue';
      case 'deposit_refund':
        return 'Caution restituée';
      case 'expense':
        return 'Dépense';
      case 'refund':
        return 'Remboursement';
      case 'cash_withdrawal':
        return 'Retrait gérant';
      default:
        return type;
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

      {/* Manager Cash Summary + Manager Withdrawal Trigger */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <article className="bg-[#111114] text-white rounded-lg p-4 flex flex-col justify-between gap-2">
          <div>
            <span className="text-[11px] text-[#DCD9DD] block">{t.cashBalance}</span>
            <span className="font-headline text-[20px] font-bold tabular-nums">
              {formatDzd(summary.cashBalance)}
            </span>
          </div>
          {role === 'manager' && (
            <button
              type="button"
              onClick={openWithdrawalModal}
              className="mt-1 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded bg-[#93000B] hover:bg-[#B91C1C] text-white font-label text-[11px] font-semibold cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">payments</span>
              Retirer l'argent / Remettre la caisse à zéro
            </button>
          )}
        </article>
        <article className="bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-col gap-1">
          <span className="text-[11px] text-[#5B403D]">Recettes totales</span>
          <span className="font-headline text-[20px] font-bold text-[#15803D] tabular-nums">
            {formatDzd(summary.totalIncome)}
          </span>
        </article>
        <article className="bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-col gap-1">
          <span className="text-[11px] text-[#5B403D]">Cautions détenues</span>
          <span className="font-headline text-[20px] font-bold text-[#00497F] tabular-nums">
            {formatDzd(summary.totalDepositsHeld)}
          </span>
        </article>
        <article className="bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-col gap-1">
          <span className="text-[11px] text-[#5B403D]">{t.expenses} &amp; Remb.</span>
          <span className="font-headline text-[20px] font-bold text-[#BA1A1A] tabular-nums">
            {formatDzd(summary.totalExpenses + summary.totalRefunds)}
          </span>
          <span className="text-[11px] text-[#5B403D] tabular-nums">
            Retraits gérant : {formatDzd(summary.totalWithdrawals)}
          </span>
        </article>
        <article className="bg-white border border-[#E4BEB9] rounded-lg p-4 flex flex-col gap-1">
          <span className="text-[11px] text-[#5B403D]">{t.netProfit}</span>
          <span className="font-headline text-[20px] font-bold text-[#1B1B1E] tabular-nums">
            {formatDzd(summary.netProfit)}
          </span>
        </article>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Record Cash Operation */}
        <section className="lg:col-span-4 bg-white border border-[#E4BEB9] rounded-lg p-5 flex flex-col gap-4">
          <h2 className="font-title text-[18px] font-semibold text-[#1B1B1E]">
            {t.recordTransaction}
          </h2>
          {error && !withdrawModalOpen && (
            <div className="p-3 rounded bg-[#FFDAD6] text-[#93000A] text-[13px]">{error}</div>
          )}

          <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-label text-[12px] font-semibold">Type d'opération</span>
              <select
                value={txType}
                onChange={(e) => setTxType(e.target.value as typeof txType)}
                className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
              >
                <option value="expense">Dépense (Entretien / Agence)</option>
                <option value="rental_payment">Encaissement location</option>
                <option value="late_extra_fee">Supplément retard / km</option>
                <option value="deposit_in">Caution encaissée</option>
                <option value="deposit_refund">Restitution caution</option>
                <option value="refund">Remboursement client</option>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-label text-[12px] font-semibold">Montant (DZD) *</span>
              <input
                type="number"
                required
                min={1}
                value={amountDzd || ''}
                onChange={(e) => setAmountDzd(Number(e.target.value))}
                className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[13px]"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-label text-[12px] font-semibold">Mode de paiement</span>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
              >
                <option value="cash">Espèces</option>
                <option value="card">Carte</option>
                <option value="transfer">Virement</option>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-label text-[12px] font-semibold">Véhicule associé</span>
              <select
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
              >
                <option value="">Général (Agence)</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.brand} {v.model} ({v.registrationNumber})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-label text-[12px] font-semibold">Catégorie</span>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-label text-[12px] font-semibold">Description</span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Motif ou référence..."
                className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
              />
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 py-2.5 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] font-label text-[13px] font-semibold cursor-pointer disabled:opacity-50"
            >
              {submitting ? 'Enregistrement...' : 'Valider l’opération'}
            </button>
          </form>
        </section>

        {/* Right Column: Cash Ledger + Dedicated Withdrawal History */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          <section className="bg-white border border-[#E4BEB9] rounded-lg overflow-hidden">
            <header className="px-5 py-4 border-b border-[#E4BEB9] flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-title text-[18px] font-semibold text-[#1B1B1E]">
                Journal de caisse ({transactions.length})
              </h2>
              <span className="text-[12px] text-[#5B403D] tabular-nums">
                Aujourd’hui : {formatDzd(summary.dailyTotal)} · Ce mois :{' '}
                {formatDzd(summary.monthlyTotal)}
              </span>
            </header>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#F6F2F7] border-b border-[#E4BEB9]">
                  <tr>
                    <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase">
                      Date
                    </th>
                    <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase">
                      Type &amp; Motif
                    </th>
                    <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase">
                      Méthode
                    </th>
                    <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase text-right">
                      Montant
                    </th>
                    {role === 'manager' && (
                      <th className="px-4 py-3 font-label text-[11px] font-semibold text-[#5B403D] uppercase text-right">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4BEB9]">
                  {loading ? (
                    <tr>
                      <td colSpan={role === 'manager' ? 5 : 4} className="px-4 py-8 text-center text-[13px] text-[#5B403D]">
                        Chargement...
                      </td>
                    </tr>
                  ) : transactions.length === 0 ? (
                    <tr>
                      <td colSpan={role === 'manager' ? 5 : 4} className="px-4 py-8 text-center text-[13px] text-[#5B403D]">
                        Aucune opération enregistrée en caisse.
                      </td>
                    </tr>
                  ) : (
                    transactions.map((tx) => {
                      const isOut =
                        tx.txType === 'expense' ||
                        tx.txType === 'refund' ||
                        tx.txType === 'deposit_refund' ||
                        tx.txType === 'cash_withdrawal';
                      return (
                        <tr key={tx.id} className="hover:bg-[#F6F2F7]">
                          <td className="px-4 py-3 text-[12px] text-[#5B403D] tabular-nums">
                            {formatDateTime(tx.txDate)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-semibold text-[13px] text-[#1B1B1E] block">
                              {txTypeLabel(tx.txType)}
                            </span>
                            <span className="text-[12px] text-[#5B403D]">
                              {tx.description || tx.category}
                              {tx.vehicle ? ` · ${tx.vehicle.registrationNumber}` : ''}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[12px] uppercase text-[#5B403D]">
                            {tx.paymentMethod}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-mono text-[13px] font-semibold tabular-nums ${
                              isOut ? 'text-[#BA1A1A]' : 'text-[#15803D]'
                            }`}
                          >
                            {isOut ? '-' : '+'}
                            {formatDzd(tx.amountDzd)}
                          </td>
                          {role === 'manager' && (
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => setConfirmTx(tx)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#BA1A1A] text-[#BA1A1A] hover:bg-[#FFDAD6] text-[11px] font-semibold cursor-pointer"
                                title="Archiver / Supprimer l'écriture"
                              >
                                <span className="material-symbols-outlined text-[13px]">delete</span>
                                Supprimer
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Dedicated Manager Withdrawal History Section */}
          <section className="bg-white border border-[#E4BEB9] rounded-lg overflow-hidden">
            <header className="px-5 py-4 border-b border-[#E4BEB9] bg-[#F6F2F7] flex items-center justify-between gap-2">
              <div>
                <h2 className="font-title text-[16px] font-semibold text-[#1B1B1E]">
                  Historique des retraits gérant ({withdrawals.length})
                </h2>
                <p className="text-[12px] text-[#5B403D]">
                  Traçabilité complète des prélèvements et remises à zéro de caisse (revenus &amp; dépenses conservés)
                </p>
              </div>
              <span className="font-mono text-[13px] font-bold text-[#93000B] tabular-nums">
                Total retiré : {formatDzd(summary.totalWithdrawals)}
              </span>
            </header>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#F6F2F7] border-b border-[#E4BEB9]">
                  <tr>
                    <th className="px-4 py-2.5 font-label text-[11px] font-semibold text-[#5B403D] uppercase">
                      Date &amp; Heure
                    </th>
                    <th className="px-4 py-2.5 font-label text-[11px] font-semibold text-[#5B403D] uppercase">
                      Responsable
                    </th>
                    <th className="px-4 py-2.5 font-label text-[11px] font-semibold text-[#5B403D] uppercase">
                      Type &amp; Notes
                    </th>
                    <th className="px-4 py-2.5 font-label text-[11px] font-semibold text-[#5B403D] uppercase text-right">
                      Montant retiré
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4BEB9] text-[13px]">
                  {withdrawals.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-[#5B403D]">
                        Aucun retrait effectué pour le moment.
                      </td>
                    </tr>
                  ) : (
                    withdrawals.map((w) => (
                      <tr key={w.id} className="hover:bg-[#F6F2F7]">
                        <td className="px-4 py-3 text-[12px] text-[#5B403D] tabular-nums">
                          {formatDateTime(w.txDate)}
                        </td>
                        <td className="px-4 py-3 font-semibold uppercase text-[12px] text-[#1B1B1E]">
                          {w.createdByRole === 'manager' ? 'Gérant' : w.createdByRole || 'Gérant'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-semibold block text-[#1B1B1E]">{w.category}</span>
                          {w.description && (
                            <span className="text-[12px] text-[#5B403D]">{w.description}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-[#93000B] tabular-nums">
                          -{formatDzd(w.amountDzd)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      {/* Manager Cash Withdrawal & Reset Modal */}
      {withdrawModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E4BEB9] rounded-xl max-w-lg w-full p-6 flex flex-col gap-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E4BEB9] pb-3">
              <div>
                <h3 className="font-headline text-[18px] font-bold text-[#1B1B1E]">
                  Retrait de caisse Gérant
                </h3>
                <p className="text-[12px] text-[#5B403D]">
                  Toutes les recettes et dépenses historiques sont conservées.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWithdrawModalOpen(false)}
                className="w-8 h-8 rounded border border-[#E4BEB9] flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="p-4 rounded-lg bg-[#111114] text-white flex items-center justify-between">
              <span className="text-[12px] text-[#DCD9DD]">Solde actuel disponible en caisse</span>
              <span className="font-headline text-[22px] font-bold tabular-nums">
                {formatDzd(summary.cashBalance)}
              </span>
            </div>

            {error && (
              <div className="p-3 rounded bg-[#FFDAD6] text-[#93000A] text-[13px] font-medium">
                {error}
              </div>
            )}

            <form noValidate onSubmit={handleRequestWithdrawConfirm} className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setWithdrawMode('partial')}
                  className={`p-3 rounded-lg border text-left cursor-pointer ${
                    withdrawMode === 'partial'
                      ? 'border-[#93000B] bg-[#FFDAD6]/30 text-[#1B1B1E]'
                      : 'border-[#E4BEB9] bg-white text-[#5B403D]'
                  }`}
                >
                  <span className="font-label text-[12px] font-bold block">Montant personnalisé</span>
                  <span className="text-[11px]">Retirer une somme précise</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWithdrawMode('reset')}
                  className={`p-3 rounded-lg border text-left cursor-pointer ${
                    withdrawMode === 'reset'
                      ? 'border-[#93000B] bg-[#FFDAD6]/30 text-[#1B1B1E]'
                      : 'border-[#E4BEB9] bg-white text-[#5B403D]'
                  }`}
                >
                  <span className="font-label text-[12px] font-bold block">Tout retirer (0 DZD)</span>
                  <span className="text-[11px]">Remettre la caisse à zéro</span>
                </button>
              </div>

              {withdrawMode === 'partial' ? (
                <label className="flex flex-col gap-1">
                  <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                    Montant à retirer (DZD) *
                  </span>
                  <input
                    type="number"
                    required
                    min={1}
                    max={Math.max(1, summary.cashBalance)}
                    value={withdrawAmount || ''}
                    onChange={(e) => setWithdrawAmount(Number(e.target.value))}
                    className="rounded border border-[#E4BEB9] px-3 py-2 font-mono text-[14px]"
                  />
                </label>
              ) : (
                <div className="p-3 rounded-lg bg-[#FEF3C7] border border-[#B45309]/25 text-[#78350F] text-[12px]">
                  Le montant total de <strong>{formatDzd(summary.cashBalance)}</strong> sera prélevé et enregistré dans l’historique. Le solde disponible passera à <strong>0 DZD</strong>.
                </div>
              )}

              <label className="flex flex-col gap-1">
                <span className="font-label text-[12px] font-semibold text-[#1B1B1E]">
                  Notes / Motif (optionnel)
                </span>
                <textarea
                  rows={2}
                  value={withdrawNotes}
                  onChange={(e) => setWithdrawNotes(e.target.value)}
                  placeholder="Ex : Versement banque / Collecte fin de semaine..."
                  className="rounded border border-[#E4BEB9] px-3 py-2 text-[13px]"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWithdrawModalOpen(false)}
                  className="px-4 py-2 rounded border border-[#E4BEB9] text-[13px] font-semibold cursor-pointer"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={summary.cashBalance <= 0 || withdrawing}
                  className="px-5 py-2 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] text-[13px] font-semibold cursor-pointer disabled:opacity-50"
                >
                  {withdrawMode === 'reset'
                    ? 'Remettre la caisse à 0 DZD'
                    : 'Confirmer le retrait'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmWithdrawOpen}
        title={
          withdrawMode === 'reset'
            ? 'Confirmer la remise à zéro de la caisse ?'
            : 'Confirmer le retrait de caisse ?'
        }
        targetLabel={
          withdrawMode === 'reset'
            ? `Retrait total : ${formatDzd(summary.cashBalance)} → Solde 0 DZD`
            : `Montant retiré : ${formatDzd(withdrawAmount)}`
        }
        message="Ce retrait sera enregistré dans le journal financier et dans l'historique des retraits avec la date, l'heure et votre identité de Gérant."
        confirmText={withdrawMode === 'reset' ? 'Oui, remettre à 0 DZD' : 'Oui, retirer'}
        loading={withdrawing}
        onConfirm={handleExecuteWithdrawal}
        onCancel={() => setConfirmWithdrawOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(confirmTx)}
        title="Archiver / Supprimer cette écriture financière ?"
        targetLabel={
          confirmTx
            ? `${txTypeLabel(confirmTx.txType)} · ${formatDzd(confirmTx.amountDzd)}`
            : ''
        }
        message="L'écriture sera archivée de manière sécurisée avec traçabilité dans le journal d'audit."
        confirmText="Supprimer"
        loading={deletingTx}
        onConfirm={handleArchiveTransaction}
        onCancel={() => setConfirmTx(null)}
      />
    </div>
  );
};
