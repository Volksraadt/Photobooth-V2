import 'server-only';

export type AuthMode = 'dev' | 'supabase';

export function authMode(): AuthMode {
  const mode = process.env.PB_AUTH_MODE ?? 'dev';
  if (mode !== 'dev' && mode !== 'supabase')
    throw new Error(`PB_AUTH_MODE must be dev or supabase (got ${mode})`);
  if (
    mode === 'dev' &&
    process.env.NODE_ENV === 'production' &&
    process.env.PB_ALLOW_DEV_AUTH !== '1'
  ) {
    throw new Error('PB_AUTH_MODE=dev is not allowed in production');
  }
  return mode;
}

export function devAuthSecret(): string {
  const secret = process.env.DEV_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error('DEV_AUTH_SECRET must be set (≥ 32 chars) when PB_AUTH_MODE=dev');
  return secret;
}

export function supabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required when PB_AUTH_MODE=supabase',
    );
  }
  return { url, anonKey };
}
