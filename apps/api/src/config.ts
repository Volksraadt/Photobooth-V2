import {
  devUserTokenVerifier,
  hs256UserTokenVerifier,
  supabaseJwksVerifier,
  type UserTokenVerifier,
} from '@pb/crypto';

export function userTokenVerifierFromEnv(
  env: Record<string, string | undefined> = process.env,
): UserTokenVerifier {
  const mode = env.PB_AUTH_MODE ?? 'dev';
  if (mode === 'dev') {
    if (env.NODE_ENV === 'production' && env.PB_ALLOW_DEV_AUTH !== '1') {
      throw new Error('PB_AUTH_MODE=dev is not allowed in production');
    }
    const secret = env.DEV_AUTH_SECRET;
    if (!secret) throw new Error('DEV_AUTH_SECRET is required when PB_AUTH_MODE=dev');
    return devUserTokenVerifier(secret);
  }
  if (mode === 'supabase') {
    if (env.SUPABASE_JWT_SECRET) return hs256UserTokenVerifier(env.SUPABASE_JWT_SECRET);
    const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url)
      throw new Error('SUPABASE_JWT_SECRET or SUPABASE_URL is required when PB_AUTH_MODE=supabase');
    return supabaseJwksVerifier(url);
  }
  throw new Error(`PB_AUTH_MODE must be dev or supabase (got ${mode})`);
}
