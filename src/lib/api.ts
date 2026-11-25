import { initOfflineDb, loadFileFromDb, saveFileToDb } from './offlineDb.ts';
import { applyOfflineMutation, nextTempId } from './offlineStore.ts';
import {
  enqueueOfflineFormMutation,
  enqueueOfflineMutation,
  generateIdempotencyKey,
  loadOfflineSnapshot,
  saveOfflineSnapshot,
} from './offlineSync.ts';

export const OFFLINE_TOKEN_MARKER = '__TRANSCAR_OFFLINE_SESSION__';

// In-memory session token and optional ephemeral offline unlock code only
// (never persisted in localStorage per security guidelines)
let inMemoryToken: string | null = null;
let inMemoryOfflineCode: string | null = null;
let onAuthExpiredCallback: (() => void) | null = null;

export function setOnAuthExpired(cb: (() => void) | null) {
  onAuthExpiredCallback = cb;
}

export function setAuthToken(token: string | null) {
  inMemoryToken = token;
  if (token !== OFFLINE_TOKEN_MARKER) {
    inMemoryOfflineCode = null;
  }
}

export function getAuthToken(): string | null {
  return inMemoryToken;
}

export function isOfflineToken(): boolean {
  return inMemoryToken === OFFLINE_TOKEN_MARKER;
}

export function setOfflineAuthSecret(code: string | null) {
  inMemoryOfflineCode = code;
}

export async function upgradeOfflineSession(): Promise<boolean> {
  if (inMemoryToken !== OFFLINE_TOKEN_MARKER || !inMemoryOfflineCode || !navigator.onLine) {
    return false;
  }
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: inMemoryOfflineCode }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { token?: string };
    if (data?.token) {
      inMemoryToken = data.token;
      inMemoryOfflineCode = null;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isQueueableOfflineMutation(url: string, options: RequestInit): boolean {
  const method = (options.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'DELETE'].includes(method)) return false;
  if (
    url.startsWith('/api/auth/') ||
    url.startsWith('/api/backups') ||
    url.startsWith('/api/notifications/run-checks')
  ) {
    return false;
  }
  return true;
}

function isCreateEndpoint(url: string, method: string): boolean {
  if (method !== 'POST') return false;
  const clean = url.split('?')[0];
  return (
    clean === '/api/vehicles' ||
    clean === '/api/customers' ||
    clean === '/api/reservations' ||
    clean === '/api/contracts' ||
    clean === '/api/returns' ||
    clean === '/api/maintenance' ||
    clean === '/api/finance/transactions' ||
    clean === '/api/finance/withdrawals' ||
    /^\/api\/vehicles\/-?\d+\/documents$/.test(clean)
  );
}

function extractFormPayload(fd: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  fd.forEach((v, k) => {
    if (typeof v === 'string') {
      obj[k] = v;
    }
  });
  return obj;
}

async function handleOfflineMutation<T>(url: string, options: RequestInit, idempotencyKey: string): Promise<T> {
  const method = (options.method || 'POST').toUpperCase();
  const tempId = isCreateEndpoint(url, method) ? nextTempId() : null;

  if (options.body instanceof FormData) {
    const payload = extractFormPayload(options.body);
    const fileUrlMap = enqueueOfflineFormMutation(url, method, options.body, {
      idempotencyKey,
      tempId,
    });
    const localRes = applyOfflineMutation(url, method, payload, {
      tempId: tempId ?? undefined,
      fileUrlMap,
    });
    return localRes as T;
  }

  let parsedBody: Record<string, unknown> = {};
  if (typeof options.body === 'string' && options.body.trim()) {
    try {
      parsedBody = JSON.parse(options.body) as Record<string, unknown>;
    } catch {
      parsedBody = {};
    }
  }
  const baseVersion =
    typeof parsedBody.version === 'number' ? parsedBody.version : null;

  // Apply optimistically first (so business/conflict checks like active contract delete throw immediately)
  const localRes = applyOfflineMutation(url, method, parsedBody, {
    tempId: tempId ?? undefined,
  });

  enqueueOfflineMutation(url, method, typeof options.body === 'string' ? options.body : '{}', {
    idempotencyKey,
    baseVersion,
    tempId,
  });
  return localRes as T;
}

// Background-cache file assets referenced in API responses for full offline viewing
function backgroundCacheAssetUrls(url: string, data: unknown) {
  if (!navigator.onLine || !inMemoryToken || inMemoryToken === OFFLINE_TOKEN_MARKER) return;
  if (!data || typeof data !== 'object') return;
  const obj = data as Record<string, unknown>;
  const urlsToCache: string[] = [];

  if (url.startsWith('/api/vehicles') && Array.isArray(obj.vehicles)) {
    for (const v of obj.vehicles as Array<{ photoUrl?: string }>) {
      if (v.photoUrl && v.photoUrl.startsWith('/api/files/')) urlsToCache.push(v.photoUrl);
    }
  }
  if (url.includes('/documents') && Array.isArray(obj.documents)) {
    for (const d of obj.documents as Array<{ fileUrl?: string }>) {
      if (d.fileUrl && d.fileUrl.startsWith('/api/files/')) urlsToCache.push(d.fileUrl);
    }
  }
  if (url.startsWith('/api/customers') && Array.isArray(obj.customers)) {
    for (const c of obj.customers as Array<{ licenceFrontUrl?: string | null; licenceBackUrl?: string | null }>) {
      if (c.licenceFrontUrl && c.licenceFrontUrl.startsWith('/api/files/')) urlsToCache.push(c.licenceFrontUrl);
      if (c.licenceBackUrl && c.licenceBackUrl.startsWith('/api/files/')) urlsToCache.push(c.licenceBackUrl);
    }
  }

  // Limit per-fetch caching work asynchronously
  const unique = Array.from(new Set(urlsToCache)).slice(0, 20);
  void Promise.allSettled(
    unique.map(async (assetPath) => {
      if (loadFileFromDb(assetPath)) return;
      const res = await fetch(authorizedFileUrl(assetPath));
      if (!res.ok) return;
      const blob = await res.blob();
      saveFileToDb(assetPath, blob, blob.type || 'application/octet-stream', assetPath.split('/').pop() || 'file');
    }),
  );
}

function getOfflineDefaultFallback<T>(url: string): T {
  const clean = url.split('?')[0];
  if (clean === '/api/vehicles') return { vehicles: [] } as unknown as T;
  if (clean === '/api/customers') return { customers: [] } as unknown as T;
  if (clean === '/api/contracts') return { contracts: [], nextContractNumber: 'TRANSCAR-0001' } as unknown as T;
  if (clean === '/api/reservations') return { reservations: [] } as unknown as T;
  if (clean === '/api/maintenance') return { records: [], alerts: [] } as unknown as T;
  if (clean === '/api/finance/transactions') return {
    summary: { cashBalance: 0, totalIncome: 0, totalDepositsHeld: 0, totalExpenses: 0, totalRefunds: 0, totalWithdrawals: 0, netProfit: 0, dailyTotal: 0, monthlyTotal: 0 },
    transactions: [],
    withdrawals: [],
  } as unknown as T;
  if (clean === '/api/notifications') return { notifications: [], unreadCount: 0 } as unknown as T;
  if (clean === '/api/conditions') return { versions: [] } as unknown as T;
  if (clean === '/api/dashboard') return { stats: {}, financeSummary: {}, recentContracts: [] } as unknown as T;
  if (/^\/api\/vehicles\/-?\d+\/documents$/.test(clean)) return { documents: [] } as unknown as T;
  return {} as unknown as T;
}

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  await initOfflineDb();
  const method = (options.method || 'GET').toUpperCase();

  // While running in an offline-unlocked session (or navigator.onLine === false),
  // read IndexedDB cached snapshots and apply/queue operational writes locally.
  if (
    (inMemoryToken === OFFLINE_TOKEN_MARKER || !navigator.onLine) &&
    url.startsWith('/api/') &&
    !url.startsWith('/api/auth/')
  ) {
    if (method === 'GET') {
      const cached = loadOfflineSnapshot<T>(url);
      if (cached !== null) {
        return cached;
      }
      return getOfflineDefaultFallback<T>(url);
    }
    if (isQueueableOfflineMutation(url, options)) {
      const idempotencyKey = generateIdempotencyKey();
      return handleOfflineMutation<T>(url, options, idempotencyKey);
    }
    throw new Error('Connexion Internet requise pour cette opération.');
  }

  const headers = new Headers(options.headers || {});
  if (inMemoryToken && inMemoryToken !== OFFLINE_TOKEN_MARKER && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${inMemoryToken}`);
  }
  if (!(options.body instanceof FormData) && options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let idempotencyKey = headers.get('X-Idempotency-Key') || '';
  if (method !== 'GET' && !idempotencyKey && isQueueableOfflineMutation(url, options)) {
    idempotencyKey = generateIdempotencyKey();
    headers.set('X-Idempotency-Key', idempotencyKey);
  }

  try {
    const res = await fetch(url, { ...options, headers });
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await res.json().catch(() => null)
      : null;

    if (!res.ok) {
      if (res.status === 401 && !url.startsWith('/api/auth/')) {
        onAuthExpiredCallback?.();
      }
      let errMsg = data && typeof data.error === 'string' && data.error ? data.error : '';
      if (!errMsg && !contentType.includes('application/json')) {
        const textBody = await res.text().catch(() => '');
        if (textBody && textBody.length < 220 && !textBody.trim().startsWith('<')) {
          errMsg = textBody.trim();
        }
      }
      throw new Error(errMsg || `Erreur HTTP ${res.status}`);
    }

    if (method === 'GET' && data) {
      saveOfflineSnapshot(url, data);
      backgroundCacheAssetUrls(url, data);
    }
    return data as T;
  } catch (err) {
    const isNetworkErr =
      !navigator.onLine ||
      err instanceof TypeError ||
      (err instanceof Error && err.message === 'Failed to fetch');

    if (isNetworkErr && method === 'GET') {
      const cached = loadOfflineSnapshot<T>(url);
      if (cached !== null) {
        return cached;
      }
      return getOfflineDefaultFallback<T>(url);
    }

    if (isNetworkErr && isQueueableOfflineMutation(url, options)) {
      return handleOfflineMutation<T>(url, options, idempotencyKey || generateIdempotencyKey());
    }

    throw err;
  }
}

const objectUrlCache = new Map<string, string>();

export function authorizedFileUrl(path: string | null | undefined): string {
  if (!path) return '';
  if (path.startsWith('offline-file://') || path.startsWith('blob:') || path.startsWith('data:')) {
    const stored = loadFileFromDb(path);
    if (stored) {
      const cacheKey = `${stored.key}:${stored.updatedAt}`;
      let objUrl = objectUrlCache.get(cacheKey);
      if (!objUrl) {
        objUrl = URL.createObjectURL(stored.blob);
        objectUrlCache.set(cacheKey, objUrl);
      }
      return objUrl;
    }
    return path;
  }
  if (!navigator.onLine || inMemoryToken === OFFLINE_TOKEN_MARKER) {
    const stored = loadFileFromDb(path);
    if (stored) {
      const cacheKey = `${stored.key}:${stored.updatedAt}`;
      let objUrl = objectUrlCache.get(cacheKey);
      if (!objUrl) {
        objUrl = URL.createObjectURL(stored.blob);
        objectUrlCache.set(cacheKey, objUrl);
      }
      return objUrl;
    }
  }
  if (!inMemoryToken || inMemoryToken === OFFLINE_TOKEN_MARKER) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}token=${encodeURIComponent(inMemoryToken)}`;
}

export function formatDzd(amount: number | null | undefined): string {
  const num = Number(amount || 0);
  return `${num.toLocaleString('fr-FR')} DZD`;
}

export function formatKm(km: number | null | undefined): string {
  const num = Number(km || 0);
  return `${num.toLocaleString('fr-FR')} km`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('fr-FR');
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      notify: (title: string, body: string) => void;
      printToPdf: (filename: string) => Promise<{ ok: boolean; filePath?: string }>;
      printCurrent: () => void;
    };
  }
}

import { applySinglePagePrintFit, clearSinglePagePrintFit, triggerOnePagePrint } from './printFit.ts';

export async function triggerPdfPrint(suggestedFilename: string) {
  if (window.electronAPI?.printToPdf) {
    applySinglePagePrintFit();
    try {
      await window.electronAPI.printToPdf(suggestedFilename);
    } finally {
      clearSinglePagePrintFit();
    }
  } else {
    triggerOnePagePrint();
  }
}
