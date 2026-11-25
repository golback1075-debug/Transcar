// Persistent IndexedDB engine + synchronous in-memory mirror for TRANSCAR Offline Mode

const DB_NAME = 'transcar_offline_db_v1';
const DB_VERSION = 1;

const STORE_SNAPSHOTS = 'snapshots';
const STORE_FILES = 'files';
const STORE_QUEUE = 'queue';
const STORE_LOGS = 'syncLogs';
const STORE_META = 'meta';

const LEGACY_CACHE_PREFIX = 'transcar_offline_cache_v1:';
const LEGACY_QUEUE_KEY = 'transcar_offline_queue_v1';

export interface OfflineFormFileField {
  field: string;
  fileKey: string;
  fileName: string;
  mimeType: string;
}

export interface OfflineMutationItem {
  id: string;
  idempotencyKey: string;
  url: string;
  method: string;
  bodyType: 'json' | 'formdata';
  body?: string;
  formFields?: Array<{ field: string; value: string }>;
  fileFields?: OfflineFormFileField[];
  baseVersion?: number | null;
  tempId?: number | null;
  createdAt: string;
  status: 'pending' | 'error' | 'conflict';
  errorMessage?: string;
  retryCount: number;
}

export interface OfflineSyncLogEntry {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  status: 'success' | 'error' | 'conflict';
  message: string;
}

export interface StoredFileEntry {
  key: string;
  blob: Blob;
  mimeType: string;
  name: string;
  updatedAt: string;
}

const snapshotMirror = new Map<string, unknown>();
const fileMirror = new Map<string, StoredFileEntry>();
let queueMirror: OfflineMutationItem[] = [];
let logsMirror: OfflineSyncLogEntry[] = [];
let tempIdMapMirror: Record<string, number> = {};
let lastSyncAtMirror: string | null = null;
let initializedPromise: Promise<void> | null = null;
let dbInstance: IDBDatabase | null = null;

function openIndexedDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
          db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_FILES)) {
          db.createObjectStore(STORE_FILES, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_LOGS)) {
          db.createObjectStore(STORE_LOGS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbGetAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve((req.result as T[]) || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

function idbPut(storeName: string, value: unknown): void {
  if (!dbInstance) return;
  try {
    const tx = dbInstance.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
  } catch {
    // ignore storage errors
  }
}

function idbDelete(storeName: string, key: string): void {
  if (!dbInstance) return;
  try {
    const tx = dbInstance.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
  } catch {
    // ignore
  }
}

function idbClear(storeName: string): void {
  if (!dbInstance) return;
  try {
    const tx = dbInstance.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
  } catch {
    // ignore
  }
}

function idbReplaceAll(storeName: string, rows: unknown[]): void {
  if (!dbInstance) return;
  try {
    const tx = dbInstance.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    for (const r of rows) {
      store.put(r);
    }
  } catch {
    // ignore
  }
}

export async function initOfflineDb(): Promise<void> {
  if (initializedPromise) return initializedPromise;
  initializedPromise = (async () => {
    dbInstance = await openIndexedDb();
    if (dbInstance) {
      const [snaps, files, queueRows, logRows, metaRows] = await Promise.all([
        idbGetAll<{ key: string; data: unknown }>(dbInstance, STORE_SNAPSHOTS),
        idbGetAll<StoredFileEntry>(dbInstance, STORE_FILES),
        idbGetAll<OfflineMutationItem>(dbInstance, STORE_QUEUE),
        idbGetAll<OfflineSyncLogEntry>(dbInstance, STORE_LOGS),
        idbGetAll<{ key: string; value: unknown }>(dbInstance, STORE_META),
      ]);

      for (const s of snaps) {
        snapshotMirror.set(s.key, s.data);
      }
      for (const f of files) {
        fileMirror.set(f.key, f);
      }
      queueMirror = queueRows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      logsMirror = logRows.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 80);

      for (const m of metaRows) {
        if (m.key === 'tempIdMap' && m.value && typeof m.value === 'object') {
          tempIdMapMirror = m.value as Record<string, number>;
        } else if (m.key === 'lastSyncAt' && typeof m.value === 'string') {
          lastSyncAtMirror = m.value;
        }
      }
    }

    // One-time migration from legacy localStorage cache if any exists
    try {
      const legacyKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LEGACY_CACHE_PREFIX)) {
          legacyKeys.push(k);
        }
      }
      for (const k of legacyKeys) {
        const snapKey = k.slice(LEGACY_CACHE_PREFIX.length);
        if (!snapshotMirror.has(snapKey)) {
          const raw = localStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            saveSnapshotToDb(snapKey, parsed);
          }
        }
        localStorage.removeItem(k);
      }
      const legacyQueueRaw = localStorage.getItem(LEGACY_QUEUE_KEY);
      if (legacyQueueRaw) {
        const legacyItems = JSON.parse(legacyQueueRaw) as Array<{
          id: string;
          url: string;
          method: string;
          body: string;
          createdAt: string;
        }>;
        if (Array.isArray(legacyItems) && legacyItems.length > 0 && queueMirror.length === 0) {
          const converted: OfflineMutationItem[] = legacyItems.map((it) => ({
            id: it.id,
            idempotencyKey: `legacy-${it.id}`,
            url: it.url,
            method: it.method,
            bodyType: 'json',
            body: it.body,
            createdAt: it.createdAt,
            status: 'pending',
            retryCount: 0,
          }));
          setQueueInDb(converted);
        }
        localStorage.removeItem(LEGACY_QUEUE_KEY);
      }
    } catch {
      // ignore migration errors
    }
  })();
  return initializedPromise;
}

export function saveSnapshotToDb(key: string, data: unknown): void {
  snapshotMirror.set(key, data);
  idbPut(STORE_SNAPSHOTS, {
    key,
    data,
    updatedAt: new Date().toISOString(),
  });
}

export function loadSnapshotFromDb<T>(key: string): T | null {
  if (!snapshotMirror.has(key)) return null;
  return snapshotMirror.get(key) as T;
}

export function getAllSnapshotKeys(): string[] {
  return Array.from(snapshotMirror.keys());
}

export function saveFileToDb(key: string, blob: Blob, mimeType: string, name: string): void {
  const normalizedMime = mimeType || blob.type || 'application/octet-stream';
  const detachedBlob = blob.slice(0, blob.size, normalizedMime);
  const entry: StoredFileEntry = {
    key,
    blob: detachedBlob,
    mimeType: normalizedMime,
    name,
    updatedAt: new Date().toISOString(),
  };
  fileMirror.set(key, entry);
  idbPut(STORE_FILES, entry);
}

export function loadFileFromDb(key: string): StoredFileEntry | null {
  return fileMirror.get(key) || null;
}

export function deleteFileFromDb(key: string): void {
  fileMirror.delete(key);
  idbDelete(STORE_FILES, key);
}

export function getQueueFromDb(): OfflineMutationItem[] {
  return [...queueMirror];
}

export function setQueueInDb(items: OfflineMutationItem[]): void {
  queueMirror = [...items];
  idbReplaceAll(STORE_QUEUE, queueMirror);
}

export function getLogsFromDb(): OfflineSyncLogEntry[] {
  return [...logsMirror];
}

export function appendLogToDb(entry: OfflineSyncLogEntry): void {
  logsMirror = [entry, ...logsMirror].slice(0, 80);
  idbReplaceAll(STORE_LOGS, logsMirror);
}

export function clearLogsInDb(): void {
  logsMirror = [];
  idbClear(STORE_LOGS);
}

export function getTempIdMapFromDb(): Record<string, number> {
  return { ...tempIdMapMirror };
}

export function setTempIdMappingInDb(tempId: number, realId: number): void {
  tempIdMapMirror[String(tempId)] = realId;
  idbPut(STORE_META, { key: 'tempIdMap', value: tempIdMapMirror });
}

export function getLastSyncAtFromDb(): string | null {
  return lastSyncAtMirror;
}

export function setLastSyncAtInDb(iso: string): void {
  lastSyncAtMirror = iso;
  idbPut(STORE_META, { key: 'lastSyncAt', value: iso });
}

export function clearAllOfflineDb(): void {
  snapshotMirror.clear();
  fileMirror.clear();
  queueMirror = [];
  logsMirror = [];
  tempIdMapMirror = {};
  lastSyncAtMirror = null;
  idbClear(STORE_SNAPSHOTS);
  idbClear(STORE_FILES);
  idbClear(STORE_QUEUE);
  idbClear(STORE_LOGS);
  idbClear(STORE_META);
}

export async function ensureSafeStorageMigration(currentAppVersion: string): Promise<{
  migratedFrom: string | null;
  preservedSnapshots: number;
  preservedQueueItems: number;
  preservedFiles: number;
}> {
  await initOfflineDb();

  let previousVersion: string | null = null;
  if (dbInstance) {
    try {
      const metaRows = await idbGetAll<{ key: string; value: unknown }>(dbInstance, STORE_META);
      const found = metaRows.find((r) => r.key === 'appVersion');
      if (found && typeof found.value === 'string') {
        previousVersion = found.value;
      }
    } catch {
      // ignore meta read errors
    }
  }

  // Record non-destructive version transition without touching snapshots, files, or pending queue
  if (previousVersion !== currentAppVersion) {
    idbPut(STORE_META, {
      key: 'preUpdateSnapshotMeta',
      value: {
        fromVersion: previousVersion,
        toVersion: currentAppVersion,
        snapshotCount: snapshotMirror.size,
        queueCount: queueMirror.length,
        fileCount: fileMirror.size,
        checkedAt: new Date().toISOString(),
      },
    });
    idbPut(STORE_META, { key: 'appVersion', value: currentAppVersion });

    if (previousVersion) {
      appendLogToDb({
        id: `migration-${Date.now()}`,
        timestamp: new Date().toISOString(),
        method: 'SYSTEM',
        url: 'pwa-update',
        status: 'success',
        message: `Migration sécurisée v${previousVersion} -> v${currentAppVersion} (données hors ligne préservées)`,
      });
    }
  }

  return {
    migratedFrom: previousVersion,
    preservedSnapshots: snapshotMirror.size,
    preservedQueueItems: queueMirror.length,
    preservedFiles: fileMirror.size,
  };
}

export function getOfflineStorageSummary(): {
  snapshotCount: number;
  queueCount: number;
  fileCount: number;
} {
  return {
    snapshotCount: snapshotMirror.size,
    queueCount: queueMirror.length,
    fileCount: fileMirror.size,
  };
}
