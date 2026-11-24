import { StorageError, type ObjectStorage } from './types';

/**
 * Supabase Storage through its REST API with the service-role key (server only: api + worker).
 * The bucket is private; files are only read back by the worker, never served to buyers.
 */
export class SupabaseStorage implements ObjectStorage {
  readonly kind = 'supabase';
  private readonly base: string;

  constructor(
    url: string,
    private readonly serviceKey: string,
    private readonly bucket: string,
  ) {
    this.base = `${url.replace(/\/$/, '')}/storage/v1`;
  }

  private headers(extra: Record<string, string> = {}) {
    return { authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, ...extra };
  }

  private objectUrl(key: string) {
    return `${this.base}/object/${this.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const res = await fetch(this.objectUrl(key), {
      method: 'POST',
      headers: this.headers({ 'content-type': contentType, 'x-upsert': 'true' }),
      body: bytes,
    });
    if (!res.ok) throw new StorageError(`Supabase Storage put ${res.status}: ${await res.text()}`);
  }

  async get(key: string): Promise<Buffer> {
    const res = await fetch(this.objectUrl(key), { headers: this.headers() });
    if (res.status === 404 || res.status === 400)
      throw new StorageError(`object not found: ${key}`, 'not_found');
    if (!res.ok) throw new StorageError(`Supabase Storage get ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async exists(key: string): Promise<boolean> {
    const res = await fetch(this.objectUrl(key), { method: 'HEAD', headers: this.headers() });
    return res.ok;
  }

  async delete(key: string): Promise<void> {
    const res = await fetch(`${this.base}/object/${this.bucket}`, {
      method: 'DELETE',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prefixes: [key] }),
    });
    if (!res.ok) throw new StorageError(`Supabase Storage delete ${res.status}`);
  }

  async deletePrefix(prefix: string): Promise<void> {
    const dir = prefix.replace(/\/$/, '');
    const res = await fetch(`${this.base}/object/list/${this.bucket}`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prefix: dir, limit: 1000 }),
    });
    if (!res.ok) throw new StorageError(`Supabase Storage list ${res.status}`);
    const entries = (await res.json()) as { name: string; id: string | null }[];
    for (const e of entries) {
      // `id: null` = a "folder" level; recurse.
      if (e.id === null) await this.deletePrefix(`${dir}/${e.name}`);
      else await this.delete(`${dir}/${e.name}`);
    }
  }
}
