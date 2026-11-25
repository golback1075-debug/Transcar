import { useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface PWAInstallState {
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  isWindows: boolean;
  browserEngine: 'edge' | 'chrome' | 'other';
}

let captureInitialized = false;
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let installedFlag = false;
const installListeners = new Set<() => void>();

function detectEnvironment(): Omit<PWAInstallState, 'isInstallable' | 'isInstalled'> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { isIOS: false, isWindows: false, browserEngine: 'other' };
  }
  const ua = navigator.userAgent || '';
  const uaLower = ua.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(uaLower);
  const isWindows = /windows/i.test(ua);
  const browserEngine: 'edge' | 'chrome' | 'other' = /edg\//i.test(ua)
    ? 'edge'
    : /chrome|crios/i.test(ua) && !/edg\//i.test(ua)
      ? 'chrome'
      : 'other';
  return { isIOS, isWindows, browserEngine };
}

function detectStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function notifyInstallListeners() {
  installListeners.forEach((cb) => cb());
}

export function initPWAInstallCapture(): void {
  if (typeof window === 'undefined' || captureInitialized) return;
  captureInitialized = true;
  installedFlag = detectStandaloneMode();

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredInstallPrompt = e as BeforeInstallPromptEvent;
    notifyInstallListeners();
  });

  window.addEventListener('appinstalled', () => {
    installedFlag = true;
    deferredInstallPrompt = null;
    notifyInstallListeners();
  });

  try {
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener?.('change', (ev) => {
      if (ev.matches) {
        installedFlag = true;
        deferredInstallPrompt = null;
        notifyInstallListeners();
      }
    });
  } catch {
    // ignore older mediaQuery listeners
  }
}

export async function triggerNativePWAInstall(): Promise<boolean> {
  if (!deferredInstallPrompt) return false;
  await deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') {
    installedFlag = true;
    deferredInstallPrompt = null;
    notifyInstallListeners();
    return true;
  }
  return false;
}

export function usePWAInstall() {
  const [, setTick] = useState(0);

  useEffect(() => {
    initPWAInstallCapture();
    const onChange = () => setTick((v) => v + 1);
    installListeners.add(onChange);
    onChange();
    return () => {
      installListeners.delete(onChange);
    };
  }, []);

  const env = detectEnvironment();
  const isInstalled = installedFlag || detectStandaloneMode();

  return {
    isInstallable: Boolean(deferredInstallPrompt),
    isInstalled,
    isIOS: env.isIOS,
    isWindows: env.isWindows,
    browserEngine: env.browserEngine,
    install: triggerNativePWAInstall,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
