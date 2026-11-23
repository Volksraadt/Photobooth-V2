import 'server-only';
import { devUserTokenVerifier, hashPassword, signDevUserToken, verifyPassword } from '@pb/crypto';
import { getDb } from '@pb/db';
import { sql } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { authMode, devAuthSecret } from './env';
import { createSupabaseServerClient } from './supabase';

export type CurrentUser = { id: string; email: string | null };

const DEV_COOKIE = 'pb_dev_session';
const DEV_TTL_SEC = 7 * 24 * 3600;

export type AuthResult = { ok: true } | { ok: false; message: string; info?: boolean };

/** The signed-in user, verified server-side. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (authMode() === 'supabase') {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
  }
  const token = (await cookies()).get(DEV_COOKIE)?.value;
  if (!token) return null;
  const claims = await devUserTokenVerifier(devAuthSecret())(token);
  return claims ? { id: claims.userId, email: claims.email } : null;
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function setDevSession(user: CurrentUser) {
  const token = await signDevUserToken(
    devAuthSecret(),
    { userId: user.id, email: user.email },
    DEV_TTL_SEC,
  );
  (await cookies()).set(DEV_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DEV_TTL_SEC,
  });
}

type ShimUserRow = { id: string; email: string; encrypted_password: string | null };

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

export async function signUp(emailRaw: string, password: string): Promise<AuthResult> {
  const email = normaliseEmail(emailRaw);
  if (authMode() === 'supabase') {
    const supabase = await createSupabaseServerClient();
    const origin = (await headers()).get('origin') ?? '';
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });
    if (error) return { ok: false, message: error.message };
    if (!data.session)
      return { ok: false, info: true, message: 'Cek email Anda untuk konfirmasi pendaftaran.' };
    return { ok: true };
  }
  // Dev mode: auth.users is the local shim table (never Supabase).
  const db = getDb();
  const inserted = rowsOf<{ id: string }>(
    await db.execute(sql`
      insert into auth.users (email, encrypted_password)
      values (${email}, ${hashPassword(password)})
      on conflict (email) do nothing
      returning id`),
  );
  if (!inserted[0]) return { ok: false, message: 'Email sudah terdaftar. Silakan masuk.' };
  await setDevSession({ id: inserted[0].id, email });
  return { ok: true };
}

export async function signIn(emailRaw: string, password: string): Promise<AuthResult> {
  const email = normaliseEmail(emailRaw);
  if (authMode() === 'supabase') {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { ok: false, message: 'Email atau kata sandi salah.' } : { ok: true };
  }
  const db = getDb();
  const [user] = rowsOf<ShimUserRow>(
    await db.execute(
      sql`select id, email, encrypted_password from auth.users where email = ${email}`,
    ),
  );
  if (!user?.encrypted_password || !verifyPassword(password, user.encrypted_password)) {
    return { ok: false, message: 'Email atau kata sandi salah.' };
  }
  await setDevSession({ id: user.id, email: user.email });
  return { ok: true };
}

/** Supabase only: returns the Google OAuth URL to redirect to. */
export async function googleSignInUrl(): Promise<string | null> {
  if (authMode() !== 'supabase') return null;
  const supabase = await createSupabaseServerClient();
  const origin = (await headers()).get('origin') ?? '';
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${origin}/auth/callback` },
  });
  return error ? null : data.url;
}

export async function signOut(): Promise<void> {
  if (authMode() === 'supabase') {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  (await cookies()).delete(DEV_COOKIE);
}
