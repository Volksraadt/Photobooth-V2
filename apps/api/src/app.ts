import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { deviceRoutes, pairRoutes } from './routes/device-routes';
import { studioRoutes } from './routes/studio-routes';
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

  return app;
}
