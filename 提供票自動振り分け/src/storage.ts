import { DEFAULT_DELIVERY_METHODS, type AppSavedData } from './types';

const STORAGE_KEY = 'service-slip-sorter.settings.v1';
const DATABASE = 'service-slip-sorter-backups';
const STORE = 'daily_snapshots';
const OUTPUT_DIRECTORY_STORE = 'output_directory';

export const emptySavedData = (): AppSavedData => ({ version: 1, providerMaster: [], geminiEnabled: false, deliveryMethods: DEFAULT_DELIVERY_METHODS.map((method) => ({ ...method })) });

function valid(value: unknown): value is AppSavedData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<AppSavedData>;
  const methodsValid = data.deliveryMethods === undefined || (Array.isArray(data.deliveryMethods) && data.deliveryMethods.every((method) => Boolean(method && typeof method.value === 'string' && typeof method.name === 'string' && typeof method.folderName === 'string')));
  return data.version === 1 && Array.isArray(data.providerMaster) && typeof data.geminiEnabled === 'boolean' && methodsValid;
}

function dayKey(date = new Date()) { return date.toISOString().slice(0, 10); }

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'day' });
      if (!db.objectStoreNames.contains(OUTPUT_DIRECTORY_STORE)) db.createObjectStore(OUTPUT_DIRECTORY_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadOutputDirectoryHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(OUTPUT_DIRECTORY_STORE, 'readonly').objectStore(OUTPUT_DIRECTORY_STORE).get('output');
    request.onsuccess = () => { db.close(); resolve(request.result?.handle as FileSystemDirectoryHandle | undefined); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function saveOutputDirectoryHandle(handle: FileSystemDirectoryHandle) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(OUTPUT_DIRECTORY_STORE, 'readwrite');
    transaction.objectStore(OUTPUT_DIRECTORY_STORE).put({ id: 'output', handle });
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

async function newestSnapshot(): Promise<AppSavedData | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => {
      const records = (request.result as { day: string; payload: { data: unknown } }[]).sort((a, b) => b.day.localeCompare(a.day));
      db.close();
      resolve(records.map((record) => record.payload?.data).find(valid));
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function automaticBackup(data: AppSavedData) {
  const db = await openDatabase();
  const today = dayKey();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    // 同じ日の変更は最新状態で上書きし、日ごとに一件だけを保管する。
    store.put({ day: today, payload: { data }, savedAt: new Date().toISOString() });
    const cutoff = dayKey(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) return;
      if (String(item.key) < cutoff) item.delete();
      item.continue();
    };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

export async function loadSavedData(): Promise<AppSavedData> {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (valid(stored)) return stored;
  } catch { /* IndexedDBの復元を試す */ }
  try {
    const restored = await newestSnapshot();
    if (restored) { localStorage.setItem(STORAGE_KEY, JSON.stringify(restored)); return restored; }
  } catch { /* 初期状態で開始 */ }
  return emptySavedData();
}

export function saveSavedData(data: AppSavedData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  void automaticBackup(data);
}

export function exportSavedData(data: AppSavedData) {
  return new Blob([JSON.stringify({ app: 'service-slip-sorter', exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
}

export async function importSavedData(file: File): Promise<AppSavedData> {
  const parsed = JSON.parse(await file.text()) as { app?: unknown; data?: unknown };
  if (parsed.app !== 'service-slip-sorter' || !valid(parsed.data)) throw new Error('このアプリ用の有効なバックアップではありません。');
  return parsed.data;
}
