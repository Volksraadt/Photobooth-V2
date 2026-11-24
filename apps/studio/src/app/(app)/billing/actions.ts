'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api';
import { requireOrg } from '@/lib/org';

export type InvoiceView = {
  id: string;
  status: 'pending' | 'paid' | 'expired' | 'failed' | 'void';
  kind: string;
  planCode: string | null;
  planName: string | null;
  amount: number;
  periodStart: string | null;
  periodEnd: string | null;
  dueAt: string | null;
  createdAt: string;
  paidAt: string | null;
  qrString: string | null;
  qrExpiresAt: string | null;
};

export type CheckoutResult = { ok: true; invoice: InvoiceView } | { ok: false; message: string };

async function owner() {
  const { org } = await requireOrg();
  if (org.role === 'operator')
    throw new Error('Hanya owner/manager yang dapat mengelola langganan.');
  return org;
}

async function call(path: string, init: RequestInit): Promise<CheckoutResult> {
  let res: Response;
  try {
    res = await apiFetch(path, init);
  } catch {
    return { ok: false, message: 'API tidak dapat dihubungi. Coba lagi.' };
  }
  const body = (await res.json().catch(() => ({}))) as { invoice?: InvoiceView; message?: string };
  if (!res.ok || !body.invoice)
    return { ok: false, message: body.message ?? `Gagal (HTTP ${res.status}).` };
  return { ok: true, invoice: body.invoice };
}

/** Creates the invoice for a plan and its QRIS (paid to the platform's Midtrans account). */
export async function startCheckoutAction(planCode: 'pro' | 'business'): Promise<CheckoutResult> {
  const org = await owner();
  return call(`/studio/orgs/${org.id}/billing/checkout`, {
    method: 'POST',
    body: JSON.stringify({ planCode }),
  });
}

/** Polled while the QR is on screen. */
export async function pollInvoiceAction(invoiceId: string): Promise<CheckoutResult> {
  const { org } = await requireOrg();
  const r = await call(`/studio/orgs/${org.id}/billing/invoices/${encodeURIComponent(invoiceId)}`, {
    method: 'GET',
  });
  if (r.ok && r.invoice.status === 'paid') {
    revalidatePath('/', 'layout');
  }
  return r;
}

/** New QR for the same invoice (the previous one expired). */
export async function renewQrAction(invoiceId: string): Promise<CheckoutResult> {
  const org = await owner();
  return call(`/studio/orgs/${org.id}/billing/invoices/${encodeURIComponent(invoiceId)}/pay`, {
    method: 'POST',
  });
}
