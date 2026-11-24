import { randomToken, sha256Hex, signDevUserToken, devUserTokenVerifier } from '@pb/crypto';
import {
  BoothConfigEvents,
  createBooth,
  createOrg,
  devices,
  withUserContext,
  type Db,
} from '@pb/db';
import { createTestDb, createTestUser, seedPlans } from '@pb/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { userTokenVerifierFromEnv } from './config';

const SECRET = 'test-secret-'.padEnd(48, 'x');

let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createApp>;
let deviceToken: string;
let deviceId: string;
let userId: string;
let orgId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedPlans(db);
  userId = await createTestUser(db, 'owner@example.com');
  orgId = (await withUserContext(db, userId, (tx) => createOrg(tx, { name: 'Org' }))).id;
  const booth = await withUserContext(db, userId, (tx) =>
    createBooth(tx, { orgId, name: 'B', userId }),
  );
  deviceToken = randomToken();
  const [d] = await db
    .insert(devices)
    .values({ orgId, boothId: booth.id, name: 'Laptop 1', tokenHash: sha256Hex(deviceToken) })
    .returning({ id: devices.id });
  deviceId = d!.id;
  app = createApp({
    db,
    verifyUserToken: devUserTokenVerifier(SECRET),
    configEvents: new BoothConfigEvents(),
  });
}, 60_000);

afterAll(async () => {
  await close();
});

const get = (path: string, token?: string) =>
  app.request(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe('health', () => {
  it('reports ok when the database answers', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await get('/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});

describe('device auth', () => {
  it('accepts a valid device token and exposes only device identity', async () => {
    const res = await get('/device/me', deviceToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({ id: deviceId, orgId, name: 'Laptop 1' }),
    );
  });

  it('rejects missing, malformed and unknown tokens', async () => {
    expect((await get('/device/me')).status).toBe(401);
    expect(
      (await app.request('/device/me', { headers: { authorization: deviceToken } })).status,
    ).toBe(401);
    expect((await get('/device/me', randomToken())).status).toBe(401);
  });

  it('rejects user tokens on device routes', async () => {
    const userToken = await signDevUserToken(SECRET, { userId, email: 'owner@example.com' });
    expect((await get('/device/me', userToken)).status).toBe(401);
  });

  it('rejects revoked devices', async () => {
    const token = randomToken();
    const [d] = await db
      .insert(devices)
      .values({ orgId, name: 'Old', tokenHash: sha256Hex(token), revokedAt: new Date() })
      .returning({ id: devices.id });
    expect((await get('/device/me', token)).status).toBe(401);
    await db.update(devices).set({ revokedAt: null }).where(eq(devices.id, d!.id));
    expect((await get('/device/me', token)).status).toBe(200);
  });
});

describe('user auth', () => {
  it('accepts a valid user token and returns only the user’s orgs (RLS)', async () => {
    const token = await signDevUserToken(SECRET, { userId, email: 'owner@example.com' });
    const res = await get('/studio/me', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string }; orgs: { id: string }[] };
    expect(body.user.id).toBe(userId);
    expect(body.orgs.map((o) => o.id)).toEqual([orgId]);
  });

  it('a different user sees none of those orgs', async () => {
    const other = await createTestUser(db, 'other@example.com');
    const token = await signDevUserToken(SECRET, { userId: other, email: 'other@example.com' });
    const body = (await (await get('/studio/me', token)).json()) as { orgs: unknown[] };
    expect(body.orgs).toEqual([]);
  });

  it('rejects device tokens, garbage and tokens signed with another secret', async () => {
    expect((await get('/studio/me', deviceToken)).status).toBe(401);
    expect((await get('/studio/me')).status).toBe(401);
    const forged = await signDevUserToken('z'.repeat(48), { userId, email: null });
    expect((await get('/studio/me', forged)).status).toBe(401);
  });
});

describe('config', () => {
  it('refuses dev auth in production', () => {
    expect(() =>
      userTokenVerifierFromEnv({
        PB_AUTH_MODE: 'dev',
        NODE_ENV: 'production',
        DEV_AUTH_SECRET: SECRET,
      }),
    ).toThrow(/not allowed in production/);
  });
  it('requires supabase settings in supabase mode', () => {
    expect(() => userTokenVerifierFromEnv({ PB_AUTH_MODE: 'supabase' })).toThrow(/SUPABASE/);
  });
});
