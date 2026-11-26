'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { isPlatformAdmin } from '@/lib/entitlements';

export type TemplateActionResult = { ok: true } | { ok: false; message: string };

async function call(path: string, method: string, body?: unknown): Promise<TemplateActionResult> {
  const user = await requireUser();
  if (!isPlatformAdmin(user)) return { ok: false, message: 'Hanya admin platform.' };
  const res = await apiFetch(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, message: j.message ?? `Gagal (HTTP ${res.status})` };
  }
  revalidatePath('/admin/templates');
  revalidatePath('/booths');
  return { ok: true };
}

/** Booth page (platform admins): the booth's current draft becomes a template. */
export async function saveBoothAsTemplateAction(input: {
  boothId: string;
  name: string;
  description: string;
}): Promise<TemplateActionResult> {
  return call('/admin/templates', 'POST', {
    boothId: input.boothId,
    name: input.name,
    description: input.description.trim() || null,
  });
}

export async function updateTemplateAction(
  id: string,
  patch: { name?: string; description?: string | null; isPublic?: boolean },
): Promise<TemplateActionResult> {
  return call(`/admin/templates/${encodeURIComponent(id)}`, 'PATCH', patch);
}

export async function deleteTemplateAction(id: string): Promise<TemplateActionResult> {
  return call(`/admin/templates/${encodeURIComponent(id)}`, 'DELETE');
}
