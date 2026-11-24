import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createId } from '@paralleldrive/cuid2';
import { createApp, createPaymentGateway, type PaymentGateway } from '@pb/api';
import type { AgentToKiosk } from '@pb/capture/protocol';
import {
  createSecretBox,
  devUserTokenVerifier,
  hashVoucherCode,
  signDevUserToken,
} from '@pb/crypto';
import {
  BoothConfigEvents,
  cashApprovals,
  createBoothFromTemplate,
  createOrg,
  getBooth,
  insertVouchers,
  publishConfig,
  sessions,
  vouchers,
  withUserContext,
  type Db,
} from '@pb/db';
import { createTestDb, createTestUser, seedPlans, seedTemplates } from '@pb/db/testing';
import { generateSessionCode, hashAdminPin, type BoothConfig } from '@pb/schema';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Agent } from './agent';
import { DEFAULT_ORIGINS } from './options';

const SECRET = 'test-secret-'.padEnd(48, 'x');
const CODE_A = '1111222233334444';
const CODE_B = '4444555566667777';

let db: Db;
let closeDb: () => Promise<void>;
let app: ReturnType<typeof createApp>;
let api: Server | null = null;
let apiPort = 0;
let gateway: PaymentGateway;
let orgId: string;
let boothId: string;
let userId: string;
let userToken: string;
let dataDir: string;
let agent: Agent;
let local: string;
let config: BoothConfig;
let ws: WebSocket;
const pushes: AgentToKiosk[] = [];

const json = async <T>(res: Response | Promise<Response>): Promise<T> =>
  (await res).json() as Promise<T>;
const until = async <T>(
  fn: () => T | Promise<T>,
  ok: (v: T) => boolean,
  ms = 10_000,
): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`timeout; last: ${JSON.stringify(v)?.slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
const post = (path: string, body: unknown) =>
  fetch(`${local}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

function startApi(): Promise<void> {
  return new Promise((resolve) => {
    api = serve({ fetch: app.fetch, port: apiPort, hostname: '127.0.0.1' }, (info) => {
      apiPort = info.port;
      resolve();
    }) as Server;
  });
}
function stopApi(): Promise<void> {
  return new Promise((resolve) => {
    api!.closeAllConnections?.();
    api!.close(() => resolve());
    api = null;
  });
}

const sessionInfo = () => ({
  id: createId(),
  code: generateSessionCode(),
  startedAt: new Date().toISOString(),
  boothId,
  configVersion: 1,
});
const price = () => config.frames[0]!.price ?? config.pricing.basePrice;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
  await seedPlans(db);
  await seedTemplates(db);
  userId = await createTestUser(db, 'owner@money.test');
  orgId = (await withUserContext(db, userId, (tx) => createOrg(tx, { name: 'Org Money' }))).id;
  boothId = (
    await withUserContext(db, userId, (tx) =>
      createBoothFromTemplate(tx, { orgId, name: 'Booth Money', timezone: 'Asia/Jakarta', userId }),
    )
  ).id;
  gateway = createPaymentGateway({ mode: 'mock', secretBox: createSecretBox(Buffer.alloc(32, 3)) });
  app = createApp({
    db,
    verifyUserToken: devUserTokenVerifier(SECRET),
    configEvents: new BoothConfigEvents(),
    payments: gateway,
  });
  userToken = await signDevUserToken(SECRET, { userId, email: 'owner@money.test' });
  await startApi();
  dataDir = mkdtempSync(join(tmpdir(), 'pb-money-'));
  agent = new Agent({
    dataDir,
    apiBase: `http://127.0.0.1:${apiPort}`,
    shortLinkBase: 'https://pb.test',
    localPort: 0,
    lanPort: 0,
    lanHost: '127.0.0.1',
    advertiseHosts: ['127.0.0.1'],
    allowedOrigins: DEFAULT_ORIGINS,
    printMode: 'virtual',
    telemetry: false,
    configPollMs: 300,
    heartbeatMs: 60_000,
    outboxFlushMs: 60_000,
  });
  agent.telemetry.offlineRetryMs = 60_000; // the test drives reconnection itself
  await agent.start();
  local = `http://127.0.0.1:${agent.localPort}`;

  // Pair + publish a config with an admin PIN (cash approval).
  const pairing = await until(
    () => json<{ status: string; code?: string }>(fetch(`${local}/config/state`)),
    (s) => s.status === 'pairing',
  );
  await fetch(`http://127.0.0.1:${apiPort}/studio/pairing/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ code: pairing.code, boothId, name: 'Laptop' }),
  });
  const draft = (await withUserContext(db, userId, (tx) => getBooth(tx, boothId)))!.draft!.config;
  const withPin: BoothConfig = {
    ...draft,
    admin: { pinHash: await hashAdminPin('2468') },
    flow: { ...draft.flow, paymentMethods: ['qris', 'voucher', 'cash'] },
  };
  await withUserContext(db, userId, (tx) =>
    publishConfig(tx, { boothId, config: withPin, userId }),
  );
  await until(
    () => json<{ status: string }>(fetch(`${local}/config/state`)),
    (s) => s.status === 'ready',
  );
  config = { ...withPin, configVersion: 1 };

  await insertVouchers(db, {
    orgId,
    boothId,
    batchId: 'b',
    note: null,
    valueType: 'full',
    value: 0,
    expiresAt: null,
    codes: [CODE_A, CODE_B].map((c) => ({
      codeHash: hashVoucherCode(boothId, c),
      last4: c.slice(-4),
    })),
    userId,
  });
  await post('/vouchers/sync', {});

  ws = new WebSocket(`${local.replace('http', 'ws')}/ws`);
  ws.on('message', (raw) => pushes.push(JSON.parse(String(raw)) as AgentToKiosk));
  await new Promise((r) => ws.once('open', r));
  await agent.telemetry.beat();
}, 120_000);

afterAll(async () => {
  ws?.close();
  await agent?.stop().catch(() => undefined);
  if (api) await stopApi();
  await closeDb?.();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('online QRIS through the agent', () => {
  it('creates a QRIS and pushes "paid" to the kiosk within 3 s of the webhook', async () => {
    const session = sessionInfo();
    const res = await post('/payments', {
      session,
      frameId: config.frames[0]!.id,
      amount: price(),
      expirySec: 300,
    });
    expect(res.status).toBe(201);
    const payment = (await res.json()) as { id: string; qrString: string; status: string };
    expect(payment.status).toBe('pending');
    expect(payment.qrString).toContain('MOCKQRIS');
    expect(JSON.stringify(payment)).not.toMatch(/server|key|raw/i);

    const t0 = Date.now();
    const n = gateway.mockFor(orgId, 'sandbox')!.simulatePaid(payment.id);
    const hook = await fetch(`http://127.0.0.1:${apiPort}/webhooks/midtrans/${orgId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(n),
    });
    expect(hook.status).toBe(200);
    await until(
      () => pushes,
      (list) =>
        list.some((m) => m.type === 'payment' && m.paymentId === payment.id && m.status === 'paid'),
      3000,
    );
    expect(Date.now() - t0).toBeLessThan(3000);
    const polled = await json<{ status: string }>(fetch(`${local}/payments/${payment.id}`));
    expect(polled.status).toBe('paid');
  });
});

describe('offline: vouchers + cash, synced when back online', () => {
  let s1: ReturnType<typeof sessionInfo>;
  let s2: ReturnType<typeof sessionInfo>;
  let s3: ReturnType<typeof sessionInfo>;
  beforeAll(() => {
    s1 = sessionInfo();
    s2 = sessionInfo();
    s3 = sessionInfo();
  });

  it('detects offline and refuses QRIS', async () => {
    await stopApi();
    await agent.telemetry.beat();
    expect(agent.telemetry.isOnline).toBe(false);
    await until(
      () => pushes,
      (l) => l.some((m) => m.type === 'network' && !m.online),
    );
    const res = await post('/payments', {
      session: s3,
      frameId: config.frames[0]!.id,
      amount: price(),
      expirySec: 300,
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('offline');
  });

  it('accepts a valid voucher once; the same voucher is refused the second time', async () => {
    const first = await json<{ result: string; offline: boolean }>(
      post('/vouchers/redeem', { code: '1111-2222-3333-4444', session: s1, amount: price() }),
    );
    expect(first).toEqual({ result: 'ok', offline: true });
    const again = await json<{ result: string }>(
      post('/vouchers/redeem', { code: CODE_A, session: s2, amount: price() }),
    );
    expect(again.result).toBe('used');
    const bogus = await json<{ result: string }>(
      post('/vouchers/redeem', { code: '9999888877776666', session: s2, amount: price() }),
    );
    expect(bogus.result).toBe('invalid');
  });

  it('approves cash with the booth PIN (wrong PIN refused)', async () => {
    expect(
      (await post('/cash-approvals', { pin: '0000', session: s3, amount: price() })).status,
    ).toBe(403);
    const ok = await post('/cash-approvals', { pin: '2468', session: s3, amount: price() });
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as { offline: boolean }).offline).toBe(true);
  });

  it('completes and prints the voucher session offline', async () => {
    const jpeg = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#3366cc' },
    })
      .jpeg()
      .toBuffer();
    const frame = config.frames[0]!;
    const shots: { slotIndex: number; photoId: string }[] = [];
    for (const slot of frame.slots) {
      const q = new URLSearchParams({
        code: s1.code,
        boothId,
        configVersion: '1',
        startedAt: s1.startedAt,
        slotIndex: String(slot.index),
        takeNumber: '1',
        source: 'mock',
      });
      const r = await json<{ photoId: string }>(
        fetch(`${local}/sessions/${s1.id}/shots?${q}`, {
          method: 'POST',
          headers: { 'content-type': 'image/jpeg' },
          body: jpeg,
        }),
      );
      shots.push({ slotIndex: slot.index, photoId: r.photoId });
    }
    const res = await post('/process', {
      config,
      session: {
        id: s1.id,
        code: s1.code,
        startedAt: s1.startedAt,
        frameId: frame.id,
        filterId: config.filters[0]!.id,
        paymentMethod: 'voucher',
        amount: price(),
        extraPrints: 0,
        downloadUrl: `https://pb.test/s/${s1.code}`,
        shots,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      printJob: { status: string } | null;
      printError: string | null;
    };
    expect(body.printError).toBeNull();
    expect(body.printJob?.status).toBe('done');
  }, 60_000);

  it('after reconnecting, the session, voucher use and cash approval appear in the API', async () => {
    expect(await db.select().from(sessions).where(eq(sessions.id, s1.id))).toHaveLength(0);
    await startApi();
    await agent.telemetry.beat();
    expect(agent.telemetry.isOnline).toBe(true);
    await agent.telemetry.flush();
    const [row] = await db.select().from(sessions).where(eq(sessions.id, s1.id));
    expect(row).toMatchObject({
      code: s1.code,
      status: 'completed',
      paymentMethod: 'voucher',
      offline: true,
    });
    const [v] = await db.select().from(vouchers).where(eq(vouchers.usedSessionId, s1.id));
    expect(v).toMatchObject({ usedOffline: true, codeLast4: '4444' });
    const cash = await db.select().from(cashApprovals).where(eq(cashApprovals.sessionId, s3.id));
    expect(cash).toHaveLength(1);
    expect(agent.store.outboxCount()).toBe(0);
  });
});
