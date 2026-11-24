import 'server-only';
import { cookies } from 'next/headers';
import { authMode } from './env';
import { createSupabaseServerClient } from './supabase';

export function apiBaseUrl(): string {
  return (process.env.PB_API_URL ?? 'http://localhost:8787').replace(/\/$/, '');
}

/** The signed-in user's bearer token for apps/api (dev session JWT or Supabase access token). */
async function userToken(): Promise<string | null> {
  if (authMode() === 'supabase') {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }
  return (await cookies()).get('pb_dev_session')?.value ?? null;
}

/** Server-side call to apps/api as the current user (sensitive actions live there). */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await userToken();
  if (!token) throw new Error('Sesi tidak ditemukan');
  return fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
      authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });
}
