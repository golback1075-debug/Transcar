import { registerSW } from 'virtual:pwa-register';
import { ensureSafeStorageMigration, getOfflineStorageSummary } from './offlineDb.ts';
import { computeSyncStatus } from './offlineSync.ts';

export type PwaUpdateStatus =
  | 'up-to-date'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'offline'
  | 'updating'
  | 'error';

export interface LocalizedReleaseNotes {
  fr: string[];
  ar: string[];
  en: string[];
}

export interface RemoteVersionManifest {
  version: string;
  buildDate?: string;
  minSupportedVersion?: string;
  releaseNotes?: Partial<LocalizedReleaseNotes>;
}

export interface PwaUpdateState {
  currentVersion: string;
  latestVersion: string;
  lastCheckedAt: string | null;
  lastUpdatedAt: string | null;
  status: PwaUpdateStatus;
  updateReady: boolean;
  offlineReady: boolean;
  dismissedForSession: boolean;
  hasWaitingWorker: boolean;
  hasNewerRemoteVersion: boolean;
  pendingOfflineChangesCount: number;
  releaseNotes: LocalizedReleaseNotes;
  errorMessage: string | null;
}

interface StoredUpdateMeta {
  lastInstalledVersion: string;
  lastCheckedAt: string | null;
  lastUpdatedAt: string | null;
  lastKnownRemoteVersion: string | null;
  lastReleaseNotes: LocalizedReleaseNotes | null;
  pendingUpdate: {
    targetVersion: string;
    startedAt: string;
    viaSw: boolean;
  } | null;
}

const META_STORAGE_KEY = 'transcar_pwa_update_meta_v1';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const VISIBILITY_THROTTLE_MS = 60 * 1000;

export const CURRENT_APP_VERSION =
  import.meta.env?.VITE_APP_VERSION || '1.0.7';

const DEFAULT_NOTES: LocalizedReleaseNotes = {
  fr: [],
  ar: [],
  en: [],
};

export function compareSemver(a: string, b: string): number {
  const pa = String(a || '0.0.0')
    .replace(/^v/i, '')
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b || '0.0.0')
    .replace(/^v/i, '')
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

function normalizeReleaseNotes(raw?: Partial<LocalizedReleaseNotes> | null): LocalizedReleaseNotes {
  return {
    fr: Array.isArray(raw?.fr) ? raw.fr.filter((x) => typeof x === 'string') : [],
    ar: Array.isArray(raw?.ar) ? raw.ar.filter((x) => typeof x === 'string') : [],
    en: Array.isArray(raw?.en) ? raw.en.filter((x) => typeof x === 'string') : [],
  };
}

function readStoredMeta(): StoredUpdateMeta {
  try {
    const raw = localStorage.getItem(META_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredUpdateMeta>;
      return {
        lastInstalledVersion: parsed.lastInstalledVersion || CURRENT_APP_VERSION,
        lastCheckedAt: parsed.lastCheckedAt || null,
        lastUpdatedAt: parsed.lastUpdatedAt || null,
        lastKnownRemoteVersion: parsed.lastKnownRemoteVersion || null,
        lastReleaseNotes: parsed.lastReleaseNotes
          ? normalizeReleaseNotes(parsed.lastReleaseNotes)
          : null,
        pendingUpdate: parsed.pendingUpdate || null,
      };
    }
  } catch {
    // ignore corrupted local metadata
  }
  return {
    lastInstalledVersion: CURRENT_APP_VERSION,
    lastCheckedAt: null,
    lastUpdatedAt: null,
    lastKnownRemoteVersion: null,
    lastReleaseNotes: null,
    pendingUpdate: null,
  };
}

function writeStoredMeta(meta: StoredUpdateMeta): void {
  try {
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // ignore storage quota errors
  }
}

let initialized = false;
let updateSwFn: ((reloadPage?: boolean) => Promise<void>) | null = null;
let swRegistration: ServiceWorkerRegistration | undefined;
let swNeedRefresh = false;
let inFlightCheck: Promise<PwaUpdateState> | null = null;
let lastVisibilityCheckTs = 0;
let periodicTimer: number | null = null;
let domDirtyFlag = false;

const listeners = new Set<(state: PwaUpdateState) => void>();

function bindDirtyActivityTracking(): void {
  if (typeof document === 'undefined') return;
  const markDirtyIfForm = (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (
      target.closest('form') &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
    ) {
      domDirtyFlag = true;
    }
  };
  const clearDirtyOnSubmit = () => {
    domDirtyFlag = false;
  };
  document.addEventListener('input', markDirtyIfForm, true);
  document.addEventListener('submit', clearDirtyOnSubmit, true);
}

export function hasActiveUserOperation(): boolean {
  if (computeSyncStatus().mode === 'syncing') return true;
  if (typeof document === 'undefined') return false;
  if (document.querySelector('[role="dialog"]')) return true;
  if (domDirtyFlag) {
    const active = document.activeElement as HTMLElement | null;
    if (
      active &&
      active.closest('form') &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')
    ) {
      return true;
    }
    const dirtyInputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'form input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="date"]):not([type="number"]), form textarea',
    );
    for (const el of dirtyInputs) {
      if (el.value && el.value.trim().length > 0 && el.defaultValue !== el.value) {
        return true;
      }
    }
  }
  return false;
}

function buildInitialState(): PwaUpdateState {
  const meta = readStoredMeta();
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  return {
    currentVersion: CURRENT_APP_VERSION,
    latestVersion: meta.lastKnownRemoteVersion || CURRENT_APP_VERSION,
    lastCheckedAt: meta.lastCheckedAt,
    lastUpdatedAt: meta.lastUpdatedAt,
    status: online ? 'up-to-date' : 'offline',
    updateReady: false,
    offlineReady: false,
    dismissedForSession: false,
    hasWaitingWorker: false,
    hasNewerRemoteVersion:
      Boolean(meta.lastKnownRemoteVersion) &&
      compareSemver(meta.lastKnownRemoteVersion!, CURRENT_APP_VERSION) > 0,
    pendingOfflineChangesCount: computeSyncStatus().pendingCount,
    releaseNotes: meta.lastReleaseNotes || DEFAULT_NOTES,
    errorMessage: null,
  };
}

let currentState: PwaUpdateState = buildInitialState();

function emitState(patch?: Partial<PwaUpdateState>) {
  currentState = {
    ...currentState,
    ...patch,
    pendingOfflineChangesCount: computeSyncStatus().pendingCount,
  };
  listeners.forEach((cb) => cb(currentState));
}

export function getPwaUpdateState(): PwaUpdateState {
  return {
    ...currentState,
    pendingOfflineChangesCount: computeSyncStatus().pendingCount,
  };
}

export function subscribePwaUpdate(listener: (state: PwaUpdateState) => void): () => void {
  listeners.add(listener);
  listener(getPwaUpdateState());
  return () => {
    listeners.delete(listener);
  };
}

async function fetchRemoteVersionManifest(): Promise<RemoteVersionManifest | null> {
  const endpoints = [`/version.json?t=${Date.now()}`, `/api/version?t=${Date.now()}`];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
      });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) continue;
      const data = (await res.json()) as RemoteVersionManifest;
      if (data && typeof data.version === 'string' && data.version.trim()) {
        return {
          version: data.version.trim(),
          buildDate: data.buildDate,
          minSupportedVersion: data.minSupportedVersion,
          releaseNotes: normalizeReleaseNotes(data.releaseNotes),
        };
      }
    } catch {
      // try next endpoint
    }
  }
  return null;
}

async function cleanupMismatchedServiceWorkers(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const isDev = Boolean(import.meta.env?.DEV);
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      regs.map(async (reg) => {
        const scriptUrl =
          reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || '';
        if (isDev && scriptUrl.endsWith('/sw.js')) {
          await reg.unregister();
        } else if (!isDev && scriptUrl.includes('/dev-sw.js')) {
          await reg.unregister();
        }
      }),
    );
  } catch {
    // ignore unsupported SW environments
  }
}

export async function purgeObsoleteCachesSafe(): Promise<number> {
  // Clears stale HTTP/Workbox Cache Storage ONLY when updating online;
  // NEVER touches IndexedDB (transcar_offline_db_v1) or localStorage!
  if (typeof caches === 'undefined') return 0;
  try {
    const keys = await caches.keys();
    let deleted = 0;
    await Promise.all(
      keys.map(async (key) => {
        if (
          key.startsWith('transcar-html-nav') ||
          key.startsWith('workbox-precache') ||
          key.startsWith('vite-dev')
        ) {
          const ok = await caches.delete(key);
          if (ok) deleted++;
        }
      }),
    );
    return deleted;
  } catch {
    return 0;
  }
}

function waitForInstallingWorker(reg: ServiceWorkerRegistration): Promise<boolean> {
  const installing = reg.installing;
  if (!installing) return Promise.resolve(Boolean(reg.waiting));
  emitState({ status: 'downloading' });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (hasWaiting: boolean) => {
      if (settled) return;
      settled = true;
      resolve(hasWaiting);
    };
    const timer = window.setTimeout(() => finish(Boolean(reg.waiting)), 8000);
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed') {
        window.clearTimeout(timer);
        finish(Boolean(reg.waiting || navigator.serviceWorker?.controller));
      } else if (installing.state === 'redundant') {
        window.clearTimeout(timer);
        finish(Boolean(reg.waiting));
      }
    });
  });
}

function wireRegistrationListeners(reg: ServiceWorkerRegistration) {
  swRegistration = reg;
  if (reg.waiting) {
    swNeedRefresh = true;
    emitState({
      status: 'ready',
      updateReady: true,
      hasWaitingWorker: true,
    });
  }

  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    if (!worker) return;
    if (navigator.serviceWorker?.controller) {
      emitState({ status: 'downloading' });
    }
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker?.controller) {
        swNeedRefresh = true;
        emitState({
          status: 'ready',
          updateReady: true,
          hasWaitingWorker: true,
          dismissedForSession: false,
        });
      }
    });
  });
}

export async function checkForUpdates(opts: { silent?: boolean } = {}): Promise<PwaUpdateState> {
  if (inFlightCheck) return inFlightCheck;

  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  if (!online) {
    emitState({
      status: 'offline',
      errorMessage: null,
    });
    return getPwaUpdateState();
  }

  inFlightCheck = (async () => {
    emitState({
      status: 'checking',
      errorMessage: null,
      ...(opts.silent ? {} : { dismissedForSession: false }),
    });

    try {
      const [manifest] = await Promise.all([
        fetchRemoteVersionManifest(),
        swRegistration ? swRegistration.update().catch(() => undefined) : Promise.resolve(),
      ]);

      let hasWaiting = Boolean(swRegistration?.waiting) || swNeedRefresh;
      if (!hasWaiting && swRegistration?.installing) {
        hasWaiting = await waitForInstallingWorker(swRegistration);
      }

      if (hasWaiting) {
        swNeedRefresh = true;
      }

      const nowIso = new Date().toISOString();
      const meta = readStoredMeta();
      const remoteVersion = manifest?.version || meta.lastKnownRemoteVersion || CURRENT_APP_VERSION;
      const notes = manifest?.releaseNotes
        ? normalizeReleaseNotes(manifest.releaseNotes)
        : meta.lastReleaseNotes || DEFAULT_NOTES;
      const newerRemote = compareSemver(remoteVersion, CURRENT_APP_VERSION) > 0;
      const isReady = hasWaiting || newerRemote;

      writeStoredMeta({
        ...meta,
        lastCheckedAt: nowIso,
        lastKnownRemoteVersion: remoteVersion,
        lastReleaseNotes: notes,
      });

      emitState({
        latestVersion: remoteVersion,
        lastCheckedAt: nowIso,
        releaseNotes: notes,
        hasWaitingWorker: hasWaiting,
        hasNewerRemoteVersion: newerRemote,
        updateReady: isReady,
        status: isReady ? 'ready' : 'up-to-date',
        ...(isReady && !opts.silent ? { dismissedForSession: false } : {}),
        errorMessage: null,
      });
    } catch (err) {
      const stillOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
      emitState({
        status: stillOnline ? 'error' : 'offline',
        errorMessage: stillOnline
          ? err instanceof Error
            ? err.message
            : 'Update check failed'
          : null,
      });
    } finally {
      inFlightCheck = null;
    }

    return getPwaUpdateState();
  })();

  return inFlightCheck;
}

export async function applyUpdateNow(opts: {
  forceWithUnsavedWork?: boolean;
} = {}): Promise<{ ok: boolean; reason?: 'offline' | 'unsaved-work' | 'error' }> {
  const hasWaiting = Boolean(swRegistration?.waiting) || swNeedRefresh;
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;

  if (!online && !hasWaiting) {
    emitState({ status: 'offline' });
    return { ok: false, reason: 'offline' };
  }

  if (!opts.forceWithUnsavedWork && hasActiveUserOperation()) {
    return { ok: false, reason: 'unsaved-work' };
  }

  // Verify local IndexedDB & queue before reload — never delete IndexedDB or localStorage
  getOfflineStorageSummary();

  const meta = readStoredMeta();
  writeStoredMeta({
    ...meta,
    pendingUpdate: {
      targetVersion: currentState.latestVersion || CURRENT_APP_VERSION,
      startedAt: new Date().toISOString(),
      viaSw: hasWaiting,
    },
  });

  emitState({ status: 'updating', errorMessage: null });

  try {
    if (online) {
      // Clear stale navigation/HTML cache buckets while preserving IndexedDB & localStorage
      await purgeObsoleteCachesSafe();
    }

    if (updateSwFn && hasWaiting) {
      await updateSwFn(true);
      window.setTimeout(() => {
        window.location.reload();
      }, 2500);
      return { ok: true };
    }

    if (swRegistration?.waiting) {
      let reloaded = false;
      const onControllerChange = () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      };
      navigator.serviceWorker?.addEventListener('controllerchange', onControllerChange, {
        once: true,
      });
      swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      window.setTimeout(onControllerChange, 2200);
      return { ok: true };
    }

    if (swRegistration) {
      await swRegistration.update().catch(() => undefined);
    }

    window.location.reload();
    return { ok: true };
  } catch (err) {
    emitState({
      status: 'error',
      errorMessage: err instanceof Error ? err.message : 'Failed to activate update',
    });
    return { ok: false, reason: 'error' };
  }
}

export function postponeUpdate(): void {
  emitState({ dismissedForSession: true });
}

export function initPwaUpdater(): void {
  if (initialized) return;
  initialized = true;

  bindDirtyActivityTracking();
  void ensureSafeStorageMigration(CURRENT_APP_VERSION);
  void cleanupMismatchedServiceWorkers();

  // Confirm genuine update completion only after reload runs active version
  const meta = readStoredMeta();
  const versionChanged = meta.lastInstalledVersion !== CURRENT_APP_VERSION;
  const pending = meta.pendingUpdate;
  let confirmedUpdateIso = meta.lastUpdatedAt;

  if (versionChanged) {
    confirmedUpdateIso = new Date().toISOString();
  } else if (pending) {
    const versionMatchesTarget =
      compareSemver(CURRENT_APP_VERSION, pending.targetVersion) >= 0;
    const recentSwActivation =
      pending.viaSw && Date.now() - Date.parse(pending.startedAt) < 120_000;
    if (
      versionMatchesTarget &&
      (compareSemver(pending.targetVersion, meta.lastInstalledVersion) > 0 || recentSwActivation)
    ) {
      confirmedUpdateIso = new Date().toISOString();
    }
  }

  writeStoredMeta({
    ...meta,
    lastInstalledVersion: CURRENT_APP_VERSION,
    lastUpdatedAt: confirmedUpdateIso,
    pendingUpdate: null,
  });

  emitState({
    currentVersion: CURRENT_APP_VERSION,
    lastUpdatedAt: confirmedUpdateIso,
    lastCheckedAt: meta.lastCheckedAt,
  });

  try {
    updateSwFn = registerSW({
      immediate: true,
      onNeedRefresh() {
        swNeedRefresh = true;
        emitState({
          status: 'ready',
          updateReady: true,
          hasWaitingWorker: true,
          dismissedForSession: false,
        });
      },
      onOfflineReady() {
        emitState({ offlineReady: true });
      },
      onRegisteredSW(_swUrl, registration) {
        if (registration) {
          wireRegistrationListeners(registration);
        }
        if (navigator.onLine) {
          void checkForUpdates({ silent: true });
        }
      },
      onRegisterError(error) {
        if (navigator.onLine) {
          emitState({
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      },
    });
  } catch {
    if (navigator.onLine) {
      void checkForUpdates({ silent: true });
    }
  }

  window.addEventListener('online', () => {
    void checkForUpdates({ silent: true });
  });

  window.addEventListener('offline', () => {
    emitState({ status: 'offline' });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    const now = Date.now();
    if (now - lastVisibilityCheckTs > VISIBILITY_THROTTLE_MS) {
      lastVisibilityCheckTs = now;
      void checkForUpdates({ silent: true });
    }
  });

  periodicTimer = window.setInterval(() => {
    if (navigator.onLine) {
      void checkForUpdates({ silent: true });
    }
  }, CHECK_INTERVAL_MS);
  void periodicTimer;
}
