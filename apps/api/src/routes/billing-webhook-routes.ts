import { applyInvoicePaid, BillingError, getInvoice, invoiceIdFromOrder } from '@pb/db';
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
    try {
      await applyInvoicePaid(deps.db, invoice.id, {
        providerRef: event.providerRef,
        paidAt: event.paidAt,
        grossAmount: event.grossAmount,
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
