'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api';
import { isPlatformAdmin } from '@/lib/entitlements';
import { field } from '@/lib/form';
import { requireUser } from '@/lib/auth';

/** The API enforces the admin check too; this stops non-admins before any request is made. */
async function admin() {
  const user = await requireUser();
  if (!isPlatformAdmin(user)) throw new Error('Hanya admin platform.');
}

async function send(path: string, method: 'PUT' | 'POST', body?: unknown) {
  const res = await apiFetch(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(j.message ?? `Gagal (HTTP ${res.status})`);
  }
}

export async function setSubscriptionAction(form: FormData): Promise<void> {
  await admin();
  const orgId = field(form, 'orgId');
  await send(`/admin/orgs/${encodeURIComponent(orgId)}/subscription`, 'PUT', {
    planCode: field(form, 'planCode'),
    status: field(form, 'status'),
    periodDays: Number(field(form, 'periodDays') || '30'),
    note: field(form, 'note') || undefined,
  });
  revalidatePath('/admin');
}

export async function setPriceAction(form: FormData): Promise<void> {
  await admin();
  const raw = field(form, 'priceMonthly').trim();
  await send(`/admin/plans/${encodeURIComponent(field(form, 'code'))}/price`, 'PUT', {
    priceMonthly: raw === '' ? null : Number(raw),
  });
  revalidatePath('/admin');
}

export async function runLifecycleAction(): Promise<void> {
  await admin();
  await send('/admin/billing/run-lifecycle', 'POST');
  revalidatePath('/admin');
}
