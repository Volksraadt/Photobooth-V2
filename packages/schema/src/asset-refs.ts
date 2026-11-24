import type { BoothConfig } from './booth-config';

/** Font assets are referenced by family name: `"pb-font-<assetId>"` in any fontFamily. */
export const FONT_FAMILY_PREFIX = 'pb-font-';
const FONT_RE = new RegExp(`${FONT_FAMILY_PREFIX}([A-Za-z0-9_-]+)`, 'g');

/** Every asset id the config uses (asset fields, backgrounds, frames, filters, fonts). */
export function referencedAssetIds(config: BoothConfig): Set<string> {
  const ids = new Set<string>();
  const walk = (v: unknown, key?: string) => {
    if (typeof v === 'string') {
      if (key && /AssetId$|^assetId$/.test(key) && v) ids.add(v);
      for (const m of v.matchAll(FONT_RE)) ids.add(m[1]!);
      return;
    }
    if (Array.isArray(v)) v.forEach((x) => walk(x));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) if (k !== 'assets') walk(x, k);
    }
  };
  walk(config);
  return ids;
}

/** Drops AssetRefs nothing references, so devices only download what they show. */
export function pruneUnusedAssets(config: BoothConfig): BoothConfig {
  const used = referencedAssetIds(config);
  return { ...config, assets: config.assets.filter((a) => used.has(a.id)) };
}
