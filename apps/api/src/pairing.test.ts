import { devUserTokenVerifier, randomToken, sha256Hex, signDevUserToken } from '@pb/crypto';
import {
  BoothConfigEvents,
  createBoothFromTemplate,
  createOrg,
  createPairingCode,
  getBooth,
  PairingBusyError,
  publishConfig,
  withUserContext,
  type Db,
} from '@pb/db';
import { createTestDb, createTestUser, seedPlans, seedTemplates } from '@pb/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';

const SECRET = 'test-secret-'.padEnd(48, 'x');

let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createApp>;
let events: BoothConfigEvents;
let userId: string;
let boothId: string;
let userToken: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedPlans(db);
  await seedTemplates(db);
  userId = await createTestUser(db, 'owner@pair.test');
  const orgId = (await withUserContext(db, userId, (tx) => createOrg(tx, { name: 'Org' }))).id;
  boothId = (
    await withUserContext(db, userId, (tx) =>
      createBoothFromTemplate(tx, { orgId, name: 'Booth', timezone: 'Asia/Jakarta', userId }),
    )
  ).id;
  events = new BoothConfigEvents();
  app = createApp({ db, verifyUserToken: devUserTokenVerifier(SECRET), configEvents: events });
  userToken = await signDevUserToken(SECRET, { userId, email: 'owner@pair.test' });
}, 60_000);

afterAll(async () => {
  await close();
});

const post = (path: string, body: unknown, token?: string) =>
  app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

describe('pairing → config → stream', () => {
  const deviceToken = randomToken();
  let code = '';

  it('kiosk starts pairing with a token hash and polls status', async () => {
    const res = await post('/pair/start', {
      tokenHash: sha256Hex(deviceToken),
      fingerprint: 'Chrome/Windows',
    });
    expect(res.status).toBe(201);
    code = ((await res.json()) as { code: string }).code;
    expect(code).toMatch(/^\d{6}$/);
    const status = await (await post('/pair/status', { code, token: deviceToken })).json();
    expect(status).toMatchObject({ status: 'pending' });
    expect((await post('/pair/start', { tokenHash: 'nope', fingerprint: 'x' })).status).toBe(400);
  });

  it('device token does not work before the code is claimed', async () => {
    const res = await app.request('/device/me', {
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('studio user claims the code for their booth', async () => {
    expect((await post('/studio/pairing/claim', { code, boothId, name: 'Laptop' })).status).toBe(
      401,
    );
    const other = await createTestUser(db, 'stranger@pair.test');
    const strangerToken = await signDevUserToken(SECRET, { userId: other, email: null });
    expect(
      (await post('/studio/pairing/claim', { code, boothId, name: 'X' }, strangerToken)).status,
    ).toBe(404);

    const bad = await post(
      '/studio/pairing/claim',
      { code: '999999', boothId, name: 'Laptop' },
      userToken,
    );
    expect(bad.status).toBe(400);
    const res = await post('/studio/pairing/claim', { code, boothId, name: 'Laptop' }, userToken);
    expect(res.status).toBe(201);
    // Studio shows which computer was paired, so a mistyped code is noticed (audit S2).
    expect(await res.json()).toMatchObject({ fingerprint: 'Chrome/Windows' });
    const status = await (await post('/pair/status', { code, token: deviceToken })).json();
    expect(status).toEqual({ status: 'claimed', boothId });
  });

  it('serves the active config with ETag/304, 204 before the first publish', async () => {
    const auth = { authorization: `Bearer ${deviceToken}` };
    expect((await app.request('/device/config', { headers: auth })).status).toBe(204);

    const draft = (await withUserContext(db, userId, (tx) => getBooth(tx, boothId)))!.draft!.config;
    await withUserContext(db, userId, (tx) =>
      publishConfig(tx, { boothId, config: draft, userId }),
    );

    const res = await app.request('/device/config', { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: number; config: { configVersion: number } };
    expect(body.version).toBe(1);
    expect(body.config.configVersion).toBe(1);
    const etag = res.headers.get('etag')!;
    expect(
      (await app.request('/device/config', { headers: { ...auth, 'if-none-match': etag } })).status,
    ).toBe(304);
    expect(res.headers.get('access-control-expose-headers')).toContain('ETag');
  });

  it('streams a config event when the booth publishes', async () => {
    const controller = new AbortController();
    const res = await app.request('/device/stream', {
      headers: { authorization: `Bearer ${deviceToken}` },
      signal: controller.signal,
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await readUntil('event: ready');
    expect(events.size).toBe(1);
    events.emit(boothId);
    await readUntil('event: config');
    expect(text).toContain('event: config');
    controller.abort();
    await reader.cancel().catch(() => {});
  });

  it('records heartbeats', async () => {
    const res = await post(
      '/device/heartbeat',
      { configVersion: 1, appVersion: 'kiosk-test', cameraStatus: 'ok' },
      deviceToken,
    );
    expect(res.status).toBe(200);
  });
});

describe('abuse limits on unauthenticated endpoints (audit S2)', () => {
  it('limits /pair/start per client IP and answers 429 with Retry-After', async () => {
    const limited = createApp({
      db,
      verifyUserToken: devUserTokenVerifier(SECRET),
      configEvents: new BoothConfigEvents(),
    });
    const start = (ip: string) =>
      limited.request('/pair/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ tokenHash: sha256Hex(randomToken()), fingerprint: 'x' }),
      });
    process.env.PB_TRUST_PROXY = '1';
    try {
      for (let i = 0; i < 20; i++) expect((await start('203.0.113.7')).status).toBe(201);
      const blocked = await start('203.0.113.7');
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
      // Another client is not affected.
      expect((await start('198.51.100.9')).status).toBe(201);
    } finally {
      delete process.env.PB_TRUST_PROXY;
    }
  });

  it('refuses new codes when too many are active (keeps the 6-digit space sparse)', async () => {
    await expect(
      createPairingCode(db, { tokenHash: sha256Hex(randomToken()), fingerprint: 'x' }, 1),
    ).rejects.toBeInstanceOf(PairingBusyError);
  });
});
