import React, { useEffect, useState } from 'react';
import { useOnlineStatus } from '../hooks/usePWAInstall.ts';
import type { Lang } from '../i18n/translations.ts';
import { getAuthToken } from '../lib/api.ts';
import {
  clearOfflineSyncLogs,
  computeSyncStatus,
  dismissQueueItem,
  retryAllQueueErrors,
  retryQueueItem,
  subscribeSyncStatus,
  type SyncStatusState,
} from '../lib/offlineSync.ts';

interface Props {
  lang?: Lang;
  onSyncNow?: () => void;
}

export const OfflineIndicator: React.FC<Props> = ({ lang = 'fr', onSyncNow }) => {
  const isOnline = useOnlineStatus();
  const [syncState, setSyncState] = useState<SyncStatusState>(() => computeSyncStatus());
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const unsub = subscribeSyncStatus((state) => setSyncState(state));
    const onOnlineChange = () => setSyncState(computeSyncStatus());
    window.addEventListener('online', onOnlineChange);
    window.addEventListener('offline', onOnlineChange);
    return () => {
      unsub();
      window.removeEventListener('online', onOnlineChange);
      window.removeEventListener('offline', onOnlineChange);
    };
  }, [isOnline]);

  const effectiveMode = !isOnline ? 'offline' : syncState.mode;
  const { pendingCount, errorCount, queue, logs, lastSyncAt } = syncState;

  // Hide floating pill when purely online with 0 pending & 0 errors (sidebar badge always displays Online state)
  if (effectiveMode === 'online' && pendingCount === 0 && errorCount === 0 && !drawerOpen) {
    return null;
  }

  const badgeStyle =
    effectiveMode === 'error'
      ? 'bg-[#93000B] text-white'
      : effectiveMode === 'offline'
        ? 'bg-[#B45309] text-white'
        : effectiveMode === 'syncing'
          ? 'bg-[#1B1B1E] text-white'
          : 'bg-[#047857] text-white';

  const label =
    lang === 'ar'
      ? effectiveMode === 'offline'
        ? `وضع عدم الاتصال${pendingCount > 0 ? ` (${pendingCount} في الانتظار)` : ''}`
        : effectiveMode === 'error'
          ? `خطأ في المزامنة (${errorCount})`
          : effectiveMode === 'syncing'
            ? `جاري المزامنة (${pendingCount})...`
            : 'متصل بالخادم'
      : lang === 'en'
        ? effectiveMode === 'offline'
          ? `Offline Mode${pendingCount > 0 ? ` (${pendingCount} queued)` : ''}`
          : effectiveMode === 'error'
            ? `Sync error (${errorCount})`
            : effectiveMode === 'syncing'
              ? `Synchronizing (${pendingCount})...`
              : 'Online — Synced'
        : effectiveMode === 'offline'
          ? `Hors ligne — Cache IndexedDB actif${pendingCount > 0 ? ` (${pendingCount} en attente)` : ''}`
          : effectiveMode === 'error'
            ? `Erreur de synchronisation (${errorCount})`
            : effectiveMode === 'syncing'
              ? `Synchronisation en cours (${pendingCount})...`
              : 'En ligne — Synchronisé';

  return (
    <>
      <div className={`no-print fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg px-3.5 py-2 text-[12px] font-semibold shadow-lg ${badgeStyle}`}>
        <span
          className={`h-2 w-2 rounded-full bg-white ${
            effectiveMode === 'syncing' || effectiveMode === 'offline' ? 'animate-pulse' : ''
          }`}
        />
        <span>{label}</span>
        {isOnline && pendingCount > 0 && onSyncNow && (
          <button
            type="button"
            onClick={onSyncNow}
            className="ml-1 underline font-bold cursor-pointer"
          >
            Sync
          </button>
        )}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="ml-1 px-1.5 py-0.5 rounded bg-white/15 hover:bg-white/25 text-[11px] cursor-pointer"
        >
          Détails
        </button>
      </div>

      {drawerOpen && (
        <div className="no-print fixed inset-0 z-[65] bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-xl border border-[#E4BEB9] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <header className="px-5 py-4 border-b border-[#E4BEB9] flex items-center justify-between bg-[#F6F2F7]">
              <div>
                <h3 className="font-title text-[16px] font-semibold text-[#1B1B1E]">
                  État de synchronisation & File hors ligne (IndexedDB)
                </h3>
                <p className="text-[12px] text-[#5B403D]">
                  Dernière synchro réussie :{' '}
                  {lastSyncAt ? new Date(lastSyncAt).toLocaleString('fr-FR') : 'Aucune pour cette session'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="w-8 h-8 rounded border border-[#E4BEB9] bg-white flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </header>

            <div className="p-5 overflow-y-auto flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-[#1B1B1E]">
                  Opérations en attente / en erreur ({queue.length})
                </span>
                <div className="flex gap-2">
                  {isOnline && queue.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void retryAllQueueErrors(getAuthToken())}
                      className="h-8 px-3 rounded bg-[#111114] text-white text-[12px] font-semibold cursor-pointer"
                    >
                      Tout synchroniser
                    </button>
                  )}
                </div>
              </div>

              {queue.length === 0 ? (
                <div className="p-4 rounded-lg bg-[#F6F2F7] text-[12px] text-[#5B403D]">
                  Aucune opération locale en attente. Toutes vos données sont à jour avec le serveur.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {queue.map((item) => (
                    <div
                      key={item.id}
                      className={`p-3 rounded-lg border text-[12px] flex items-start justify-between gap-3 ${
                        item.status === 'conflict' || item.status === 'error'
                          ? 'bg-[#FFDAD6] border-[#93000B]/30 text-[#93000A]'
                          : 'bg-[#F6F2F7] border-[#E4BEB9] text-[#1B1B1E]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-semibold">
                          {item.method} {item.url} ({item.bodyType === 'formdata' ? 'avec fichier(s)' : 'JSON'})
                        </div>
                        <div className="text-[11px] opacity-80">
                          Créé le {new Date(item.createdAt).toLocaleString('fr-FR')} · Clé: {item.idempotencyKey.slice(0, 14)}...
                        </div>
                        {item.errorMessage && (
                          <div className="mt-1 font-semibold">{item.errorMessage}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isOnline && (
                          <button
                            type="button"
                            onClick={() => void retryQueueItem(item.id, getAuthToken())}
                            className="h-7 px-2.5 rounded bg-white border border-[#E4BEB9] text-[#1B1B1E] font-semibold cursor-pointer"
                          >
                            Réessayer
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => dismissQueueItem(item.id)}
                          className="h-7 px-2.5 rounded bg-[#93000B] text-white font-semibold cursor-pointer"
                        >
                          Ignorer
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="border-t border-[#E4BEB9] pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[13px] font-semibold text-[#1B1B1E]">
                    Journal de synchronisation récent
                  </span>
                  {logs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => clearOfflineSyncLogs()}
                      className="text-[11px] font-semibold text-[#5B403D] hover:underline cursor-pointer"
                    >
                      Vider le journal
                    </button>
                  )}
                </div>
                {logs.length === 0 ? (
                  <p className="text-[12px] text-[#5B403D]">Aucun événement récent.</p>
                ) : (
                  <div className="max-h-44 overflow-y-auto flex flex-col gap-1.5">
                    {logs.map((l) => (
                      <div
                        key={l.id}
                        className="px-3 py-2 rounded bg-[#F6F2F7] text-[11px] flex items-center justify-between gap-2"
                      >
                        <span className="truncate font-medium text-[#1B1B1E]">
                          [{l.status.toUpperCase()}] {l.method} {l.url} — {l.message}
                        </span>
                        <span className="text-[#5B403D] shrink-0 tabular-nums">
                          {new Date(l.timestamp).toLocaleTimeString('fr-FR')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
