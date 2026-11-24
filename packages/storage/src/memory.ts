import { StorageError, type ObjectStorage } from './types';

/** Tests only. */
export class MemoryStorage implements ObjectStorage {
  readonly kind = 'memory';
  readonly objects = new Map<string, Buffer>();

  async put(key: string, bytes: Uint8Array, _contentType?: string): Promise<void> {
    this.objects.set(key, Buffer.from(bytes));
  }
  async get(key: string): Promise<Buffer> {
    const v = this.objects.get(key);
    if (!v) throw new StorageError(`object not found: ${key}`, 'not_found');
    return v;
  }
  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async deletePrefix(prefix: string): Promise<void> {
    const p = prefix.replace(/\/$/, '') + '/';
    for (const k of [...this.objects.keys()]) if (k.startsWith(p)) this.objects.delete(k);
  }
}
