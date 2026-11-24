import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Second half of the Google Drive OAuth (audit S5). Google → API callback → here, in the owner's
 * browser. The API stores the connection only if the user signed in *here* is the one who pressed
 * "Hubungkan" (the encrypted `state` names them), so a consent link sent to someone else cannot
 * attach their Google account to another org.
 */
export async function GET(req: NextRequest) {
  const back = (result: string) =>
    NextResponse.redirect(new URL(`/integrations?drive=${result}`, req.nextUrl.origin), 302);
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (!code || !state) return back('denied');
  if (!(await getCurrentUser())) return back('wrong_user');

  let result = 'error';
  try {
    const res = await apiFetch('/studio/integrations/google-drive/complete', {
      method: 'POST',
      body: JSON.stringify({ code, state }),
    });
    const body = (await res.json().catch(() => ({}))) as { result?: string };
    result = body.result ?? (res.ok ? 'connected' : 'error');
  } catch {
    result = 'error';
  }
  const response = back(result);
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
