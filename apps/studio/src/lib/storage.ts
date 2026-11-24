import 'server-only';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { authMode } from './env';
import { createSupabaseServerClient } from './supabase';

/**
 * Where uploaded booth assets live.
 * dev: local disk (`<repo>/.data/assets`), served by Studio at `/media/<key>`.
 * supabase: public bucket `assets` (upload with the user session; Storage policies decide).
 */
export interface AssetStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<{ url: string; path: string }>;
}

export const LOCAL_ASSET_DIR = resolve(process.cwd(), '../../.data/assets');

export function mediaBaseUrl(): string {
  return (process.env.PB_MEDIA_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/** Resolve a key inside the local asset dir; rejects traversal. */
export function localAssetPath(key: string): string | null {
  const path = resolve(LOCAL_ASSET_DIR, key);
  return path.startsWith(LOCAL_ASSET_DIR + sep) ? path : null;
}

const localStorage: AssetStorage = {
  async put(key, bytes) {
    const path = localAssetPath(key);
    if (!path) throw new Error('invalid asset key');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return { url: `${mediaBaseUrl()}/media/${key}`, path: key };
  },
};

const supabaseStorage: AssetStorage = {
  async put(key, bytes, contentType) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.storage
      .from('assets')
      .upload(key, bytes, { contentType, upsert: true, cacheControl: '31536000' });
    if (error) throw new Error(`Upload ke storage gagal: ${error.message}`);
    const { data } = supabase.storage.from('assets').getPublicUrl(key);
    return { url: data.publicUrl, path: `assets/${key}` };
  },
};

export function assetStorage(): AssetStorage {
  return authMode() === 'supabase' && process.env.PB_ASSET_STORAGE !== 'local'
    ? supabaseStorage
    : localStorage;
}

export async function readLocalAsset(key: string): Promise<Buffer | null> {
  const path = localAssetPath(key);
  if (!path) return null;
  return readFile(path).catch(() => null);
}
