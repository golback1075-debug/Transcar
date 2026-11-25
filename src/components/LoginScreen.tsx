import React, { useState } from 'react';
import { useOnlineStatus } from '../hooks/usePWAInstall.ts';
import { TRANSLATIONS, type Lang } from '../i18n/translations.ts';
import {
  apiFetch,
  OFFLINE_TOKEN_MARKER,
  setAuthToken,
  setOfflineAuthSecret,
} from '../lib/api.ts';
import { signInWithFirebaseGoogle } from '../lib/firebase.ts';
import {
  hasOfflineCredentials,
  saveOfflineCredential,
  verifyOfflineCredential,
} from '../lib/offlineAuth.ts';
import { OfflineIndicator } from './OfflineIndicator.tsx';
import { PWAInstallButton } from './PWAInstallButton.tsx';

interface Props {
  lang: Lang;
  onChangeLang: (l: Lang) => void;
  onSuccess: (role: 'manager' | 'employee', email: string, offlineMode?: boolean) => void;
  onOpenCustomerPortal: () => void;
}

export const LoginScreen: React.FC<Props> = ({
  lang,
  onChangeLang,
  onSuccess,
  onOpenCustomerPortal,
}) => {
  const t = TRANSLATIONS[lang];
  const isOnline = useOnlineStatus();
  const offlineReady = hasOfflineCredentials();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const attemptOfflineUnlock = async (enteredPassword: string): Promise<boolean> => {
    const matched = await verifyOfflineCredential(enteredPassword);
    if (matched) {
      setAuthToken(OFFLINE_TOKEN_MARKER);
      setOfflineAuthSecret(enteredPassword);
      setPassword('');
      onSuccess(matched.role, matched.email, true);
      return true;
    }
    return false;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!navigator.onLine) {
        const unlocked = await attemptOfflineUnlock(password);
        if (!unlocked) {
          setError(offlineReady ? t.invalidCode : t.offlineFirstLoginHint);
        }
        return;
      }

      try {
        const res = await apiFetch<{ token: string; role: 'manager' | 'employee'; email: string }>(
          '/api/auth/login',
          {
            method: 'POST',
            body: JSON.stringify({ password }),
          },
        );
        await saveOfflineCredential(password, res.role, res.email);
        setAuthToken(res.token);
        setPassword('');
        onSuccess(res.role, res.email, false);
      } catch (err) {
        const isNetworkErr =
          !navigator.onLine ||
          err instanceof TypeError ||
          (err instanceof Error && err.message === 'Failed to fetch');
        if (isNetworkErr) {
          const unlocked = await attemptOfflineUnlock(password);
          if (unlocked) return;
          setError(offlineReady ? t.invalidCode : t.offlineFirstLoginHint);
          return;
        }
        throw err;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.invalidCode);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    if (!navigator.onLine) {
      setError(t.googleRequiresInternet);
      return;
    }
    setLoading(true);
    try {
      const idToken = await signInWithFirebaseGoogle();
      const res = await apiFetch<{ token: string; role: 'manager' | 'employee'; email: string }>(
        '/api/auth/firebase',
        {
          method: 'POST',
          body: JSON.stringify({ idToken }),
        },
      );
      setAuthToken(res.token);
      onSuccess(res.role, res.email, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.invalidCode);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-[#FBF8FC]"
    >
      {/* Left Brand Panel */}
      <section className="lg:col-span-6 bg-[#111114] text-white p-8 flex flex-col justify-between relative overflow-hidden">
        <div className="relative z-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-[#93000B] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[22px] text-white" aria-hidden="true">
                directions_car
              </span>
            </div>
            <div>
              <span className="font-headline text-[18px] font-semibold tracking-tight block">
                TRANSCAR
              </span>
              <span className="font-label text-[11px] text-[#DCD9DD] uppercase tracking-wider">
                {t.locationBlida}
              </span>
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#303033] text-[#F3F0F4] font-label text-[11px] font-semibold">
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-[#15803D]' : 'bg-[#F59E0B]'}`} />
            {isOnline ? t.synced : t.offline}
          </span>
        </div>

        <div className="relative z-10 my-8 flex flex-col gap-6">
          <div className="rounded-xl overflow-hidden border border-[#303033] bg-[#1B1B1E] p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-[#303033] pb-4">
              <div>
                <span className="font-headline text-[24px] font-bold text-white tracking-tight block">
                  TRANS CAR · BLIDA
                </span>
                <span className="text-[13px] text-[#DCD9DD]">
                  Boulevard Larbi Tebessi · RC 4038527A04
                </span>
              </div>
              <div className="w-12 h-12 rounded-lg bg-[#93000B]/20 border border-[#93000B] flex items-center justify-center">
                <span className="material-symbols-outlined text-[26px] text-[#FFB4AB]">
                  verified_user
                </span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 rounded bg-[#111114] border border-[#303033]">
                <span className="material-symbols-outlined text-[20px] text-[#FFB4AB] block mb-1">
                  garage
                </span>
                <span className="text-[11px] text-[#DCD9DD] block">Parc Automobile</span>
              </div>
              <div className="p-3 rounded bg-[#111114] border border-[#303033]">
                <span className="material-symbols-outlined text-[20px] text-[#FFB4AB] block mb-1">
                  description
                </span>
                <span className="text-[11px] text-[#DCD9DD] block">Contrats PDF</span>
              </div>
              <div className="p-3 rounded bg-[#111114] border border-[#303033]">
                <span className="material-symbols-outlined text-[20px] text-[#FFB4AB] block mb-1">
                  notifications_active
                </span>
                <span className="text-[11px] text-[#DCD9DD] block">Alertes & Suivi</span>
              </div>
            </div>
          </div>

          <div>
            <h1 className="font-display text-[34px] lg:text-[40px] leading-tight font-bold text-white mb-2">
              {t.loginHeroTitle}
            </h1>
            <p className="font-body text-[15px] text-[#DCD9DD] max-w-prose">
              {t.loginHeroSub}
            </p>
          </div>
        </div>

        <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-[#303033]">
          <span className="text-[13px] text-[#DCD9DD]">
            Boulevard Larbi Tebessi, Blida 09000
          </span>
          <span className="font-mono text-[13px] text-[#DCD9DD] tabular-nums">
            TRANSCAR Desktop
          </span>
        </div>
      </section>

      {/* Right Auth Card */}
      <main className="lg:col-span-6 bg-[#FBF8FC] p-8 flex flex-col justify-between items-center">
        <div className="w-full max-w-md flex flex-wrap items-center justify-end gap-2">
          <PWAInstallButton lang={lang} />
          <button
            type="button"
            onClick={() => onChangeLang('ar')}
            className={`px-3 py-1.5 rounded border font-label text-[11px] font-semibold cursor-pointer transition-colors ${
              lang === 'ar'
                ? 'border-[#93000B] bg-[#93000B] text-white'
                : 'border-[#E4BEB9] bg-white text-[#1B1B1E] hover:bg-[#F0EDF1]'
            }`}
          >
            🇩🇿 العربية
          </button>
          <button
            type="button"
            onClick={() => onChangeLang('fr')}
            className={`px-3 py-1.5 rounded border font-label text-[11px] font-semibold cursor-pointer transition-colors ${
              lang === 'fr'
                ? 'border-[#93000B] bg-[#93000B] text-white'
                : 'border-[#E4BEB9] bg-white text-[#1B1B1E] hover:bg-[#F0EDF1]'
            }`}
          >
            🇫🇷 Français
          </button>
          <button
            type="button"
            onClick={() => onChangeLang('en')}
            className={`px-3 py-1.5 rounded border font-label text-[11px] font-semibold cursor-pointer transition-colors ${
              lang === 'en'
                ? 'border-[#93000B] bg-[#93000B] text-white'
                : 'border-[#E4BEB9] bg-white text-[#1B1B1E] hover:bg-[#F0EDF1]'
            }`}
          >
            🇬🇧 English
          </button>
        </div>

        <div className="w-full max-w-md bg-white border border-[#E4BEB9] rounded-xl p-8 my-6">
          <header className="mb-6">
            <h2 className="font-headline text-[28px] font-bold text-[#1B1B1E] mb-1">
              {t.loginTitle}
            </h2>
            <p className="text-[13px] text-[#5B403D]">{t.loginSub}</p>
          </header>

          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="p-3 rounded-lg bg-[#F6F2F7] border border-[#E4BEB9] flex items-center gap-2.5">
              <span className="material-symbols-outlined text-[20px] text-[#93000B]" aria-hidden="true">
                admin_panel_settings
              </span>
              <div>
                <span className="font-label text-[13px] font-semibold text-[#1B1B1E] block">
                  {t.roleManager}
                </span>
                <span className="text-[12px] text-[#5B403D]">{t.roleManagerDesc}</span>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[#F6F2F7] border border-[#E4BEB9] flex items-center gap-2.5">
              <span className="material-symbols-outlined text-[20px] text-[#1B1B1E]" aria-hidden="true">
                badge
              </span>
              <div>
                <span className="font-label text-[13px] font-semibold text-[#1B1B1E] block">
                  {t.roleEmployee}
                </span>
                <span className="text-[12px] text-[#5B403D]">{t.roleEmployeeDesc}</span>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="font-label text-[13px] font-semibold text-[#1B1B1E]">
                {t.passwordLabel}
              </span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••"
                autoComplete="current-password"
                className="w-full rounded border border-[#E4BEB9] bg-white px-3 py-3 font-mono text-[18px] tracking-widest text-[#1B1B1E] placeholder:text-[#8F6F6C] focus:border-[#93000B] focus:outline-none focus:ring-1 focus:ring-[#93000B]"
              />
              <span className="text-[12px] text-[#5B403D]">{t.passwordHint}</span>
            </label>

            {offlineReady ? (
              <div className="flex items-center gap-2 rounded bg-[#DCFCE7] px-3 py-2 text-[12px] font-medium text-[#14532D]">
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                  offline_pin
                </span>
                <span>{t.offlineLoginReady}</span>
              </div>
            ) : !isOnline ? (
              <div className="flex items-center gap-2 rounded bg-[#FEF3C7] px-3 py-2 text-[12px] font-medium text-[#92400E]">
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                  wifi_off
                </span>
                <span>{t.offlineFirstLoginHint}</span>
              </div>
            ) : null}

            {error && (
              <p className="text-[13px] font-semibold text-[#BA1A1A] bg-[#FFDAD6] px-3 py-2 rounded" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded bg-[#93000B] text-white hover:bg-[#B91C1C] transition-colors font-label text-[13px] font-semibold cursor-pointer disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                lock_open
              </span>
              <span>{t.loginBtn}</span>
            </button>
          </form>
        </div>

        <div className="w-full max-w-md flex flex-wrap items-center justify-between gap-2 text-[#5B403D]">
          <span className="text-[12px]">Blida · Algérie</span>
          <button
            type="button"
            onClick={onOpenCustomerPortal}
            className="text-[13px] font-semibold text-[#93000B] hover:underline cursor-pointer inline-flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">public</span>
            {t.openPublicSite}
          </button>
        </div>
      </main>
      <OfflineIndicator lang={lang} />
    </div>
  );
};
