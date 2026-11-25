'use server';

import type { PhotoSlot } from '@pb/schema';
import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { isPlatformAdmin } from '@/lib/entitlements';

export type LibraryActionResult = { ok: true } | { ok: false; message: string };

async function call(path: string, method: string, body?: unknown): Promise<LibraryActionResult> {
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
  revalidatePath('/admin/frames');
  return { ok: true };
}

export async function createLibraryFrameAction(input: {
  name: string;
  description?: string | null;
  url: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  width: number | null;
  height: number | null;
  slots: PhotoSlot[];
  isPublished: boolean;
}): Promise<LibraryActionResult> {
  return call('/admin/library-frames', 'POST', input);
}

export async function updateLibraryFrameAction(
  id: string,
  patch: { name?: string; isPublished?: boolean; sortOrder?: number },
): Promise<LibraryActionResult> {
  return call(`/admin/library-frames/${encodeURIComponent(id)}`, 'PATCH', patch);
}

export async function deleteLibraryFrameAction(id: string): Promise<LibraryActionResult> {
  return call(`/admin/library-frames/${encodeURIComponent(id)}`, 'DELETE');
}
