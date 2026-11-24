import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { StorageError, type ObjectStorage } from './types';

/** Dev/test storage on local disk. Writes are atomic (temp file + rename). */
export class DiskStorage implements ObjectStorage {
  readonly kind = 'disk';
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root + sep)) throw new StorageError(`invalid key: ${key}`);
    return full;
  }

  async put(key: string, bytes: Uint8Array, _contentType?: string): Promise<void> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    const tmp = `${full}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, full);
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.path(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        throw new StorageError(`object not found: ${key}`, 'not_found');
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.path(key))).isFile();
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    await rm(this.path(prefix.replace(/\/$/, '')), { recursive: true, force: true });
  }
}
