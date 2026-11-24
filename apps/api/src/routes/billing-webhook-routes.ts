import { applyInvoicePaid, BillingError, getInvoice, invoiceIdFromOrder } from '@pb/db';
import { PaymentProviderError } from '@pb/payments';
import { Hono } from 'hono';
import type { AppEnv } from '../types';

/**
 * `POST /webhooks/billing`: Midtrans notifications of the PLATFORM account (subscription
 * invoices). Verified with the platform server key; the order id is `<invoice id>-<attempt>`.
 * Idempotent: a repeated notification changes nothing. Responses carry no invoice data.
 */
export function billingWebhookRoutes() {
  const app = new Hono<AppEnv>();

  app.post('/billing', async (c) => {
    const { deps } = c.var;
    const provider = deps.billing.provider;
    if (!provider) return c.json({ error: 'billing_disabled' }, 404);
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const orderId = body && typeof body.order_id === 'string' ? body.order_id : null;
    if (!body || !orderId || orderId.length > 80) return c.json({ error: 'invalid_body' }, 400);

    const event = await provider.verifyWebhook(c.req.raw.headers, body);
    if (!event) {
      console.warn(`[api] billing webhook rejected (bad signature) order=${orderId}`);
      return c.json({ error: 'invalid_signature' }, 401);
    }
    const invoiceId = invoiceIdFromOrder(orderId);
    const invoice = invoiceId ? await getInvoice(deps.db, invoiceId) : null;
    // Valid but not an invoice of ours (dashboard "test notification"): acknowledge, do not retry.
    if (!invoice) return c.json({ ok: true, ignored: true });
    if (event.status !== 'paid') return c.json({ ok: true });
    // Signed fields do not include the status: confirm with Midtrans before activating (audit S1).
    let confirmed: Awaited<ReturnType<typeof provider.getStatus>>;
    try {
      confirmed = await provider.getStatus(orderId);
    } catch (err) {
      if (!(err instanceof PaymentProviderError)) throw err;
      console.warn(`[api] billing webhook: status check failed order=${orderId}`);
      return c.json({ error: 'status_unavailable' }, 503);
    }
    if (confirmed?.status !== 'paid') {
      console.warn(`[api] billing webhook: paid not confirmed order=${orderId}`);
      return c.json({ ok: true, ignored: true });
    }
    try {
      await applyInvoicePaid(deps.db, invoice.id, {
        providerRef: confirmed.providerRef ?? event.providerRef,
        paidAt: confirmed.paidAt ?? event.paidAt,
        grossAmount: confirmed.grossAmount ?? event.grossAmount,
      });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof BillingError && err.code === 'amount_mismatch') {
        console.warn(`[api] billing webhook amount mismatch order=${orderId}`);
        return c.json({ error: 'amount_mismatch' }, 400);
      }
      throw err;
    }
  });

  return app;
}
