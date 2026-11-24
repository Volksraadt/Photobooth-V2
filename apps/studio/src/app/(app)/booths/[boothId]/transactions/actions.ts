'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api';
import { field, type FormState } from '@/lib/form';
import { requireOrg } from '@/lib/org';

/** Manual "Coba lagi" for a session whose file delivery failed (any org member). */
export async function retryUploadAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireOrg();
  const sessionId = field(form, 'sessionId');
  let res: Response;
  try {
    res = await apiFetch(
      `/studio/orgs/${org.id}/sessions/${encodeURIComponent(sessionId)}/retry-upload`,
      { method: 'POST' },
    );
  } catch {
    return { status: 'error', message: 'API tidak dapat dihubungi. Coba lagi.' };
  }
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) return { status: 'error', message: body.message ?? `Gagal (HTTP ${res.status}).` };
  revalidatePath('/booths/[boothId]/transactions', 'page');
  return { status: 'info', message: 'Upload dijadwalkan ulang.' };
}
