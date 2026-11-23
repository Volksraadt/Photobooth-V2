import { createRemoteJWKSet, errors, jwtVerify, SignJWT, type JWTPayload } from 'jose';

export type UserClaims = { userId: string; email: string | null };

const ISSUER_DEV = 'pb-dev-auth';

function hsKey(secret: string): Uint8Array {
  if (secret.length < 32) throw new Error('auth secret must be at least 32 characters');
  return new TextEncoder().encode(secret);
}

/** Dev-mode session token (PB_AUTH_MODE=dev). Same shape as a Supabase access token. */
export async function signDevUserToken(
  secret: string,
  claims: UserClaims,
  ttlSec = 7 * 24 * 3600,
): Promise<string> {
  return new SignJWT({ email: claims.email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER_DEV)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(hsKey(secret));
}

export type UserTokenVerifier = (token: string) => Promise<UserClaims | null>;

function toClaims(payload: JWTPayload): UserClaims | null {
  if (!payload.sub || payload.role !== 'authenticated') return null;
  return { userId: payload.sub, email: typeof payload.email === 'string' ? payload.email : null };
}

async function verifyOrNull(
  fn: () => Promise<{ payload: JWTPayload }>,
): Promise<UserClaims | null> {
  try {
    return toClaims((await fn()).payload);
  } catch (err) {
    if (err instanceof errors.JOSEError) return null;
    throw err;
  }
}

/** Verifies dev tokens or Supabase legacy HS256 tokens signed with `secret`. */
export function hs256UserTokenVerifier(
  secret: string,
  opts: { issuer?: string } = {},
): UserTokenVerifier {
  const key = hsKey(secret);
  return (token) =>
    verifyOrNull(() =>
      jwtVerify(token, key, {
        algorithms: ['HS256'],
        audience: 'authenticated',
        ...(opts.issuer ? { issuer: opts.issuer } : {}),
      }),
    );
}

export function devUserTokenVerifier(secret: string): UserTokenVerifier {
  return hs256UserTokenVerifier(secret, { issuer: ISSUER_DEV });
}

/** Verifies Supabase access tokens signed with asymmetric keys (JWKS). */
export function supabaseJwksVerifier(supabaseUrl: string): UserTokenVerifier {
  const base = supabaseUrl.replace(/\/$/, '');
  const jwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
  return (token) =>
    verifyOrNull(() =>
      jwtVerify(token, jwks, { audience: 'authenticated', issuer: `${base}/auth/v1` }),
    );
}
