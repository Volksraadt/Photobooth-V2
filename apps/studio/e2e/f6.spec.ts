import { createId } from '@paralleldrive/cuid2';
import { sha256Hex } from '@pb/crypto';
import {
  adminSetSubscription,
  billingInvoices,
  booths,
  createDb,
  devices,
  orgs,
  refreshDailyBoothStats,
  sessions,
  setPlanPrice,
  subscriptions,
} from '@pb/db';
import { seedPlans } from '@pb/db/testing';
import { expect, test, type Page } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { newBooth } from './helpers';

/**
 * F6 on the full dev stack (real Postgres). Start the stack with:
 *   PB_BILLING_PROVIDER=mock PB_PAYMENT_PROVIDER=mock PB_PLATFORM_ADMINS=admin-f6@e2e.test pnpm dev
 * Fixtures are written straight to the dev database; everything asserted is read back through the
 * Studio UI / API.
 */
const API = 'http://localhost:8787';
const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/photobooth';
const PASSWORD = 'e2e-password-123';
const { db, close } = createDb(DB_URL, { max: 2 });
// Plans carry the Starter recap limit (idempotent upsert, same as `pnpm db:seed`).
test.beforeAll(async () => {
  await seedPlans(db);
});
test.afterAll(async () => {
  await close();
});

async function orgOf(boothUrl: string) {
  const boothId = boothUrl.split('/').pop()!;
  const [b] = await db.select().from(booths).where(eq(booths.id, boothId));
  return { boothId, orgId: b!.orgId };
}

async function signUp(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Kata sandi').fill(PASSWORD);
  await page.getByRole('button', { name: 'Daftar' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

test('recap: numbers match the fixtures, 23:30 WIB lands on the WIB day, plan range and export', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const boothUrl = await newBooth(page, 'klasik');
  const { boothId, orgId } = await orgOf(boothUrl);
  await db.update(booths).set({ timezone: 'Asia/Jakarta' }).where(eq(booths.id, boothId));

  const run = Array.from(
    { length: 4 },
    () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)],
  ).join('');
  const code = (n: number) => `F6${run}A${n}`;
  // Three sold sessions on 3 days ago (WIB), one at 23:30 WIB, one at 00:30 WIB the next day.
  const dayWib = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(
    new Date(Date.now() - 3 * 86_400_000),
  );
  const at = (hhmmWib: string, plusDays = 0) =>
    new Date(new Date(`${dayWib}T${hhmmWib}:00+07:00`).getTime() + plusDays * 86_400_000);
  const make = (
    code: string,
    when: Date,
    method: 'qris' | 'cash' | 'voucher',
    gross: number,
    fee = 0,
  ) =>
    db.insert(sessions).values({
      id: createId(),
      orgId,
      boothId,
      code,
      startedAt: when,
      status: 'completed',
      paymentMethod: method,
      grossAmount: gross,
      feeAmount: fee,
      netAmount: gross - fee,
    });
  await make(code(2), at('23:30'), 'qris', 35000, 245);
  await make(code(3), at('00:30', 1), 'cash', 35000);
  await make(code(4), at('10:00', 1), 'voucher', 50000);
  await refreshDailyBoothStats(db);

  await page.goto(`/reports?from=${dayWib}&to=${dayWib}`);
  await expect(page.getByTestId('card-sessions')).toHaveText('1');
  await expect(page.getByTestId('card-gross')).toContainText('35.000');
  await expect(page.getByTestId('method-qris')).toContainText('35.000');

  const next = new Date(`${dayWib}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const dayNext = next.toISOString().slice(0, 10);
  await page.goto(`/reports?from=${dayWib}&to=${dayNext}`);
  await expect(page.getByTestId('card-sessions')).toHaveText('3');
  await expect(page.getByTestId('card-gross')).toContainText('120.000');
  await expect(page.getByTestId('card-net')).toContainText('119.755');
  await expect(page.getByTestId('card-average')).toContainText('40.000');
  const bars = page.getByTestId('chart-days').locator('[data-value]');
  await expect(bars).toHaveCount(2);
  await expect(bars.nth(0)).toHaveAttribute('data-value', '35000');
  await expect(bars.nth(1)).toHaveAttribute('data-value', '85000');
  const hours = page.getByTestId('chart-hours').locator('[data-value]');
  await expect(hours.nth(23)).toHaveAttribute('data-value', '1');
  await expect(hours.nth(0)).toHaveAttribute('data-value', '1');

  // Transactions list shows booth-local times; detail page opens.
  await page.goto(`/transactions?from=${dayWib}&to=${dayNext}`);
  await expect(page.getByTestId(`txn-${code(2)}`)).toContainText('23.30');
  await page
    .getByTestId(`txn-${code(2)}`)
    .getByRole('link', { name: code(2) })
    .click();
  await expect(page.getByTestId('session-code')).toHaveText(code(2));
  await expect(page.getByTestId('no-thumbnail')).toBeVisible();

  // Pro trial: export allowed (CSV has the three sessions with local times).
  const csv = await page.request.get(
    `/api/export/transactions?from=${dayWib}&to=${dayNext}&format=csv`,
  );
  expect(csv.status()).toBe(200);
  const text = await csv.text();
  expect(text).toContain(code(2));
  expect(text).toContain(code(4));
  const xlsx = await page.request.get(
    `/api/export/transactions?from=${dayWib}&to=${dayNext}&format=xlsx`,
  );
  expect(xlsx.headers()['content-type']).toContain('spreadsheetml');

  // Starter: export closed, recap limited to 30 days.
  await adminSetSubscription(db, { orgId, planCode: 'starter', status: 'active', actorId: null });
  await page.goto(`/reports?from=2020-01-01&to=${dayNext}`);
  await expect(page.getByTestId('recap-limit')).toBeVisible();
  await expect(page.getByTestId('export-locked')).toBeVisible();
  expect(
    (await page.request.get(`/api/export/transactions?from=${dayWib}&to=${dayNext}`)).status(),
  ).toBe(403);
});

test('devices: offline after 5 minutes without heartbeat, paper counter, revoke', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const boothUrl = await newBooth(page, 'klasik');
  const { boothId, orgId } = await orgOf(boothUrl);
  const mk = async (name: string, ageMs: number | null) => {
    const id = createId();
    await db.insert(devices).values({
      id,
      orgId,
      boothId,
      name,
      tokenHash: sha256Hex(createId() + createId()),
      lastHeartbeatAt: ageMs === null ? null : new Date(Date.now() - ageMs),
      appVersion: 'agent 0.3.0',
      outboxPending: name === 'Laptop Sibuk' ? 3 : 0,
      uploadsPending: 0,
    });
    return id;
  };
  const fresh = await mk('Laptop Segar', 20_000);
  const stale = await mk('Laptop Lambat', 3 * 60_000);
  const old = await mk('Laptop Mati', 6 * 60_000);
  const busy = await mk('Laptop Sibuk', 10_000);

  await page.goto('/devices');
  await expect(page.getByTestId(`device-status-${fresh}`)).toHaveAttribute('data-status', 'online');
  await expect(page.getByTestId(`device-status-${stale}`)).toHaveAttribute('data-status', 'stale');
  await expect(page.getByTestId(`device-status-${old}`)).toHaveAttribute('data-status', 'offline');
  await expect(page.getByTestId(`device-status-${old}`)).toHaveText('offline');
  await expect(page.getByTestId(`unsynced-${busy}`)).toContainText('3 catatan');

  // Paper: enter the roll capacity, remaining shows up.
  const form = page.getByTestId(`paper-form-${fresh}`);
  await form.getByLabel('Kapasitas roll (lembar 4×6)').fill('700');
  await form.getByRole('button', { name: 'Simpan' }).click();
  await expect(form.getByText('Tersimpan.')).toBeVisible();
  await expect(page.getByTestId(`paper-${fresh}`)).toContainText('Perkiraan sisa: 700');

  // Event log opens with filters.
  await page.getByTestId(`device-log-${fresh}`).click();
  await expect(page.getByTestId('event-filter')).toBeVisible();

  // Revoke.
  await page.goto('/devices');
  await page.getByTestId(`revoke-${old}`).click();
  await expect(page.getByTestId(`device-status-${old}`)).toHaveAttribute('data-status', 'revoked');
  await page.goto('/audit');
  await expect(
    page.getByTestId('audit-list').locator('[data-action="device.revoke"]').first(),
  ).toBeVisible();
});

test('subscription: Starter limit, pay Pro by QRIS, grace banner keeps booths running, downgrade', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const boothUrl = await newBooth(page, 'klasik');
  const { orgId } = await orgOf(boothUrl);
  await setPlanPrice(db, { code: 'pro', priceMonthly: 150_000, actorId: null });
  await adminSetSubscription(db, { orgId, planCode: 'starter', status: 'active', actorId: null });

  // Starter: no second booth (the create form is replaced by the limit notice).
  await page.goto('/booths');
  await expect(page.getByTestId('booth-limit')).toBeVisible();
  await expect(page.getByTestId('template-klasik')).toHaveCount(0);

  // Pay Pro through the platform gateway (mock): QR, then the "paid" notification.
  await page.goto('/billing');
  await expect(page.getByTestId('plan-name')).toHaveText('Starter');
  await page.getByTestId('checkout-pro').click();
  await expect(page.getByTestId('billing-qr')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('checkout-waiting')).toBeVisible();
  const [invoice] = await db
    .select({ id: billingInvoices.id })
    .from(billingInvoices)
    .where(and(eq(billingInvoices.orgId, orgId), eq(billingInvoices.status, 'pending')));
  const invoiceId = invoice!.id;
  const paid = await page.request.post(`${API}/dev/billing/invoices/${invoiceId}/simulate-paid`);
  expect(paid.ok()).toBe(true);
  await expect(page.getByTestId('checkout-paid')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('plan-name')).toHaveText('Pro', { timeout: 20_000 });

  // Pro: the second booth is accepted now.
  await page.goto('/booths');
  await page.getByTestId('template-klasik').click();
  await page.getByLabel('Nama booth').fill('Booth Kedua');
  await page.getByRole('button', { name: 'Buat booth' }).click();
  await expect(page).toHaveURL(/\/booths\/[a-z0-9]+$/);

  // Paid period ended yesterday: warning banner, but the booth keeps its full plan and keeps working.
  await db
    .update(subscriptions)
    .set({ currentPeriodEnd: new Date(Date.now() - 86_400_000), status: 'active' })
    .where(eq(subscriptions.orgId, orgId));
  await page.goto('/booths');
  const banner = page.getByTestId('subscription-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute('data-state', 'grace');
  await expect(banner).toContainText('tetap berjalan');
  await page.goto('/billing');
  await expect(page.getByTestId('plan-state')).toContainText('masa tenggang');

  // A device of this org still gets plan flags and is accepted during the grace period.
  const token = createId() + createId();
  await db.insert(devices).values({ orgId, name: 'Laptop', tokenHash: sha256Hex(token) });
  const hb = await page.request.post(`${API}/device/heartbeat`, {
    headers: { authorization: `Bearer ${token}` },
    data: { outboxPending: 0 },
  });
  expect(hb.status()).toBe(200);
  expect(((await hb.json()) as { entitlements: { planCode: string } }).entitlements.planCode).toBe(
    'pro',
  );

  // Grace is over: Starter limits, the booths themselves are not removed.
  await db
    .update(subscriptions)
    .set({ currentPeriodEnd: new Date(Date.now() - 9 * 86_400_000), status: 'active' })
    .where(eq(subscriptions.orgId, orgId));
  await page.goto('/booths');
  await expect(page.getByTestId('subscription-banner')).toHaveAttribute('data-state', 'downgraded');
  await expect(page.getByText('Booth Kedua').first()).toBeVisible();
  const hb2 = await page.request.post(`${API}/device/heartbeat`, {
    headers: { authorization: `Bearer ${token}` },
    data: {},
  });
  expect(hb2.status()).toBe(200);
  expect(
    ((await hb2.json()) as { entitlements: { planCode: string; watermark: boolean } }).entitlements,
  ).toMatchObject({
    planCode: 'starter',
    watermark: true,
  });
  void orgs;
});

test('platform admin: lists orgs and changes a plan; owners cannot open it', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const boothUrl = await newBooth(page, 'klasik');
  const { orgId } = await orgOf(boothUrl);
  await page.goto('/admin');
  await expect(page.getByText('Halaman tidak ditemukan').or(page.getByText('404'))).toBeVisible();

  const ctx = await browser.newContext({ baseURL: 'http://localhost:3000' });
  const adminPage = await ctx.newPage();
  await signUp(adminPage, 'admin-f6@e2e.test').catch(async () => {
    // Already registered by a previous run.
    await adminPage.goto('/login');
    await adminPage.getByLabel('Email').fill('admin-f6@e2e.test');
    await adminPage.getByLabel('Kata sandi').fill(PASSWORD);
    await adminPage.getByRole('button', { name: 'Masuk', exact: true }).click();
  });
  await adminPage.goto('/onboarding');
  if (adminPage.url().endsWith('/onboarding')) {
    await adminPage.getByLabel('Nama usaha / organisasi').fill('Org Admin F6');
    await adminPage.getByRole('button', { name: 'Buat organisasi' }).click();
  }
  await adminPage.goto('/admin');
  const slug = (await db.select().from(orgs).where(eq(orgs.id, orgId)))[0]!.slug;
  const row = adminPage.getByTestId(`admin-org-${slug}`);
  await expect(row).toBeVisible();
  await row.locator('select[name="planCode"]').selectOption('business');
  await row.getByTestId(`admin-set-${slug}`).click();
  await expect
    .poll(
      async () =>
        (await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId)))[0]?.planId,
    )
    .toBeTruthy();
  await page.goto('/billing');
  await expect(page.getByTestId('plan-name')).toHaveText('Business');
  await ctx.close();
});
