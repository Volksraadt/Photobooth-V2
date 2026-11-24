import { createHash } from 'node:crypto';
import { isAllowedAssetUrl, type BoothConfig } from '@pb/schema';
import { JobError } from './types';

/** Hard cap per asset download, whatever the AssetRef claims (videos are the largest uploads). */
const MAX_ASSET_BYTES = 100 * 1024 * 1024;

/**
 * Bytes of a config asset. `data:` URLs (built-in frame) are decoded locally; others are fetched
 * only from the platform's own asset storage (`allowedPrefixes`), without following redirects.
 * Every asset is checked against its AssetRef sha256 (like the agent does), so the worker never
 * uses bytes other than what the booth printed. Cached per job.
 */
export function createAssetLoader(
  config: BoothConfig,
  allowedPrefixes: readonly string[],
  fetchImpl: typeof fetch = fetch,
) {
  const cache = new Map<string, Promise<Buffer>>();
  return (assetId: string): Promise<Buffer> => {
    let hit = cache.get(assetId);
    if (!hit) {
      hit = load(config, assetId, allowedPrefixes, fetchImpl);
      cache.set(assetId, hit);
      // A failed fetch must not be cached forever within the job.
      hit.catch(() => cache.delete(assetId));
    }
    return hit;
  };
}

async function load(
  config: BoothConfig,
  assetId: string,
  allowedPrefixes: readonly string[],
  fetchImpl: typeof fetch,
): Promise<Buffer> {
  const ref = config.assets.find((a) => a.id === assetId);
  if (!ref) throw new JobError('config_missing', `Aset ${assetId} tidak ada di config`, true);
  let bytes: Buffer;
  if (ref.url.startsWith('data:')) {
    const comma = ref.url.indexOf(',');
    const meta = ref.url.slice(5, comma);
    const body = ref.url.slice(comma + 1);
    bytes = meta.endsWith(';base64')
      ? Buffer.from(body, 'base64')
      : Buffer.from(decodeURIComponent(body));
  } else {
    if (!isAllowedAssetUrl(ref.url, allowedPrefixes)) {
      // Never fetched: the URL is not on the platform's storage (see PB_ASSET_URL_PREFIXES).
      throw new JobError('asset_rejected', `Aset ${assetId} bukan dari penyimpanan platform`, true);
    }
    const res = await fetchImpl(ref.url, {
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`Aset ${assetId} tidak dapat diunduh (HTTP ${res.status})`);
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > MAX_ASSET_BYTES)
      throw new JobError('asset_rejected', `Aset ${assetId} terlalu besar`, true);
    bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > MAX_ASSET_BYTES)
      throw new JobError('asset_rejected', `Aset ${assetId} terlalu besar`, true);
  }
  if (createHash('sha256').update(bytes).digest('hex') !== ref.sha256) {
    throw new JobError('asset_rejected', `Isi aset ${assetId} tidak cocok dengan hash-nya`, true);
  }
  return bytes;
}
