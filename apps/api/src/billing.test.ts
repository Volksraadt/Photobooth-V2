import {
  createSecretBox,
  devUserTokenVerifier,
  randomToken,
  sha256Hex,
  signDevUserToken,
} from '@pb/crypto';
import {
  adminSetSubscription,
  BoothConfigEvents,
  createBoothFromTemplate,
  createOrg,
  devices,
  paymentCredentials,
  PlanLimitError,
  resolveEntitlements,
  setPlanPrice,
  withUserContext,
  listLibraryFrames,
  type Db,
} from '@pb/db';
import { createTestDb, createTestUser, seedPlans } from '@pb/db/testing';
import { midtransSignature } from '@pb/payments';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { createBillingGateway } from './billing/gateway';
import { encryptCredential } from './payments/gateway';

const SECRET = 'test-secret-'.padEnd(48, 'x');
const box = createSecretBox(Buffer.alloc(32, 9));

let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createApp>;
let userId: string;
let userToken: string;
let adminToken: string;
let outsiderToken: string;
const platformGateway = createBillingGateway({ mode: 'mock' });
const platformMock = platformGateway.mock!;

const call = (path: string, init: RequestInit & { token?: string } = {}) =>
  app.request(`http://api.test${path}`, {
    ...init,
    headers: {
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
// Test helper: response bodies are inspected loosely on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as Record<string, any>;

async function newOrg(name: string, plan: 'starter' | 'pro' = 'starter') {
  const id = (await withUserContext(db, userId, (tx) => createOrg(tx, { name }))).id;
  await adminSetSubscription(db, { orgId: id, planCode: plan, status: 'active', actorId: null });
  return id;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedPlans(db);
  await setPlanPrice(db, { code: 'pro', priceMonthly: 150_000, actorId: null });
  userId = await createTestUser(db, 'owner@f6-api.test');
  const outsider = await createTestUser(db, 'outsider@f6-api.test');
  const admin = await createTestUser(db, 'admin@platform.test');
  userToken = await signDevUserToken(SECRET, { userId, email: 'owner@f6-api.test' });
  outsiderToken = await signDevUserToken(SECRET, {
    userId: outsider,
    email: 'outsider@f6-api.test',
  });
  adminToken = await signDevUserToken(SECRET, { userId: admin, email: 'Admin@Platform.test' });
  app = createApp({
    db,
    verifyUserToken: devUserTokenVerifier(SECRET),
    configEvents: new BoothConfigEvents(),
    secretBox: box,
    publicApiUrl: 'https://api.test',
    billing: platformGateway,
    platformAdmins: ['admin@platform.test'],
  });
}, 60_000);

afterAll(async () => {
  await close();
});

describe('subscription checkout (mock platform gateway)', () => {
  it('Starter → pays Pro by QRIS → webhook activates the plan → second booth allowed', async () => {
    const orgId = await newOrg('Upgrade Org');
    const make = (name: string) =>
      withUserContext(db, userId, (tx) =>
        createBoothFromTemplate(tx, { orgId, name, timezone: 'Asia/Jakarta', userId }),
      );
    await make('Satu');
    await expect(make('Dua')).rejects.toBeInstanceOf(PlanLimitError);

    // Studio page data.
    const page = await json(await call(`/studio/orgs/${orgId}/billing`, { token: userToken }));
    expect(page.entitlements).toMatchObject({ planCode: 'starter', state: 'active' });
    expect(page.plans.map((p: { code: string }) => p.code)).toEqual(['starter', 'pro', 'business']);
    expect(page.plans.find((p: { code: string }) => p.code === 'pro').priceMonthly).toBe(150_000);
    expect(page.billing.mode).toBe('mock');

    const res = await call(`/studio/orgs/${orgId}/billing/checkout`, {
      method: 'POST',
      token: userToken,
      body: JSON.stringify({ planCode: 'pro' }),
    });
    expect(res.status).toBe(200);
    const { invoice } = await json(res);
    expect(invoice).toMatchObject({
      status: 'pending',
      kind: 'upgrade',
      amount: 150_000,
      planCode: 'pro',
    });
    expect(invoice.qrString).toBeTruthy();

    // Same QR again (idempotent), and not yet entitled.
    const again = await json(
      await call(`/studio/orgs/${orgId}/billing/checkout`, {
        method: 'POST',
        token: userToken,
        body: JSON.stringify({ planCode: 'pro' }),
      }),
    );
    expect(again.invoice.id).toBe(invoice.id);
    expect(again.invoice.qrString).toBe(invoice.qrString);
    await expect(make('Dua')).rejects.toBeInstanceOf(PlanLimitError);

    // The owner pays; Midtrans (mock) calls the platform webhook.
    const paid = await call(`/dev/billing/invoices/${invoice.id}/simulate-paid`, {
      method: 'POST',
    });
    expect(paid.status).toBe(200);
    const polled = await json(
      await call(`/studio/orgs/${orgId}/billing/invoices/${invoice.id}`, { token: userToken }),
    );
    expect(polled.invoice).toMatchObject({ status: 'paid', qrString: null });
    expect((await resolveEntitlements(db, orgId))!).toMatchObject({
      planCode: 'pro',
      state: 'active',
    });
    await make('Dua');

    // A repeated notification changes nothing.
    expect(
      (await call(`/dev/billing/invoices/${invoice.id}/simulate-paid`, { method: 'POST' })).status,
    ).toBe(200);
    expect((await resolveEntitlements(db, orgId))!.planCode).toBe('pro');
  });

  it('polling alone also activates the plan when the webhook never arrives', async () => {
    const orgId = await newOrg('Polling Org');
    const { invoice } = await json(
      await call(`/studio/orgs/${orgId}/billing/checkout`, {
        method: 'POST',
        token: userToken,
        body: JSON.stringify({ planCode: 'pro' }),
      }),
    );
    // Paid at the (mock) provider, but no notification reaches us.
    platformMock.simulatePaid(`${invoice.id}-1`);
    expect((await resolveEntitlements(db, orgId))!.planCode).toBe('starter');
    const polled = await json(
      await call(`/studio/orgs/${orgId}/billing/invoices/${invoice.id}`, { token: userToken }),
    );
    expect(polled.invoice.status).toBe('paid');
    expect((await resolveEntitlements(db, orgId))!.planCode).toBe('pro');
  });

  it('refuses a forged or wrong notification', async () => {
    const orgId = await newOrg('Forge Org');
    const { invoice } = await json(
      await call(`/studio/orgs/${orgId}/billing/checkout`, {
        method: 'POST',
        token: userToken,
        body: JSON.stringify({ planCode: 'pro' }),
      }),
    );
    const forged = {
      order_id: `${invoice.id}-1`,
      status_code: '200',
      gross_amount: '150000.00',
      transaction_status: 'settlement',
      transaction_id: 'x',
      signature_key: 'f'.repeat(128),
    };
    expect(
      (await call('/webhooks/billing', { method: 'POST', body: JSON.stringify(forged) })).status,
    ).toBe(401);
    expect((await resolveEntitlements(db, orgId))!.planCode).toBe('starter');
    // Unknown order with a valid signature is acknowledged and ignored.
    const orderId = 'unknownorder-1';
    const signed = {
      order_id: orderId,
      status_code: '200',
      gross_amount: '1000.00',
      transaction_status: 'settlement',
      transaction_id: 't',
      signature_key: midtransSignature(orderId, '200', '1000.00', 'mock-platform-billing-key'),
    };
    const ok = await call('/webhooks/billing', { method: 'POST', body: JSON.stringify(signed) });
    expect(ok.status).toBe(200);
    expect((await json(ok)).ignored).toBe(true);
  });

  it('checkout needs an owner/manager of that org and a priced plan', async () => {
    const orgId = await newOrg('Auth Org');
    const body = JSON.stringify({ planCode: 'pro' });
    expect(
      (await call(`/studio/orgs/${orgId}/billing/checkout`, { method: 'POST', body })).status,
    ).toBe(401);
    expect(
      (
        await call(`/studio/orgs/${orgId}/billing/checkout`, {
          method: 'POST',
          token: outsiderToken,
          body,
        })
      ).status,
    ).toBe(404);
    expect((await call(`/studio/orgs/${orgId}/billing`, { token: outsiderToken })).status).toBe(
      404,
    );
    const unpriced = await call(`/studio/orgs/${orgId}/billing/checkout`, {
      method: 'POST',
      token: userToken,
      body: JSON.stringify({ planCode: 'business' }),
    });
    expect(unpriced.status).toBe(409);
    expect((await json(unpriced)).error).toBe('price_missing');
    expect(
      (
        await call(`/studio/orgs/${orgId}/billing/checkout`, {
          method: 'POST',
          token: userToken,
          body: '{"planCode":"starter"}',
        })
      ).status,
    ).toBe(400);
  });

  it('device heartbeat carries plan flags, never money; Starter gets a watermark, Pro does not', async () => {
    const orgId = await newOrg('Flags Org', 'pro');
    const token = randomToken();
    await db.insert(devices).values({ orgId, name: 'Laptop', tokenHash: sha256Hex(token) });
    const beat = async () =>
      json(
        await call('/device/heartbeat', {
          method: 'POST',
          token,
          body: JSON.stringify({ outboxPending: 2, uploadsPending: 1 }),
        }),
      );
    const pro = await beat();
    expect(pro.entitlements).toMatchObject({ planCode: 'pro', watermark: false, video: true });
    expect(JSON.stringify(pro)).not.toMatch(/price|invoice|amount|midtrans/i);
    const [row] = await db.select().from(devices).where(eq(devices.orgId, orgId));
    expect(row).toMatchObject({ outboxPending: 2, uploadsPending: 1 });

    await adminSetSubscription(db, { orgId, planCode: 'starter', status: 'active', actorId: null });
    expect((await beat()).entitlements).toMatchObject({
      planCode: 'starter',
      watermark: true,
      video: false,
    });
  });
});

describe('platform money is separate from the owner gateway', () => {
  it("charges and verifies with the PLATFORM key, never the owner's", async () => {
    const OWNER_KEY = 'SB-Mid-server-OWNER-KEY';
    const PLATFORM_KEY = 'SB-Mid-server-PLATFORM-KEY';
    // What Midtrans answers to GET /v2/<order>/status (the webhook confirms with it, audit S1).
    let statusNow = 'pending';
    const fetchStub = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
      if (String(url).endsWith('/status')) {
        const orderId = String(url).split('/v2/')[1]!.replace('/status', '');
        return new Response(
          JSON.stringify({
            status_code: statusNow === 'settlement' ? '200' : '201',
            transaction_id: 'tx-platform',
            order_id: orderId,
            gross_amount: '150000.00',
            transaction_status: statusNow,
            settlement_time: '2026-11-25 10:00:00',
          }),
          { status: 200 },
        );
      }
      const body = JSON.parse(String(init.body)) as {
        transaction_details: { order_id: string; gross_amount: number };
      };
      return new Response(
        JSON.stringify({
          status_code: '201',
          transaction_id: 'tx-platform',
          order_id: body.transaction_details.order_id,
          gross_amount: `${body.transaction_details.gross_amount}.00`,
          transaction_status: 'pending',
          qr_string: '000201PLATFORMQR',
          expiry_time: '2099-01-01 00:00:00',
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    const real = createApp({
      db,
      verifyUserToken: devUserTokenVerifier(SECRET),
      configEvents: new BoothConfigEvents(),
      secretBox: box,
      publicApiUrl: 'https://api.test',
      billing: createBillingGateway({
        mode: 'midtrans',
        serverKey: PLATFORM_KEY,
        env: 'sandbox',
        fetch: fetchStub,
      }),
    });
    const orgId = await newOrg('Separation Org');
    // The owner has connected THEIR OWN Midtrans account for buyer payments.
    await db.insert(paymentCredentials).values({
      orgId,
      provider: 'midtrans',
      env: 'sandbox',
      encryptedSecret: encryptCredential(box, orgId, 'sandbox', OWNER_KEY),
      isActive: true,
      status: 'ok',
    });

    const res = await real.request(`http://api.test/studio/orgs/${orgId}/billing/checkout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ planCode: 'pro' }),
    });
    expect(res.status).toBe(200);
    const { invoice } = await json(res);
    expect(invoice.qrString).toBe('000201PLATFORMQR');

    const [url, init] = fetchStub.mock.calls[0]!;
    expect(String(url)).toBe('https://api.sandbox.midtrans.com/v2/charge');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from(`${PLATFORM_KEY}:`).toString('base64')}`,
    );
    expect(headers.authorization).not.toContain(Buffer.from(`${OWNER_KEY}:`).toString('base64'));
    expect(headers['X-Override-Notification']).toBe('https://api.test/webhooks/billing');
    // Not the owner's per-org buyer webhook.
    expect(headers['X-Override-Notification']).not.toContain('/webhooks/midtrans/');

    const note = (key: string) => {
      const orderId = `${invoice.id}-1`;
      return {
        order_id: orderId,
        status_code: '200',
        gross_amount: '150000.00',
        transaction_status: 'settlement',
        transaction_id: 'tx-platform',
        settlement_time: '2026-11-25 10:00:00',
        signature_key: midtransSignature(orderId, '200', '150000.00', key),
      };
    };
    const post = (b: unknown) =>
      real.request('http://api.test/webhooks/billing', {
        method: 'POST',
        body: JSON.stringify(b),
        headers: { 'content-type': 'application/json' },
      });
    // A notification signed with the OWNER's key is not accepted for platform invoices.
    expect((await post(note(OWNER_KEY))).status).toBe(401);
    expect((await resolveEntitlements(db, orgId))!.planCode).toBe('starter');
    // Correctly signed, but Midtrans itself does not report it settled: ignored (audit S1).
    expect((await post(note(PLATFORM_KEY))).status).toBe(200);
    expect((await resolveEntitlements(db, orgId))!.planCode).toBe('starter');
    // Signed with the platform key and confirmed by Midtrans: the plan is activated.
    statusNow = 'settlement';
    expect((await post(note(PLATFORM_KEY))).status).toBe(200);
    expect((await resolveEntitlements(db, orgId))!.planCode).toBe('pro');

    // And the owner's buyer webhook route does not touch invoices.
    const buyer = await real.request(`http://api.test/webhooks/midtrans/${orgId}`, {
      method: 'POST',
      body: JSON.stringify(note(OWNER_KEY)),
      headers: { 'content-type': 'application/json' },
    });
    expect(buyer.status).toBe(200); // acknowledged as "not a buyer payment"
    expect((await json(buyer)).ignored).toBe(true);
  });

  it('without a platform key invoices exist but cannot be paid online', async () => {
    const disabled = createApp({
      db,
      verifyUserToken: devUserTokenVerifier(SECRET),
      configEvents: new BoothConfigEvents(),
      secretBox: box,
    });
    const orgId = await newOrg('NoKey Org');
    const res = await disabled.request(`http://api.test/studio/orgs/${orgId}/billing/checkout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ planCode: 'pro' }),
    });
    expect(res.status).toBe(503);
    expect((await json(res)).error).toBe('billing_unavailable');
    const hook = await disabled.request('http://api.test/webhooks/billing', {
      method: 'POST',
      body: '{}',
    });
    expect(hook.status).toBe(404);
  });
});

describe('platform admin', () => {
  it('is closed to owners and open to listed e-mails; changes are audited', async () => {
    const orgId = await newOrg('Admin Target');
    expect((await call('/admin/orgs', { token: userToken })).status).toBe(403);
    expect((await call('/admin/orgs')).status).toBe(401);
    const list = await json(await call('/admin/orgs', { token: adminToken }));
    expect(list.orgs.find((o: { orgId: string }) => o.orgId === orgId)).toMatchObject({
      planCode: 'starter',
      state: 'active',
    });

    const set = await call(`/admin/orgs/${orgId}/subscription`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ planCode: 'business', status: 'active', periodDays: 60, note: 'uji' }),
    });
    expect(set.status).toBe(200);
    expect((await resolveEntitlements(db, orgId))!).toMatchObject({
      planCode: 'business',
      state: 'active',
    });

    const price = await call('/admin/plans/business/price', {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ priceMonthly: 400_000 }),
    });
    expect(price.status).toBe(200);
    expect(
      (
        await call('/admin/plans/business/price', {
          method: 'PUT',
          token: userToken,
          body: '{"priceMonthly":1}',
        })
      ).status,
    ).toBe(403);
    const run = await json(
      await call('/admin/billing/run-lifecycle', { method: 'POST', token: adminToken }),
    );
    expect(run).toHaveProperty('pastDue');
  });
});

describe('platform frame library', () => {
  const slot = (index: number, y: number) => ({
    index,
    x: 30,
    y,
    width: 540,
    height: 360,
    rotation: 0,
    borderRadius: 0,
  });
  const body = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      name: 'Bunga Pastel',
      url: 'http://localhost:3000/media/org/library/abc.png',
      sha256: 'a'.repeat(64),
      bytes: 1234,
      mimeType: 'image/png',
      width: 600,
      height: 1800,
      slots: [slot(1, 40), slot(2, 420)],
      ...over,
    });

  it('admins manage it; owners read only published frames; foreign URLs are refused', async () => {
    expect(
      (await call('/admin/library-frames', { method: 'POST', token: userToken, body: body() }))
        .status,
    ).toBe(403);
    const bad = await call('/admin/library-frames', {
      method: 'POST',
      token: adminToken,
      body: body({ url: 'http://169.254.169.254/x.png' }),
    });
    expect(bad.status).toBe(400);
    const badSlots = await call('/admin/library-frames', {
      method: 'POST',
      token: adminToken,
      body: body({ slots: [slot(2, 40)] }),
    });
    expect(badSlots.status).toBe(400);

    const created = await call('/admin/library-frames', {
      method: 'POST',
      token: adminToken,
      body: body(),
    });
    expect(created.status).toBe(201);
    const { frame } = await json(created);
    const hidden = await json(
      await call('/admin/library-frames', {
        method: 'POST',
        token: adminToken,
        body: body({ name: 'Draft', isPublished: false }),
      }),
    );

    const ownerView = await withUserContext(db, userId, (tx) => listLibraryFrames(tx));
    expect(ownerView.map((f) => f.name)).toContain('Bunga Pastel');
    expect(ownerView.map((f) => f.id)).not.toContain(hidden.frame.id);

    const patched = await call(`/admin/library-frames/${frame.id}`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify({ isPublished: false, name: 'Bunga' }),
    });
    expect((await json(patched)).frame).toMatchObject({ name: 'Bunga', isPublished: false });
    expect(
      (await withUserContext(db, userId, (tx) => listLibraryFrames(tx))).map((f) => f.id),
    ).not.toContain(frame.id);

    const del = await call(`/admin/library-frames/${frame.id}`, {
      method: 'DELETE',
      token: adminToken,
    });
    expect(del.status).toBe(200);
    const list = await json(await call('/admin/library-frames', { token: adminToken }));
    expect(list.frames.map((f: { id: string }) => f.id)).not.toContain(frame.id);
  });
});
