'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { field, type FormState } from '@/lib/form';
import { requireOrg } from '@/lib/org';

async function editorOrg() {
  const ctx = await requireOrg();
  if (ctx.org.role === 'operator') throw new Error('Operator tidak dapat mengatur integrasi.');
  return ctx.org;
}

type ApiBody = { message?: string; url?: string; ok?: boolean; requeued?: number };

async function call(
  path: string,
  init: RequestInit,
): Promise<{ res: Response; body: ApiBody } | null> {
  try {
    const res = await apiFetch(path, init);
    return { res, body: (await res.json().catch(() => ({}))) as ApiBody };
  } catch {
    return null;
  }
}

const DOWN: FormState = { status: 'error', message: 'API tidak dapat dihubungi. Coba lagi.' };

/** Sends the owner to Google's consent screen (scope drive.file only). */
export async function connectDriveAction(): Promise<FormState> {
  const org = await editorOrg();
  const r = await call(`/studio/orgs/${org.id}/integrations/google-drive/connect`, {
    method: 'POST',
  });
  if (!r) return DOWN;
  if (!r.res.ok || !r.body.url)
    return { status: 'error', message: r.body.message ?? `Gagal (HTTP ${r.res.status}).` };
  redirect(r.body.url);
}

export async function disconnectDriveAction(): Promise<FormState> {
  const org = await editorOrg();
  const r = await call(`/studio/orgs/${org.id}/integrations/google-drive`, { method: 'DELETE' });
  if (!r) return DOWN;
  if (!r.res.ok)
    return { status: 'error', message: r.body.message ?? `Gagal (HTTP ${r.res.status}).` };
  revalidatePath('/integrations');
  return {
    status: 'info',
    message: 'Google Drive diputus. File yang sudah ada di Drive tetap aman.',
  };
}

export async function testDriveAction(): Promise<FormState> {
  const org = await editorOrg();
  const r = await call(`/studio/orgs/${org.id}/integrations/google-drive/test`, { method: 'POST' });
  if (!r) return DOWN;
  revalidatePath('/integrations');
  if (!r.res.ok || !r.body.ok)
    return { status: 'error', message: r.body.message ?? `Tes gagal (HTTP ${r.res.status}).` };
  return { status: 'info', message: r.body.message ?? 'Terhubung.' };
}

/** Choose an existing folder (one this app created) or create a new root folder. */
export async function setRootFolderAction(_prev: FormState, form: FormData): Promise<FormState> {
  const org = await editorOrg();
  const mode = field(form, 'mode') === 'existing' ? 'existing' : 'create';
  const payload =
    mode === 'create'
      ? { mode, name: field(form, 'name').trim() }
      : { mode, folderId: field(form, 'folderId') };
  if (mode === 'create' && !field(form, 'name').trim())
    return { status: 'error', message: 'Isi nama folder.' };
  const r = await call(`/studio/orgs/${org.id}/integrations/google-drive/root-folder`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  if (!r) return DOWN;
  if (!r.res.ok)
    return { status: 'error', message: r.body.message ?? `Gagal (HTTP ${r.res.status}).` };
  revalidatePath('/integrations');
  return {
    status: 'info',
    message:
      r.body.requeued && r.body.requeued > 0
        ? `Folder root disimpan. ${r.body.requeued} upload yang tertunda dilanjutkan.`
        : 'Folder root disimpan.',
  };
}
