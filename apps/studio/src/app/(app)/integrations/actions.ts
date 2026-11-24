'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api';
import { field, type FormState } from '@/lib/form';
import { requireOrg } from '@/lib/org';

async function editorOrg() {
  const ctx = await requireOrg();
  if (ctx.org.role === 'operator') throw new Error('Operator tidak dapat mengatur integrasi.');
  return ctx.org;
}

/**
 * Saves Midtrans credentials through apps/api (which encrypts the server key). Studio never stores
 * or reads the key back; an empty field keeps the stored one.
 */
export async function saveMidtransAction(_prev: FormState, form: FormData): Promise<FormState> {
  const org = await editorOrg();
  const env = field(form, 'env') === 'production' ? 'production' : 'sandbox';
  const serverKey = field(form, 'serverKey').trim();
  let res: Response;
  try {
    res = await apiFetch(`/studio/orgs/${org.id}/integrations/midtrans`, {
      method: 'PUT',
      body: JSON.stringify({
        env,
        ...(serverKey ? { serverKey } : {}),
        clientKey: field(form, 'clientKey').trim(),
        merchantId: field(form, 'merchantId').trim(),
        active: field(form, 'active') === 'on',
      }),
    });
  } catch {
    return { status: 'error', message: 'API tidak dapat dihubungi. Coba lagi.' };
  }
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok)
    return { status: 'error', message: body.message ?? `Gagal menyimpan (HTTP ${res.status}).` };
  revalidatePath('/integrations');
  return {
    status: 'info',
    message: `Kredensial ${env === 'sandbox' ? 'Sandbox' : 'Production'} tersimpan terenkripsi. Jalankan Tes koneksi.`,
  };
}

export async function testMidtransAction(_prev: FormState, form: FormData): Promise<FormState> {
  const org = await editorOrg();
  const env = field(form, 'env') === 'production' ? 'production' : 'sandbox';
  let res: Response;
  try {
    res = await apiFetch(`/studio/orgs/${org.id}/integrations/midtrans/test`, {
      method: 'POST',
      body: JSON.stringify({ env }),
    });
  } catch {
    return { status: 'error', message: 'API tidak dapat dihubungi. Coba lagi.' };
  }
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  revalidatePath('/integrations');
  if (!res.ok || !body.ok) {
    return { status: 'error', message: body.message ?? `Tes koneksi gagal (HTTP ${res.status}).` };
  }
  return { status: 'info', message: body.message ?? 'Terhubung.' };
}
