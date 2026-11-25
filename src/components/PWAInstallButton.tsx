import React, { useEffect, useState } from 'react';
import type { Lang } from '../i18n/translations.ts';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';
import { getPwaUpdateState, subscribePwaUpdate, applyUpdateNow } from '../lib/pwaUpdater.ts';

interface Props {
  lang?: Lang;
  variant?: 'header' | 'dark';
}

export const PWAInstallButton: React.FC<Props> = ({ lang = 'fr', variant = 'header' }) => {
  const { isInstallable, isInstalled, isIOS, browserEngine, install } = usePWAInstall();
  const [updateState, setUpdateState] = useState(() => getPwaUpdateState());
  const [showGuide, setShowGuide] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return subscribePwaUpdate(setUpdateState);
  }, []);

  const isUpdateReady = updateState.updateReady;

  const labels = {
    fr: {
      install: 'Installer TRANSCAR',
      installed: 'TRANSCAR est déjà installé',
      update: 'Mettre à jour TRANSCAR',
      title: 'Installer TRANSCAR sur Windows (Chrome / Edge)',
      iosSteps:
        '1. Appuyez sur Partager dans Safari.\n2. Choisissez « Sur l’écran d’accueil » pour ouvrir TRANSCAR en application autonome.',
      windowsSteps:
        browserEngine === 'edge'
          ? 'Microsoft Edge (Windows) :\n1. Ouvrez ce lien officiel directement dans Microsoft Edge.\n2. Cliquez sur l’icône « Installer TRANSCAR » dans la barre d’adresse (ou Menu ··· → Applications → Installer ce site en tant qu’application).\n3. TRANSCAR s’ouvrira dans sa propre fenêtre Windows indépendante sans onglets.'
          : 'Google Chrome / Microsoft Edge (Windows) :\n1. Ouvrez ce lien officiel directement dans Chrome ou Edge (hors fenêtre d’aperçu).\n2. Cliquez sur l’icône « Installer » à droite de la barre d’adresse (ou Menu ⋮ → Caster, enregistrer et partager → Installer la page en tant qu’application).\n3. TRANSCAR s’ouvrira dans sa propre fenêtre Windows indépendante et fonctionnera hors ligne.',
      siteLabel: 'Lien officiel permanent TRANSCAR :',
      copy: 'Copier le lien',
      copied: 'Lien copié !',
      close: 'Fermer',
    },
    ar: {
      install: 'تثبيت TRANSCAR',
      installed: 'تطبيق TRANSCAR مثبت بالفعل',
      update: 'تحديث TRANSCAR',
      title: 'تثبيت TRANSCAR على Windows (Chrome / Edge)',
      iosSteps:
        '1. اضغط على زر المشاركة في Safari.\n2. اختر « إضافة إلى الشاشة الرئيسية » لتشغيل التطبيق في نافذة مستقلة.',
      windowsSteps:
        'في Google Chrome أو Microsoft Edge على نظام Windows:\n1. افتح الرابط الرسمي مباشرة في متصفح Chrome أو Edge.\n2. اضغط على أيقونة التثبيت في شريط العنوان (أو القائمة ⋮ ← التطبيقات ← تثبيت TRANSCAR).\n3. سيفتح التطبيق في نافذة مستقلة على سطح المكتب ويعمل بدون إنترنت.',
      siteLabel: 'الرابط الرسمي الدائم لتطبيق TRANSCAR:',
      copy: 'نسخ الرابط',
      copied: 'تم نسخ الرابط!',
      close: 'إغلاق',
    },
    en: {
      install: 'Install TRANSCAR',
      installed: 'TRANSCAR is already installed',
      update: 'Update TRANSCAR',
      title: 'Install TRANSCAR on Windows (Chrome / Edge)',
      iosSteps:
        '1. Tap the Share button in Safari.\n2. Scroll down and tap "Add to Home Screen".',
      windowsSteps:
        browserEngine === 'edge'
          ? 'Microsoft Edge (Windows):\n1. Open this official URL directly in Microsoft Edge.\n2. Click the "Install TRANSCAR" icon in the address bar (or Menu ··· → Apps → Install this site as an app).\n3. TRANSCAR launches in its own dedicated Windows window without browser tabs and works offline.'
          : 'Google Chrome / Microsoft Edge (Windows):\n1. Open this official URL directly in Chrome or Edge.\n2. Click the "Install" icon in the address bar (or Menu ⋮ → Cast, save, and share → Install page as app...).\n3. TRANSCAR opens in its own standalone Windows window and works offline.',
      siteLabel: 'Official Permanent TRANSCAR Website Link:',
      copy: 'Copy Link',
      copied: 'Link copied!',
      close: 'Close',
    },
  }[lang];

  const officialUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const handleCopyUrl = async () => {
    if (!officialUrl || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(officialUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard restrictions
    }
  };

  const handleClick = async () => {
    if (isUpdateReady) {
      await applyUpdateNow();
      return;
    }
    if (isInstallable) {
      const accepted = await install();
      if (accepted) return;
    }
    setShowGuide(true);
  };

  const btnClasses =
    variant === 'dark'
      ? 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] font-label text-[12px] font-semibold cursor-pointer transition-colors shrink-0'
      : 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#93000B] bg-[#93000B] text-white hover:bg-[#B91C1C] font-label text-[12px] font-semibold cursor-pointer transition-colors shrink-0';

  const buttonText = isUpdateReady
    ? labels.update
    : isInstalled
      ? labels.installed
      : labels.install;

  const buttonIcon = isUpdateReady ? 'system_update_alt' : isInstalled ? 'check_circle' : 'install_desktop';

  return (
    <>
      <button type="button" onClick={handleClick} className={btnClasses}>
        <span className="material-symbols-outlined text-[16px]">{buttonIcon}</span>
        <span>{buttonText}</span>
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true">
          <div
            dir={lang === 'ar' ? 'rtl' : 'ltr'}
            className="w-full max-w-md rounded-xl bg-white p-6 border border-[#E4BEB9] shadow-xl text-[#1B1B1E]"
          >
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#E4BEB9]">
              <h3 className="font-title text-[16px] font-bold text-[#1B1B1E] flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-[#93000B]">
                  install_desktop
                </span>
                <span>{labels.title}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="w-8 h-8 rounded border border-[#E4BEB9] flex items-center justify-center cursor-pointer hover:bg-[#F6F2F7]"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3 text-[13px] text-[#5B403D]">
              <p className="whitespace-pre-line leading-relaxed">
                {isIOS ? labels.iosSteps : labels.windowsSteps}
              </p>

              <div className="p-3 rounded-lg bg-[#F6F2F7] border border-[#E4BEB9]">
                <span className="font-label text-[11px] font-semibold text-[#5B403D] block mb-1">
                  {labels.siteLabel}
                </span>
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono text-[12px] text-[#93000B] break-all select-all">
                    {officialUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void handleCopyUrl();
                    }}
                    className="shrink-0 px-2.5 py-1 rounded border border-[#E4BEB9] bg-white text-[#1B1B1E] hover:bg-[#EAE7EB] text-[11px] font-semibold cursor-pointer"
                  >
                    {copied ? labels.copied : labels.copy}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full rounded-lg bg-[#111114] py-2.5 text-[13px] font-semibold text-white hover:bg-[#303033] cursor-pointer"
            >
              {labels.close}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
