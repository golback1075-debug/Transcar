import React, { useEffect, useState } from 'react';
import { TRANSLATIONS, type Lang } from '../i18n/translations.ts';
import {
  getPwaUpdateState,
  subscribePwaUpdate,
  type PwaUpdateState,
} from '../lib/pwaUpdater.ts';

interface Props {
  lang: Lang;
}

export const OfflineReadyToast: React.FC<Props> = ({ lang }) => {
  const [state, setState] = useState<PwaUpdateState>(() => getPwaUpdateState());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    return subscribePwaUpdate(setState);
  }, []);

  if (!state.offlineReady || dismissed) {
    return null;
  }

  const isAr = lang === 'ar';

  return (
    <aside
      dir={isAr ? 'rtl' : 'ltr'}
      role="status"
      aria-live="polite"
      className="no-print fixed bottom-4 left-4 z-50 bg-[#15803D] text-white border border-[#166534] rounded-xl shadow-2xl p-3.5 flex items-center gap-3.5 max-w-[420px]"
    >
      <div className="w-8 h-8 rounded-lg bg-white/20 text-white flex items-center justify-center shrink-0">
        <span className="material-symbols-outlined text-[20px]">cloud_done</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-title text-[13px] font-semibold text-white leading-snug">
          {isAr
            ? 'ترانس كار جاهز للاستخدام بدون إنترنت'
            : 'TRANSCAR est prêt pour une utilisation hors ligne'}
        </p>
        <p className="text-[11px] text-[#DCFCE7] mt-0.5">
          {isAr
            ? 'تم حفظ ملفات التطبيق وبياناتك بنجاح للعمل دون اتصال بالإنترنت.'
            : "Tous les fichiers et données sont pré-cachés pour l'accès hors ligne."}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer transition-colors shrink-0"
        aria-label="Fermer"
      >
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </aside>
  );
};
