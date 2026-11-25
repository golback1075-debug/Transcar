import type { SyncStatusMode } from '../types.ts';
import {
  appendLogToDb,
  clearAllOfflineDb,
  clearLogsInDb,
  deleteFileFromDb,
  getLastSyncAtFromDb,
  getLogsFromDb,
  getQueueFromDb,
  getTempIdMapFromDb,
  initOfflineDb,
  loadFileFromDb,
  loadSnapshotFromDb,
  saveFileToDb,
  saveSnapshotToDb,
  setLastSyncAtInDb,
  setQueueInDb,
  setTempIdMappingInDb,
  type OfflineFormFileField,
  type OfflineMutationItem,
  type OfflineSyncLogEntry,
} from './offlineDb.ts';

export type { OfflineMutationItem, OfflineSyncLogEntry };

export interface SyncStatusState {
  mode: SyncStatusMode;
  pendingCount: number;
  errorCount: number;
  lastSyncAt: string | null;
  queue: OfflineMutationItem[];
  logs: OfflineSyncLogEntry[];
}

let isFlushing = false;
let onSyncAuthExpired: (() => void) | null = null;
const stateListeners = new Set<(state: SyncStatusState) => void>();
const legacyQueueListeners = new Set<(count: number) => void>();

export function setOnSyncAuthExpired(cb: (() => void) | null) {
  onSyncAuthExpired = cb;
}

export function computeSyncStatus(): SyncStatusState {
  const queue = getQueueFromDb();
  const logs = getLogsFromDb();
  const pendingCount = queue.length;
  const errorCount = queue.filter((q) => q.status === 'error' || q.status === 'conflict').length;
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;

  let mode: SyncStatusMode = 'online';
  if (!online) {
    mode = 'offline';
  } else if (isFlushing) {
    mode = 'syncing';
  } else if (errorCount > 0) {
    mode = 'error';
  } else if (pendingCount > 0) {
    mode = 'syncing';
  }

  return {
    mode,
    pendingCount,
    errorCount,
    lastSyncAt: getLastSyncAtFromDb(),
    queue,
    logs,
  };
}

function notifyAll() {
  const state = computeSyncStatus();
  stateListeners.forEach((cb) => cb(state));
  legacyQueueListeners.forEach((cb) => cb(state.pendingCount));
}

export function subscribeSyncStatus(cb: (state: SyncStatusState) => void): () => void {
  stateListeners.add(cb);
  cb(computeSyncStatus());
  return () => {
    stateListeners.delete(cb);
  };
}

export function subscribeOfflineQueue(cb: (count: number) => void): () => void {
  legacyQueueListeners.add(cb);
  cb(getQueueFromDb().length);
  return () => {
    legacyQueueListeners.delete(cb);
  };
}

export function saveOfflineSnapshot(key: string, data: unknown) {
  saveSnapshotToDb(key, data);
}

export function loadOfflineSnapshot<T>(key: string): T | null {
  return loadSnapshotFromDb<T>(key);
}

export function clearOfflineData() {
  clearAllOfflineDb();
  notifyAll();
}

export function clearOfflineSyncLogs() {
  clearLogsInDb();
  notifyAll();
}

export function getOfflineQueue(): OfflineMutationItem[] {
  return getQueueFromDb();
}

export function getPendingOfflineCount(): number {
  return getQueueFromDb().length;
}

export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `tc-${crypto.randomUUID()}`;
  }
  return `tc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function enqueueOfflineMutation(
  url: string,
  method: string,
  body: string,
  opts: { idempotencyKey?: string; baseVersion?: number | null; tempId?: number | null } = {},
) {
  const queue = getQueueFromDb();
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    idempotencyKey: opts.idempotencyKey || generateIdempotencyKey(),
    url,
    method: method.toUpperCase(),
    bodyType: 'json',
    body,
    baseVersion: opts.baseVersion ?? null,
    tempId: opts.tempId ?? null,
    createdAt: new Date().toISOString(),
    status: 'pending',
    retryCount: 0,
  });
  setQueueInDb(queue);
  notifyAll();
}

export function enqueueOfflineFormMutation(
  url: string,
  method: string,
  formData: FormData,
  opts: { idempotencyKey?: string; baseVersion?: number | null; tempId?: number | null } = {},
): Record<string, string> {
  const formFields: Array<{ field: string; value: string }> = [];
  const fileFields: OfflineFormFileField[] = [];
  const fileUrlMap: Record<string, string> = {};
  const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  formData.forEach((val, key) => {
    if (typeof val !== 'string') {
      const fileObj = val as File;
      const fileKey = `offline-file://${batchId}-${key}`;
      const mimeType = fileObj.type || 'application/octet-stream';
      const fileName = fileObj.name || `${key}.bin`;
      saveFileToDb(fileKey, fileObj, mimeType, fileName);
      fileFields.push({ field: key, fileKey, fileName, mimeType });
      fileUrlMap[key] = fileKey;
    } else {
      formFields.push({ field: key, value: String(val) });
    }
  });

  const queue = getQueueFromDb();
  queue.push({
    id: batchId,
    idempotencyKey: opts.idempotencyKey || generateIdempotencyKey(),
    url,
    method: method.toUpperCase(),
    bodyType: 'formdata',
    formFields,
    fileFields,
    baseVersion: opts.baseVersion ?? null,
    tempId: opts.tempId ?? null,
    createdAt: new Date().toISOString(),
    status: 'pending',
    retryCount: 0,
  });
  setQueueInDb(queue);
  notifyAll();
  return fileUrlMap;
}

function resolveMappedUrl(url: string, tempMap: Record<string, number>): string {
  return url.replace(/\/(-\d+)(?=\/|$)/g, (full, negStr) => {
    const mapped = tempMap[negStr];
    return mapped ? `/${mapped}` : full;
  });
}

function resolveMappedIdValue(val: unknown, tempMap: Record<string, number>): unknown {
  if (typeof val === 'number' && val < 0) {
    return tempMap[String(val)] ?? val;
  }
  if (typeof val === 'string' && /^-\d+$/.test(val.trim())) {
    const mapped = tempMap[val.trim()];
    return mapped !== undefined ? String(mapped) : val;
  }
  return val;
}

function resolveMappedJsonBody(rawBody: string, tempMap: Record<string, number>): string {
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    for (const key of ['vehicleId', 'customerId', 'contractId', 'reservationId']) {
      if (key in parsed) {
        parsed[key] = resolveMappedIdValue(parsed[key], tempMap);
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return rawBody;
  }
}

function extractCreatedServerId(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  for (const key of ['vehicle', 'customer', 'document', 'reservation', 'contract', 'returnRecord', 'record', 'transaction']) {
    const nested = obj[key] as Record<string, unknown> | undefined;
    if (nested && typeof nested.id === 'number' && nested.id > 0) {
      return nested.id;
    }
  }
  return null;
}

async function sendQueueItem(
  item: OfflineMutationItem,
  token: string,
  tempMap: Record<string, number>,
): Promise<Response> {
  const resolvedUrl = resolveMappedUrl(item.url, tempMap);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'X-Idempotency-Key': item.idempotencyKey,
  };

  if (item.bodyType === 'formdata') {
    const fd = new FormData();
    for (const f of item.formFields || []) {
      const val =
        ['vehicleId', 'customerId', 'contractId', 'reservationId', 'replaceDocId'].includes(f.field)
          ? String(resolveMappedIdValue(f.value, tempMap))
          : f.value;
      fd.append(f.field, val);
    }
    for (const ff of item.fileFields || []) {
      const stored = loadFileFromDb(ff.fileKey);
      if (stored) {
        fd.append(ff.field, stored.blob, ff.fileName);
      }
    }
    return fetch(resolvedUrl, {
      method: item.method,
      headers,
      body: fd,
    });
  }

  headers['Content-Type'] = 'application/json';
  const body = item.body ? resolveMappedJsonBody(item.body, tempMap) : undefined;
  return fetch(resolvedUrl, {
    method: item.method,
    headers,
    body,
  });
}

export async function flushOfflineQueue(token: string | null): Promise<number> {
  await initOfflineDb();
  if (!navigator.onLine || !token || isFlushing) return 0;
  const queue = getQueueFromDb();
  if (queue.length === 0) return 0;

  isFlushing = true;
  notifyAll();

  let synced = 0;
  const updatedQueue: OfflineMutationItem[] = [];
  const tempMap = getTempIdMapFromDb();
  let abortedOnNetwork = false;

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (abortedOnNetwork) {
      updatedQueue.push(item);
      continue;
    }
    // Skip items marked as conflict unless retried manually
    if (item.status === 'conflict') {
      updatedQueue.push(item);
      continue;
    }

    try {
      const res = await sendQueueItem(item, token, tempMap);
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;

      if (res.ok) {
        synced++;
        if (item.tempId && item.tempId < 0) {
          const serverId = extractCreatedServerId(data);
          if (serverId) {
            tempMap[String(item.tempId)] = serverId;
            setTempIdMappingInDb(item.tempId, serverId);
          }
        }
        // Clean up temporary queued blobs once uploaded
        for (const ff of item.fileFields || []) {
          deleteFileFromDb(ff.fileKey);
        }
        appendLogToDb({
          id: `${Date.now()}-${item.id}`,
          timestamp: new Date().toISOString(),
          method: item.method,
          url: item.url,
          status: 'success',
          message: 'Synchronisé avec le serveur',
        });
      } else if (res.status === 401) {
        abortedOnNetwork = true;
        updatedQueue.push(item);
        if (onSyncAuthExpired) {
          onSyncAuthExpired();
        }
      } else if (res.status === 409 || (res.status >= 400 && res.status < 500)) {
        const msg =
          (data && typeof data.error === 'string' && data.error) || `Erreur HTTP ${res.status}`;
        const status: 'conflict' | 'error' = res.status === 409 ? 'conflict' : 'error';
        updatedQueue.push({
          ...item,
          status,
          errorMessage: msg,
          retryCount: item.retryCount + 1,
        });
        appendLogToDb({
          id: `${Date.now()}-${item.id}`,
          timestamp: new Date().toISOString(),
          method: item.method,
          url: item.url,
          status,
          message: msg,
        });
      } else {
        abortedOnNetwork = true;
        updatedQueue.push({
          ...item,
          status: 'error',
          errorMessage: `Erreur serveur (${res.status})`,
          retryCount: item.retryCount + 1,
        });
      }
    } catch {
      abortedOnNetwork = true;
      updatedQueue.push(item);
    }
  }

  setQueueInDb(updatedQueue);
  if (synced > 0) {
    setLastSyncAtInDb(new Date().toISOString());
  }
  isFlushing = false;
  notifyAll();
  return synced;
}

export async function retryQueueItem(id: string, token: string | null): Promise<number> {
  const queue = getQueueFromDb().map((it) =>
    it.id === id ? { ...it, status: 'pending' as const, errorMessage: undefined } : it,
  );
  setQueueInDb(queue);
  notifyAll();
  return flushOfflineQueue(token);
}

export async function retryAllQueueErrors(token: string | null): Promise<number> {
  const queue = getQueueFromDb().map((it) => ({
    ...it,
    status: 'pending' as const,
    errorMessage: undefined,
  }));
  setQueueInDb(queue);
  notifyAll();
  return flushOfflineQueue(token);
}

export function dismissQueueItem(id: string): void {
  const queue = getQueueFromDb();
  const target = queue.find((it) => it.id === id);
  if (target?.fileFields) {
    for (const ff of target.fileFields) {
      deleteFileFromDb(ff.fileKey);
    }
  }
  setQueueInDb(queue.filter((it) => it.id !== id));
  notifyAll();
}
