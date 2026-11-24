import { getInvoice, invoiceOrderId, payments } from '@pb/db';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { AccessTokenCache } from '@pb/drive';
import { MemoryStorage } from '@pb/storage';
import { DISABLED_BILLING } from './billing/gateway';
import { RateLimiter, rateLimit } from './middleware/rate-limit';
import { DeviceSignals } from './payments/device-signals';
import { createPaymentGateway } from './payments/gateway';
import { deviceRoutes, pairRoutes } from './routes/device-routes';
import { adminRoutes } from './routes/admin-routes';
import { billingWebhookRoutes } from './routes/billing-webhook-routes';
import { googleOAuthRoutes } from './routes/drive-routes';
import { shortLinkRoutes } from './routes/short-link-routes';
import { studioRoutes } from './routes/studio-routes';
import { webhookRoutes } from './routes/webhook-routes';
import type { AppDeps, AppEnv, ResolvedDeps } from './types';

export type { AppDeps } from './types';
export { DeviceSignals } from './payments/device-signals';
export { createPaymentGateway, encryptCredential, type PaymentGateway } from './payments/gateway';

export function createApp(input: AppDeps) {
  const secretBox = input.secretBox ?? null;
  const deps: ResolvedDeps = {
    ...input,
    secretBox,
    payments: input.payments ?? createPaymentGateway({ mode: 'midtrans', secretBox }),
    deviceSignals: input.deviceSignals ?? new DeviceSignals(),
    publicApiUrl: input.publicApiUrl ?? null,
    storage: input.storage ?? new MemoryStorage(),
    google: input.google ?? null,
    driveTokens: input.driveTokens ?? new AccessTokenCache(),
    jobs: input.jobs ?? { wake: async () => undefined },
    studioUrl: input.studioUrl ?? 'http://localhost:3000',
    billing: input.billing ?? DISABLED_BILLING,
    platformAdmins: (input.platformAdmins ?? []).map((e) => e.trim().toLowerCase()),
    rateLimiter: input.rateLimiter ?? new RateLimiter(),
  };
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error('[api] unhandled error', err);
    return c.json({ error: 'internal_error' }, 500);
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  // Kiosks run on another origin (Tauri / dev server). Token auth only, no cookies.
  const kioskCors = cors({
    origin: '*',
    allowHeaders: [
      'Authorization',
      'Content-Type',
      'If-None-Match',
      'X-Pb-Kind',
      'X-Pb-Name',
      'X-Pb-Sha256',
      'X-Pb-Slot',
    ],
    exposeHeaders: ['ETag'],
    allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  });
  app.use('/device/*', kioskCors);
  app.use('/pair/*', kioskCors);

  // Unauthenticated endpoints get per-IP limits (audit S2). Generous enough for many kiosks
  // behind one venue NAT: a pairing kiosk polls /pair/status every 2 s and restarts every 10 min.
  app.use('/pair/start', rateLimit('pair-start', 20, 10 * 60_000));
  app.use('/pair/status', rateLimit('pair-status', 600, 60_000));
  app.use('/webhooks/*', rateLimit('webhooks', 600, 60_000));
  app.use('/oauth/*', rateLimit('oauth', 30, 60_000));
  app.use('/s/*', rateLimit('short-link', 120, 60_000));

  app.get('/health', async (c) => {
    let db: 'ok' | 'error' = 'ok';
    try {
      await deps.db.execute(sql`select 1`);
    } catch {
      db = 'error';
    }
    return c.json(
      { status: db === 'ok' ? 'ok' : 'degraded', db, time: new Date().toISOString() },
      db === 'ok' ? 200 : 503,
    );
  });

  app.route('/pair', pairRoutes());
  app.route('/device', deviceRoutes());
  app.route('/studio', studioRoutes());
  app.route('/webhooks', webhookRoutes());
  app.route('/webhooks', billingWebhookRoutes());
  app.route('/admin', adminRoutes());
  app.route('/oauth/google', googleOAuthRoutes());
  app.route('/s', shortLinkRoutes());

  // Dev only (PB_PAYMENT_PROVIDER=mock): "the buyer paid" → a signed notification through the
  // real webhook path. Never available with the real Midtrans gateway.
  if (deps.payments.mode === 'mock' && process.env.NODE_ENV !== 'production') {
    app.post('/dev/payments/:id/simulate-paid', async (c) => {
      const [p] = await deps.db
        .select()
        .from(payments)
        .where(eq(payments.id, c.req.param('id')));
      if (!p) return c.json({ error: 'not_found' }, 404);
      const mock = deps.payments.mockFor(p.orgId, p.env ?? 'sandbox');
      if (!mock) return c.json({ error: 'not_mock' }, 400);
      const notification = mock.simulatePaid(p.orderId);
      const res = await app.request(`/webhooks/midtrans/${p.orgId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(notification),
      });
      return c.json({ webhookStatus: res.status }, res.ok ? 200 : 502);
    });
  }

  // Dev only (PB_BILLING_PROVIDER=mock): "the owner paid the invoice", through the real webhook.
  if (deps.billing.mode === 'mock' && process.env.NODE_ENV !== 'production') {
    app.post('/dev/billing/invoices/:id/simulate-paid', async (c) => {
      const invoice = await getInvoice(deps.db, c.req.param('id'));
      if (!invoice || !invoice.attempts) return c.json({ error: 'not_charged' }, 404);
      const orderId = invoiceOrderId(invoice.id, invoice.attempts);
      const notification = deps.billing.mock!.simulatePaid(orderId);
      const res = await app.request('/webhooks/billing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(notification),
      });
      return c.json({ webhookStatus: res.status }, res.ok ? 200 : 502);
    });
  }

  return app;
}
