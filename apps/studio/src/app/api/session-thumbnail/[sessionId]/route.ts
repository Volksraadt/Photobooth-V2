import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api';
import { requireOrg } from '@/lib/org';

export const dynamic = 'force-dynamic';

/** Printed strip of a session, fetched from apps/api (private storage) as the signed-in user. */
export async function GET(_req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await ctx.params;
  const { org } = await requireOrg();
  const res = await apiFetch(
    `/studio/orgs/${org.id}/sessions/${encodeURIComponent(sessionId)}/thumbnail`,
  ).catch(() => null);
  if (!res?.ok) return NextResponse.json({ message: 'Tidak tersedia' }, { status: 404 });
  return new Response(res.body, {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'image/jpeg',
      'cache-control': 'private, max-age=300',
    },
  });
}
