export const APP_NAME = 'デスクトップメモ';

const DATA_KEY = 'desktop_memo_data_v1';
const BACKUP_DB_NAME = 'desktop_memo_auto_backup_v1';
const BACKUP_STORE_NAME = 'daily_snapshots';
const BACKUP_DB_VERSION = 1;
const BACKUP_RETENTION_DAYS = 30;

export const NOTE_COLORS = [
  { id: 'sand', label: '砂色', dot: '#bd966b', surface: '#f3eadb' },
  { id: 'sage', label: 'セージ', dot: '#829581', surface: '#eaf0e8' },
  { id: 'blue', label: '青灰', dot: '#8095a7', surface: '#e9eef2' },
  { id: 'rose', label: 'くすみ赤', dot: '#b17f78', surface: '#f3e9e7' },
  { id: 'olive', label: 'オリーブ', dot: '#99966c', surface: '#f0efe2' },
  { id: 'slate', label: '灰緑', dot: '#7f918c', surface: '#e9eeec' },
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number]['id'];

export interface Note {
  id: string;
  title: string;
  color: NoteColor;
  body: string;
  updatedAt: string;
}

export interface AppData {
  version: 1;
  notes: Note[];
  selectedId: string | null;
}

interface BackupSnapshot {
  appName: string;
  schemaVersion: 1;
  dateKey: string;
  updatedAt: string;
  payload: {
    data: AppData;
  };
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'note-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

export function createNote(): Note {
  return {
    id: createId(),
    title: 'タイトル',
    color: 'sand',
    body: '',
    updatedAt: new Date().toISOString(),
  };
}

export function createInitialData(): AppData {
  const note: Note = {
    ...createNote(),
    title: 'タイトル',
  };
  return { version: 1, notes: [note], selectedId: note.id };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNoteColor(value: unknown): value is NoteColor {
  return NOTE_COLORS.some((color) => color.id === value);
}

export function normalizeAppData(value: unknown): AppData | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.notes)) return null;

  const notes: Note[] = [];
  for (const item of value.notes) {
    if (!isRecord(item)) return null;
    if (
      typeof item.id !== 'string' ||
      typeof item.title !== 'string' ||
      typeof item.body !== 'string'
    ) {
      return null;
    }

    notes.push({
      id: item.id.slice(0, 100),
      title: item.title.trim().slice(0, 4) || 'タイトル',
      color: isNoteColor(item.color) ? item.color : 'sand',
      body: item.body,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  }

  const selectedId =
    typeof value.selectedId === 'string' && notes.some((note) => note.id === value.selectedId)
      ? value.selectedId
      : notes[0]?.id ?? null;

  return { version: 1, notes, selectedId };
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function retentionCutoffDateKey(): string {
  const cutoff = new Date();
  cutoff.setHours(12, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (BACKUP_RETENTION_DAYS - 1));
  return localDateKey(cutoff);
}

export function saveLocalData(data: AppData): void {
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
}

function openBackupDatabase(): Promise<IDBDatabase> {
  if (!window.indexedDB) {
    return Promise.reject(new Error('この環境ではIndexedDBを利用できません。'));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(BACKUP_DB_NAME, BACKUP_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BACKUP_STORE_NAME)) {
        database.createObjectStore(BACKUP_STORE_NAME, { keyPath: 'dateKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('バックアップ用データベースを開けません。'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDBの読み書きに失敗しました。'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDBの保存に失敗しました。'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDBの保存が中断されました。'));
  });
}

async function readSnapshots(database: IDBDatabase): Promise<unknown[]> {
  const transaction = database.transaction(BACKUP_STORE_NAME, 'readonly');
  return requestResult(transaction.objectStore(BACKUP_STORE_NAME).getAll());
}

export async function saveDailySnapshot(data: AppData): Promise<void> {
  const database = await openBackupDatabase();
  try {
    const snapshot: BackupSnapshot = {
      appName: APP_NAME,
      schemaVersion: 1,
      dateKey: localDateKey(),
      updatedAt: new Date().toISOString(),
      payload: { data },
    };

    const writeTransaction = database.transaction(BACKUP_STORE_NAME, 'readwrite');
    const writeDone = transactionDone(writeTransaction);
    writeTransaction.objectStore(BACKUP_STORE_NAME).put(snapshot);
    await writeDone;

    const pruneTransaction = database.transaction(BACKUP_STORE_NAME, 'readwrite');
    const pruneDone = transactionDone(pruneTransaction);
    const store = pruneTransaction.objectStore(BACKUP_STORE_NAME);
    const snapshots = await requestResult(store.getAll());
    const cutoff = retentionCutoffDateKey();
    for (const item of snapshots as BackupSnapshot[]) {
      if (typeof item.dateKey === 'string' && item.dateKey < cutoff) {
        store.delete(item.dateKey);
      }
    }
    await pruneDone;
  } finally {
    database.close();
  }
}

async function loadNewestValidSnapshot(): Promise<AppData | null> {
  let database: IDBDatabase;
  try {
    database = await openBackupDatabase();
  } catch {
    return null;
  }

  try {
    const snapshots = await readSnapshots(database);
    snapshots.sort((left, right) => {
      const a = isRecord(left) ? left : {};
      const b = isRecord(right) ? right : {};
      const dateOrder = String(b.dateKey ?? '').localeCompare(String(a.dateKey ?? ''));
      return dateOrder || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''));
    });

    for (const item of snapshots) {
      if (!isRecord(item) || item.appName !== APP_NAME || item.schemaVersion !== 1) continue;
      const payload = isRecord(item.payload) ? item.payload : null;
      const restored = payload ? normalizeAppData(payload.data) : null;
      if (restored) return restored;
    }
    return null;
  } catch {
    return null;
  } finally {
    database.close();
  }
}

export async function loadAppData(): Promise<AppData> {
  try {
    const saved = localStorage.getItem(DATA_KEY);
    if (saved) {
      const current = normalizeAppData(JSON.parse(saved) as unknown);
      if (current) return current;
    }
  } catch {
    // 保存データが読めない場合は、IndexedDBのバックアップを確認します。
  }

  const recovered = await loadNewestValidSnapshot();
  if (recovered) {
    try {
      saveLocalData(recovered);
    } catch {
      // 復元データは画面上で使い、次の保存時に再試行します。
    }
    return recovered;
  }

  return createInitialData();
}

export function createBackupJson(data: AppData): string {
  return JSON.stringify(
    {
      appName: APP_NAME,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      data,
    },
    null,
    2,
  );
}

export async function readBackupFile(file: File): Promise<AppData> {
  const text = await file.text();
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || parsed.appName !== APP_NAME || parsed.schemaVersion !== 1) {
    throw new Error('デスクトップメモのバックアップではありません。');
  }
  const data = normalizeAppData(parsed.data);
  if (!data) {
    throw new Error('バックアップの中身を読み取れません。');
  }
  return data;
}
