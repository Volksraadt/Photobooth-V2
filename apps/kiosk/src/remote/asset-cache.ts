import type { AssetRef, BoothConfig } from '@pb/schema';
import { sha256Hex } from './device-api';

const CACHE = 'pb-assets-v1';

export class AssetDownloadError extends Error {
  constructor(
    readonly asset: AssetRef,
    reason: string,
  ) {
    super(`Aset ${asset.id} gagal diunduh: ${reason}`);
    this.name = 'AssetDownloadError';
  }
}

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(CACHE);
  } catch {
    return null;
  }
}

/** One asset as a verified Blob: from Cache Storage when present, otherwise downloaded. */
async function loadAsset(cache: Cache | null, asset: AssetRef): Promise<Blob> {
  const cached = await cache?.match(asset.url);
  if (cached) {
    const blob = await cached.blob();
    if ((await sha256Hex(await blob.arrayBuffer())) === asset.sha256) return blob;
    await cache?.delete(asset.url);
  }
  let res: Response;
  try {
    res = await fetch(asset.url, { cache: 'no-store' });
  } catch (err) {
    throw new AssetDownloadError(asset, String(err));
  }
  if (!res.ok) throw new AssetDownloadError(asset, `HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  if ((await sha256Hex(bytes)) !== asset.sha256)
    throw new AssetDownloadError(asset, 'sha256 tidak cocok');
  const blob = new Blob([bytes], { type: res.headers.get('content-type') ?? '' });
  await cache?.put(asset.url, new Response(blob)).catch(() => undefined);
  return blob;
}

/**
 * Downloads + verifies every asset of a config. All-or-nothing: throws if any asset fails, so the
 * caller keeps the previous version active. Returns assetId → object URL (works offline).
 */
export async function prepareAssets(config: BoothConfig): Promise<Map<string, string>> {
  const cache = await openCache();
  const entries = await Promise.all(
    config.assets.map(async (asset): Promise<[string, string]> => {
      // Built-in data URLs are part of the config itself.
      if (asset.url.startsWith('data:')) return [asset.id, asset.url];
      const blob = await loadAsset(cache, asset);
      return [asset.id, URL.createObjectURL(blob)];
    }),
  );
  return new Map(entries);
}
