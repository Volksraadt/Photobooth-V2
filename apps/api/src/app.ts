import { payments } from '@pb/db';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { DeviceSignals } from './payments/device-signals';
import { createPaymentGateway } from './payments/gateway';
import { deviceRoutes, pairRoutes } from './routes/device-routes';
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
    allowHeaders: ['Authorization', 'Content-Type', 'If-None-Match'],
    exposeHeaders: ['ETag'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  });
  app.use('/device/*', kioskCors);
  app.use('/pair/*', kioskCors);

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

  return app;
}
