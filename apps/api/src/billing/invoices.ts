import {
  applyInvoicePaid,
  beginInvoiceCharge,
  BillingError,
  getInvoice,
  invoiceOrderId,
  saveInvoiceCharge,
  touchInvoiceChecked,
  type InvoiceRow,
} from '@pb/db';
import { PaymentProviderError } from '@pb/payments';
import type { ResolvedDeps } from '../types';

/** QR validity for a subscription invoice: the owner pays from the Studio page, not on the spot. */
export const INVOICE_QR_EXPIRY_SEC = 3600;
const POLL_MIN_MS = 3000;

export class BillingUnavailableError extends Error {
  constructor() {
    super('Pembayaran langganan belum tersedia: akun Midtrans platform belum dikonfigurasi.');
    this.name = 'BillingUnavailableError';
  }
}

/**
 * Makes sure a pending invoice has a QRIS that is still valid, charging the PLATFORM's Midtrans
 * account (a new attempt id each time, so a stale QR can never be paid onto a new charge).
 */
export async function ensureInvoiceCharge(
  deps: ResolvedDeps,
  invoice: InvoiceRow,
  now = new Date(),
) {
  const provider = deps.billing.provider;
  if (!provider) throw new BillingUnavailableError();
  if (invoice.status !== 'pending') return invoice;
  if (
    invoice.qrString &&
    invoice.qrExpiresAt &&
    invoice.qrExpiresAt.getTime() > now.getTime() + 60_000
  )
    return invoice;
  const attempt = await beginInvoiceCharge(deps.db, invoice.id);
  const charge = await provider.createQris({
    orderId: invoiceOrderId(invoice.id, attempt.attempts),
    amount: invoice.amount,
    expirySec: INVOICE_QR_EXPIRY_SEC,
    notificationUrl: deps.publicApiUrl ? `${deps.publicApiUrl}/webhooks/billing` : null,
  });
  await saveInvoiceCharge(deps.db, invoice.id, {
    qrString: charge.qrString,
    expiresAt: charge.expiresAt,
    providerRef: charge.providerRef,
    env: deps.billing.env,
  });
  return (await getInvoice(deps.db, invoice.id))!;
}

/**
 * Polling fallback while the owner looks at the QR: asks the provider at most every few seconds
 * whether a recent attempt was paid (the webhook normally arrives first).
 */
export async function refreshInvoice(deps: ResolvedDeps, invoice: InvoiceRow, now = new Date()) {
  const provider = deps.billing.provider;
  if (!provider || invoice.status !== 'pending' || invoice.attempts === 0) return invoice;
  if (invoice.lastCheckedAt && now.getTime() - invoice.lastCheckedAt.getTime() < POLL_MIN_MS)
    return invoice;
  await touchInvoiceChecked(deps.db, invoice.id, now);
  for (let n = invoice.attempts; n >= Math.max(1, invoice.attempts - 2); n--) {
    let status;
    try {
      status = await provider.getStatus(invoiceOrderId(invoice.id, n));
    } catch (err) {
      if (err instanceof PaymentProviderError) return invoice;
      throw err;
    }
    if (status?.status === 'paid') {
      try {
        const r = await applyInvoicePaid(deps.db, invoice.id, {
          providerRef: status.providerRef,
          paidAt: status.paidAt,
          grossAmount: status.grossAmount,
        });
        return r.invoice;
      } catch (err) {
        if (err instanceof BillingError && err.code === 'amount_mismatch') return invoice;
        throw err;
      }
    }
  }
  return invoice;
}

export function invoiceView(
  inv: InvoiceRow,
  plan: { code: string | null; name: string | null },
  now = new Date(),
) {
  const qrLive =
    inv.status === 'pending' && inv.qrString && inv.qrExpiresAt && inv.qrExpiresAt > now;
  return {
    id: inv.id,
    status: inv.status,
    kind: inv.kind,
    planCode: plan.code,
    planName: plan.name,
    amount: inv.amount,
    periodStart: inv.periodStart?.toISOString() ?? null,
    periodEnd: inv.periodEnd?.toISOString() ?? null,
    dueAt: inv.dueAt?.toISOString() ?? null,
    paidAt: inv.paidAt?.toISOString() ?? null,
    createdAt: inv.createdAt.toISOString(),
    qrString: qrLive ? inv.qrString : null,
    qrExpiresAt: qrLive ? inv.qrExpiresAt!.toISOString() : null,
    /** A QR was issued but is no longer payable (vs. never issued, e.g. a worker-made renewal). */
    qrExpired: inv.status === 'pending' && !!inv.qrString && !qrLive,
  };
}
