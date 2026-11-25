import React, { useState } from 'react';
import type { NotificationItem } from '../types.ts';
import { formatDateTime } from '../lib/api.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

interface Props {
  open: boolean;
  notifications: NotificationItem[];
  canDeleteNotifications?: boolean;
  onClose: () => void;
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
  onDeleteNotification: (id: number) => Promise<void> | void;
  onClearAllNotifications: () => Promise<void> | void;
  onRunChecks: () => void;
}

export const NotificationDrawer: React.FC<Props> = ({
  open,
  notifications,
  canDeleteNotifications = true,
  onClose,
  onMarkRead,
  onMarkAllRead,
  onDeleteNotification,
  onClearAllNotifications,
  onRunChecks,
}) => {
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmSingle, setConfirmSingle] = useState<NotificationItem | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const handleConfirmSingle = async () => {
    if (!confirmSingle) return;
    setBusy(true);
    try {
      await onDeleteNotification(confirmSingle.id);
    } finally {
      setBusy(false);
      setConfirmSingle(null);
    }
  };

  const handleConfirmClearAll = async () => {
    setBusy(true);
    try {
      await onClearAllNotifications();
    } finally {
      setBusy(false);
      setConfirmClearAll(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end">
      <div className="bg-white w-full max-w-md h-full border-l border-[#E4BEB9] flex flex-col">
        <header className="p-5 border-b border-[#E4BEB9] flex items-center justify-between gap-2">
          <div>
            <h2 className="font-title text-[18px] font-semibold text-[#1B1B1E]">
              Centre de notifications
            </h2>
            <p className="text-[12px] text-[#5B403D]">
              Surveillance automatique 30 / 15 / 7 / 0 j & maintenance
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded border border-[#E4BEB9] flex items-center justify-center cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </header>

        <div className="px-5 py-3 bg-[#F6F2F7] border-b border-[#E4BEB9] flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onRunChecks}
            className="text-[12px] font-semibold text-[#93000B] hover:underline cursor-pointer"
          >
            Vérifier maintenant
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onMarkAllRead}
              className="text-[12px] font-semibold text-[#1B1B1E] hover:underline cursor-pointer"
            >
              Tout marquer comme lu
            </button>
            {canDeleteNotifications && notifications.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirmClearAll(true)}
                className="text-[12px] font-semibold text-[#93000B] hover:underline cursor-pointer flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[15px]">delete_sweep</span>
                Tout supprimer
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3">
          {notifications.length === 0 ? (
            <div className="text-center py-12 text-[13px] text-[#5B403D]">
              Aucune notification pour le moment.
            </div>
          ) : (
            notifications.map((n) => {
              const cardCls =
                n.severity === 'urgent'
                  ? 'bg-[#FFDAD6] text-[#93000A]'
                  : n.severity === 'warning'
                    ? 'bg-[#FEF3C7] text-[#78350F]'
                    : 'bg-[#F6F2F7] text-[#1B1B1E]';
              const iconName =
                n.severity === 'urgent'
                  ? 'gpp_bad'
                  : n.severity === 'warning'
                    ? 'notifications_active'
                    : 'info';

              return (
                <div
                  key={n.id}
                  onClick={() => !n.isRead && onMarkRead(n.id)}
                  className={`p-3.5 rounded-lg border border-[#E4BEB9] flex items-start gap-2.5 cursor-pointer transition-opacity ${cardCls} ${
                    n.isRead ? 'opacity-65' : ''
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px] mt-0.5 shrink-0">
                    {iconName}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-label text-[13px] font-semibold">{n.title}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {!n.isRead && <span className="w-2 h-2 rounded-full bg-[#93000B]" />}
                        {canDeleteNotifications && (
                          <button
                            type="button"
                            title="Supprimer cette notification"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmSingle(n);
                            }}
                            className="w-6 h-6 rounded hover:bg-black/10 flex items-center justify-center cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[15px]">delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-[12px] mt-0.5">{n.message}</p>
                    <span className="text-[11px] opacity-75 block mt-1 tabular-nums">
                      {formatDateTime(n.createdAt)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmSingle)}
        title="Supprimer cette notification ?"
        targetLabel={confirmSingle?.title}
        message="Cette alerte sera retirée du centre de notifications sur tous vos postes. Les données sous-jacentes (contrats, véhicules, journaux) restent intactes."
        confirmText="Supprimer"
        loading={busy}
        onConfirm={handleConfirmSingle}
        onCancel={() => setConfirmSingle(null)}
      />

      <ConfirmDialog
        open={confirmClearAll}
        title="Effacer toutes les notifications ?"
        targetLabel={`${notifications.length} notification(s)`}
        message="Toutes les notifications visibles seront supprimées. Aucune donnée métier ou journal d’audit ne sera effacé."
        confirmText="Tout supprimer"
        loading={busy}
        onConfirm={handleConfirmClearAll}
        onCancel={() => setConfirmClearAll(false)}
      />
    </div>
  );
};
