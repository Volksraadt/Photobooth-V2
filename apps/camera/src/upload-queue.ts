/**
 * Stills waiting for the agent's confirmation, persisted in IndexedDB so a photo survives a
 * Wi-Fi drop (and even an app restart) until `POST /camera/shots` returns 200.
 */

export type PendingUpload = { requestId: string; blob: Blob; capturedAt: string };

const DB = 'pb-camera';
const STORE = 'uploads';

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'requestId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export class UploadQueue {
  private readonly memory = new Map<string, PendingUpload>();
  private db: Promise<IDBDatabase | null> = openDb();

  async load(): Promise<void> {
    const db = await this.db;
    if (!db) return;
    await new Promise<void>((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => {
        for (const row of req.result as PendingUpload[]) this.memory.set(row.requestId, row);
        resolve();
      };
      req.onerror = () => resolve();
    });
  }

  ids(): string[] {
    return [...this.memory.keys()];
  }

  get(requestId: string): PendingUpload | undefined {
    return this.memory.get(requestId);
  }

  all(): PendingUpload[] {
    return [...this.memory.values()];
  }

  async add(item: PendingUpload): Promise<void> {
    this.memory.set(item.requestId, item);
    const db = await this.db;
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async remove(requestId: string): Promise<void> {
    this.memory.delete(requestId);
    const db = await this.db;
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(requestId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
}
