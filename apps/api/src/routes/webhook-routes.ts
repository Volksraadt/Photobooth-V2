import { applyPaymentStatus, getPaymentByOrder, PaymentRepoError } from '@pb/db';
import { Hono } from 'hono';
import type { AppEnv } from '../types';

/**
 * `POST /webhooks/midtrans/:orgId` — buyer payment notifications for one owner.
 * Signature verified with that owner's server key (the env the charge was made with).
 * Idempotent: duplicates of a final status change nothing. Responses carry no payment data.
 */
export function webhookRoutes() {
  const app = new Hono<AppEnv>();

  app.post('/midtrans/:orgId', async (c) => {
    const { deps } = c.var;
    const orgId = c.req.param('orgId');
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const orderId = body && typeof body.order_id === 'string' ? body.order_id : null;
    if (!body || !orderId || orderId.length > 64) return c.json({ error: 'invalid_body' }, 400);

    const payment = await getPaymentByOrder(deps.db, orgId, orderId);
    const resolved = await deps.payments.forOrg(deps.db, orgId, payment?.env ?? null);
    if (!resolved) return c.json({ error: 'unknown_merchant' }, 404);

    const event = await resolved.provider.verifyWebhook(c.req.raw.headers, body);
    if (!event) {
      // Never log the body: it is attacker-controlled; ids are enough to investigate.
      console.warn(`[api] midtrans webhook rejected (bad signature) org=${orgId} order=${orderId}`);
      return c.json({ error: 'invalid_signature' }, 401);
    }
    // Valid but not ours (e.g. dashboard "test notification"): acknowledge so it is not retried.
    if (!payment) return c.json({ ok: true, ignored: true });

    try {
      const res = await applyPaymentStatus(deps.db, orgId, payment.id, {
        ...event,
        source: 'webhook',
      });
      if (res.changed) {
        deps.deviceSignals.emit(res.payment.deviceId, {
          paymentId: res.payment.id,
          status: res.payment.status,
        });
      }
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof PaymentRepoError && err.code === 'amount_mismatch') {
        console.warn(`[api] midtrans webhook amount mismatch org=${orgId} order=${orderId}`);
        return c.json({ error: 'amount_mismatch' }, 400);
      }
      throw err;
    }
  });

  return app;
}
