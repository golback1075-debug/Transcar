import React, { useEffect, useState } from 'react';
import { TRANSLATIONS, type Lang } from '../i18n/translations.ts';
import {
  applyUpdateNow,
  getPwaUpdateState,
  postponeUpdate,
  subscribePwaUpdate,
  type PwaUpdateState,
} from '../lib/pwaUpdater.ts';

interface Props {
  lang: Lang;
}

export const PWAUpdateBanner: React.FC<Props> = ({ lang }) => {
  const [state, setState] = useState<PwaUpdateState>(() => getPwaUpdateState());
  const [unsavedConfirm, setUnsavedConfirm] = useState(false);

  useEffect(() => {
    return subscribePwaUpdate(setState);
  }, []);

  const canInstallNow = state.updateReady && (state.status !== 'offline' || state.hasWaitingWorker);
  if (!canInstallNow || state.dismissedForSession) {
    return null;
  }

  const t = TRANSLATIONS[lang];
  const isUpdating = state.status === 'updating';

  const handleUpdateClick = async (force = false) => {
    const res = await applyUpdateNow({ forceWithUnsavedWork: force });
    if (!res.ok && res.reason === 'unsaved-work') {
      setUnsavedConfirm(true);
    } else if (res.ok) {
      setUnsavedConfirm(false);
    }
  };

  return (
    <aside
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      role="status"
      aria-live="polite"
      className="no-print fixed bottom-4 right-4 left-4 sm:left-auto sm:w-[430px] z-50 bg-[#111114] text-white border border-[#93000B] rounded-xl shadow-2xl p-4 flex flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-[#93000B] text-white flex items-center justify-center shrink-0 mt-0.5">
          <span className="material-symbols-outlined text-[20px]">system_update_alt</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-title text-[13px] font-semibold text-white leading-snug">
            {t.updateBannerTitle}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#DCD9DD]">
            <span className="font-mono px-2 py-0.5 rounded bg-[#303033] text-white">
              v{state.currentVersion}
              {state.latestVersion !== state.currentVersion ? ` → v${state.latestVersion}` : ''}
            </span>
            {state.pendingOfflineChangesCount > 0 && (
              <span className="text-[#FDE68A]">
                ({state.pendingOfflineChangesCount} {t.offlineQueuePreservedNote})
              </span>
            )}
          </div>
          {unsavedConfirm && (
            <p className="mt-2 rounded bg-[#93000B]/25 border border-[#93000B] px-2.5 py-1.5 text-[11px] text-[#FFDAD6] leading-snug">
              {t.unsavedWorkWarning}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={isUpdating}
          onClick={() => {
            setUnsavedConfirm(false);
            postponeUpdate();
          }}
          className="px-3 py-1.5 rounded border border-[#303033] bg-[#1B1B1E] text-[#DCD9DD] hover:bg-[#303033] hover:text-white text-[12px] font-semibold cursor-pointer disabled:opacity-50"
        >
          {t.updateLater}
        </button>
        <button
          type="button"
          disabled={isUpdating}
          onClick={() => {
            void handleUpdateClick(unsavedConfirm);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-[#93000B] hover:bg-[#B91C1C] text-white text-[12px] font-semibold cursor-pointer disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">
            {isUpdating ? 'sync' : 'download_done'}
          </span>
          <span>
            {isUpdating
              ? t.updateStatusUpdating
              : unsavedConfirm
                ? t.confirmUpdateAnyway
                : t.updateNow}
          </span>
        </button>
      </div>
    </aside>
  );
};
