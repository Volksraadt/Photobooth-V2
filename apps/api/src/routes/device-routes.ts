import { sha256Hex } from '@pb/crypto';
import {
  activeConfigForDevice,
  createPairingCode,
  pairingStatus,
  recordDeviceOutbox,
  recordHeartbeat,
} from '@pb/db';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { deviceAuth } from '../middleware/device-auth';
import type { AppEnv } from '../types';

const PairStartBody = z.object({
  /** sha256 hex of the token the kiosk generated (never the token itself). */
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  fingerprint: z.string().min(1).max(200),
});

const PairStatusBody = z.object({
  code: z.string().regex(/^\d{6}$/),
  token: z.string().min(32).max(256),
});

const HeartbeatBody = z.object({
  configVersion: z.number().int().nonnegative().nullable().optional(),
  appVersion: z.string().max(100).nullable().optional(),
  platform: z.string().max(100).nullable().optional(),
  cameraStatus: z.enum(['ok', 'error', 'disconnected', 'unknown']).optional(),
  printerStatus: z.enum(['ok', 'warning', 'error', 'disconnected', 'unknown']).optional(),
});

const OutboxId = z.string().regex(/^[a-z0-9]{8,64}$/);
const IsoTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

/** Agent outbox batch (F3): device_events + print_jobs, idempotent by outbox id. */
const OutboxBody = z.object({
  events: z
    .array(
      z.object({
        id: OutboxId,
        level: z.enum(['info', 'warn', 'error']),
        kind: z.string().min(1).max(64),
        message: z.string().max(2000).nullable(),
        data: z.unknown(),
        occurredAt: IsoTime,
      }),
    )
    .max(200),
  printJobs: z
    .array(
      z.object({
        id: OutboxId,
        sessionCode: z.string().max(16).nullable(),
        sheets: z.number().int().min(0).max(1000),
        status: z.enum(['queued', 'printing', 'done', 'failed']),
        occurredAt: IsoTime,
      }),
    )
    .max(200),
});

/** Unauthenticated pairing endpoints (a kiosk has no token yet). */
export function pairRoutes() {
  const app = new Hono<AppEnv>();

  app.post('/start', async (c) => {
    const body = PairStartBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body' }, 400);
    const { code, expiresAt } = await createPairingCode(c.var.deps.db, body.data);
    return c.json({ code, expiresAt: expiresAt.toISOString() }, 201);
  });

  app.post('/status', async (c) => {
    const body = PairStatusBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body' }, 400);
    const status = await pairingStatus(c.var.deps.db, body.data.code, sha256Hex(body.data.token));
    return c.json(status);
  });

  return app;
}

/** Device-token endpoints. Every query is scoped to c.var.device (its org and booth). */
export function deviceRoutes() {
  const app = new Hono<AppEnv>();
  app.use('*', deviceAuth);

  app.get('/me', (c) => {
    const d = c.var.device;
    return c.json({ id: d.id, name: d.name, orgId: d.orgId, boothId: d.boothId });
  });

  /** Active config; ETag = config id so polling is cheap (304). */
  app.get('/config', async (c) => {
    const active = await activeConfigForDevice(c.var.deps.db, c.var.device);
    if (!active) return c.body(null, 204);
    const etag = `"${active.id}"`;
    c.header('ETag', etag);
    c.header('Cache-Control', 'no-cache');
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    return c.json({ id: active.id, version: active.version, config: active.config });
  });

  /** Server-sent events: `config` whenever the booth publishes. Keep-alive every 20 s. */
  app.get('/stream', (c) => {
    const { device, deps } = c.var;
    return streamSSE(c, async (stream) => {
      let wake: (() => void) | null = null;
      let pending = 0;
      const unsubscribe = device.boothId
        ? deps.configEvents.subscribe(device.boothId, () => {
            pending++;
            wake?.();
          })
        : () => {};
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      await stream.writeSSE({ event: 'ready', data: JSON.stringify({ boothId: device.boothId }) });
      while (!stream.aborted) {
        if (pending > 0) {
          pending = 0;
          await stream.writeSSE({
            event: 'config',
            data: JSON.stringify({ at: new Date().toISOString() }),
          });
          continue;
        }
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 20_000);
          wake = () => {
            clearTimeout(t);
            resolve();
          };
        });
        wake = null;
        if (pending === 0 && !stream.aborted) await stream.write(': keep-alive\n\n');
      }
      unsubscribe();
    });
  });

  app.post('/heartbeat', async (c) => {
    const body = HeartbeatBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body' }, 400);
    await recordHeartbeat(c.var.deps.db, c.var.device, body.data);
    return c.json({ ok: true, time: new Date().toISOString() });
  });

  app.post('/events', async (c) => {
    const body = OutboxBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body', issues: body.error.issues }, 400);
    const accepted = await recordDeviceOutbox(c.var.deps.db, c.var.device, body.data);
    return c.json({ accepted });
  });

  return app;
}
