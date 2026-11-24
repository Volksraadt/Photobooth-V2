import type { BoothConfig } from './booth-config';

/**
 * Where config assets may live. Owners only ever get asset URLs from the platform's own storage
 * (Studio upload → `<media base>/media/…` or the Supabase `assets` bucket) or the built-in
 * `data:` assets. Anything else in a config is rejected at save/publish and never fetched by the
 * cloud worker (otherwise a config could make the worker request internal addresses).
 */
export function assetUrlPrefixesFromEnv(env: Record<string, string | undefined>): string[] {
  const explicit = (env.PB_ASSET_URL_PREFIXES ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (explicit.length) return explicit.map(withSlash);
  const prefixes = [`${trim(env.PB_MEDIA_BASE_URL ?? 'http://localhost:3000')}/media/`];
  const supabase = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabase) prefixes.push(`${trim(supabase)}/storage/v1/object/public/assets/`);
  return prefixes;
}

const trim = (s: string) => s.replace(/\/+$/, '');
const withSlash = (s: string) => (s.endsWith('/') ? s : `${s}/`);

/** `data:` (built-in assets) or an http(s) URL under one of `prefixes`, without tricks. */
export function isAllowedAssetUrl(url: string, prefixes: readonly string[]): boolean {
  if (url.startsWith('data:')) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (parsed.username || parsed.password) return false;
  // Compare the normalised form so `…/media/../x` or `%2e%2e` cannot escape the prefix.
  const normalised = parsed.href;
  if (/\/\.\.?(\/|$)|%2e/i.test(parsed.pathname)) return false;
  return prefixes.some((p) => normalised.startsWith(p));
}

/** Asset ids of `config` whose URL is not allowed (empty = all fine). */
export function disallowedAssetIds(config: BoothConfig, prefixes: readonly string[]): string[] {
  return config.assets.filter((a) => !isAllowedAssetUrl(a.url, prefixes)).map((a) => a.id);
}
