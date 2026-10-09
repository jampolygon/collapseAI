import type { DownloadedMapRegion } from './mapTypes';

const DATABASE = 'collapseai-offline-maps';
const VERSION = 1;
const STORE = 'regions';

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in window)) return Promise.reject(new Error('This browser does not support local map storage.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`Could not open local map storage: ${request.error?.message ?? 'unknown error'}`));
    request.onblocked = () => reject(new Error('Local map storage is busy in another tab. Close other CollapseAI tabs and retry.'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      let result!: T;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(new Error(`Local map storage failed: ${request.error?.message ?? 'unknown error'}`));
      transaction.onabort = () => reject(new Error(`Local map storage transaction failed: ${transaction.error?.message ?? 'unknown error'}`));
      transaction.onerror = () => reject(new Error(`Local map storage transaction failed: ${transaction.error?.message ?? 'unknown error'}`));
      transaction.oncomplete = () => resolve(result);
    });
  } finally {
    database.close();
  }
}

export async function listDownloadedRegions(): Promise<DownloadedMapRegion[]> {
  const records = await withStore<DownloadedMapRegion[]>('readonly', store => store.getAll());
  return records.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getDownloadedRegion(id: string): Promise<DownloadedMapRegion | undefined> {
  return withStore<DownloadedMapRegion | undefined>('readonly', store => store.get(id));
}

export async function saveDownloadedRegion(region: DownloadedMapRegion): Promise<void> {
  await withStore<IDBValidKey>('readwrite', store => store.put(region));
}

export async function deleteDownloadedRegion(id: string): Promise<void> {
  await withStore<undefined>('readwrite', store => store.delete(id));
}
