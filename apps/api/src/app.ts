import { listMyOrgs, withUserContext } from '@pb/db';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { deviceAuth } from './middleware/device-auth';
import { userAuth } from './middleware/user-auth';
import type { AppDeps, AppEnv } from './types';

export type { AppDeps } from './types';

export function createApp(deps: AppDeps) {
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

  // --- Device API (Kiosk / Agent). Device token auth; every query scoped to c.var.device.orgId.
  const device = new Hono<AppEnv>();
  device.use('*', deviceAuth);
  device.get('/me', (c) => {
    const d = c.var.device;
    return c.json({ id: d.id, name: d.name, orgId: d.orgId, boothId: d.boothId });
  });
  app.route('/device', device);

  // --- Studio-facing API (sensitive actions). User token auth; DB access via RLS.
  const studio = new Hono<AppEnv>();
  studio.use('*', userAuth);
  studio.get('/me', async (c) => {
    const user = c.var.user;
    const orgs = await withUserContext(deps.db, user.userId, (tx) => listMyOrgs(tx));
    return c.json({ user: { id: user.userId, email: user.email }, orgs });
  });
  app.route('/studio', studio);

  return app;
}
