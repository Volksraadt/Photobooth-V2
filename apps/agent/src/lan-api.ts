import type { CameraPairResponse } from '@pb/capture/protocol';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { z } from 'zod';
import type { Agent } from './agent';
import { ImageRejectedError } from './sessions';

/**
 * LAN server for the tablet Camera App (all interfaces). Only `/camera/*`; everything except
 * `ping` and the one-time `pair` exchange needs the camera token.
 */
export function createLanApi(agent: Agent) {
  const app = new Hono();
  // Camera App origins: capacitor://localhost (iOS), https://localhost (Android), dev servers.
  // Token auth, no cookies → any origin.
  app.use(
    '/camera/*',
    cors({
      origin: '*',
      allowHeaders: ['Authorization', 'Content-Type', 'X-Pb-Captured-At'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
    }),
  );

  app.onError((err, c) => {
    if (err instanceof ImageRejectedError)
      return c.json({ error: 'bad_image', message: err.message }, 415);
    console.error('[agent] lan api error', err);
    return c.json({ error: 'internal_error' }, 500);
  });

  app.get('/camera/ping', (c) => c.json({ ok: true, agentId: agent.id }));

  app.post('/camera/pair', async (c) => {
    const body = z
      .object({
        code: z.string().regex(/^[a-f0-9]{32}$/),
        name: z.string().max(80),
        platform: z.string().max(40),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body' }, 400);
    const res: CameraPairResponse | null = agent.camera.pair(
      body.data.code,
      body.data.name,
      body.data.platform,
    );
    if (!res)
      return c.json(
        { error: 'invalid_code', message: 'Kode pairing tidak valid atau kedaluwarsa.' },
        403,
      );
    return c.json(res, 201);
  });

  app.post('/camera/shots', bodyLimit({ maxSize: 60 * 1024 * 1024 }), async (c) => {
    const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
    if (!agent.camera.authenticate(token)) return c.json({ error: 'unauthorized' }, 401);
    const requestId = c.req.query('requestId');
    if (!requestId) return c.json({ error: 'missing_request_id' }, 400);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const res = await agent.camera.receiveShot(
      requestId,
      bytes,
      c.req.header('x-pb-captured-at') ?? undefined,
    );
    if (res.status === 'unknown') {
      // Not a request this agent made (e.g. agent restarted): tell the tablet to drop it.
      return c.json({ status: 'unknown' }, 409);
    }
    return c.json({
      status: res.status,
      photoId: res.file!.id,
      width: res.file!.width,
      height: res.file!.height,
    });
  });

  return app;
}
