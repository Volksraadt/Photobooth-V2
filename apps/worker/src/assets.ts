import type { BoothConfig } from '@pb/schema';
import { JobError } from './types';

/**
 * Bytes of a config asset. `data:` URLs (built-in frame) are decoded locally; others are fetched
 * (Studio media / Supabase Storage public URL). Cached per job.
 */
export function createAssetLoader(config: BoothConfig, fetchImpl: typeof fetch = fetch) {
  const cache = new Map<string, Promise<Buffer>>();
  return (assetId: string): Promise<Buffer> => {
    let hit = cache.get(assetId);
    if (!hit) {
      hit = load(config, assetId, fetchImpl);
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
  fetchImpl: typeof fetch,
): Promise<Buffer> {
  const ref = config.assets.find((a) => a.id === assetId);
  if (!ref) throw new JobError('config_missing', `Aset ${assetId} tidak ada di config`, true);
  if (ref.url.startsWith('data:')) {
    const comma = ref.url.indexOf(',');
    const meta = ref.url.slice(5, comma);
    const body = ref.url.slice(comma + 1);
    return meta.endsWith(';base64')
      ? Buffer.from(body, 'base64')
      : Buffer.from(decodeURIComponent(body));
  }
  const res = await fetchImpl(ref.url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Aset ${assetId}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
