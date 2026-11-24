import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMonthsUtc,
  adminListOrgs,
  adminSetSubscription,
  applyInvoicePaid,
  BillingError,
  createCheckoutInvoice,
  GRACE_DAYS,
  invoiceIdFromOrder,
  invoiceOrderId,
  resolveEntitlements,
  runBillingLifecycle,
  setPlanPrice,
} from './billing-repo';
import { createBoothFromTemplate, PlanLimitError } from './booth-repo';
import { createOrg } from './repo';
import { auditLogs, billingInvoices, subscriptions } from './schema';
import { createTestDb, createTestUser, seedPlans } from './testing';
import type { Db } from './types';
import { withUserContext } from './user-context';

let db: Db;
let close: () => Promise<void>;
let userId: string;
const DAY = 86_400_000;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedPlans(db);
  userId = await createTestUser(db, 'owner@f6-billing.test');
  // Plan prices are decided by the platform admin (open-questions #2); the seed leaves them empty.
  await setPlanPrice(db, { code: 'pro', priceMonthly: 150_000, actorId: null });
  await setPlanPrice(db, { code: 'business', priceMonthly: 400_000, actorId: null });
}, 60_000);

afterAll(async () => {
  await close();
});

async function newOrg(name: string) {
  return (await withUserContext(db, userId, (tx) => createOrg(tx, { name }))).id;
}
const sub = async (orgId: string) =>
  (await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId)))[0]!;
const audit = async (orgId: string) =>
  (await db.select().from(auditLogs).where(eq(auditLogs.orgId, orgId))).map((a) => a.action);

describe('entitlements follow the clock', () => {
  it('trial → grace (full plan, booths keep running) → downgraded to Starter limits', async () => {
    const orgId = await newOrg('Trial Org');
    const start = (await sub(orgId)).currentPeriodStart.getTime();
    const at = (days: number) => new Date(start + days * DAY);

    const trial = await resolveEntitlements(db, orgId, at(1));
    expect(trial).toMatchObject({ planCode: 'pro', state: 'trial', status: 'trialing' });
    expect(trial!.limits.maxBooths).toBe(3);

    // 14-day trial is over: still the full Pro plan for GRACE_DAYS.
    const grace = await resolveEntitlements(db, orgId, at(15));
    expect(grace).toMatchObject({ planCode: 'pro', state: 'grace' });
    expect(grace!.features.video).toBe(true);
    expect(GRACE_DAYS).toBe(7);

    const down = await resolveEntitlements(db, orgId, at(14 + GRACE_DAYS + 0.1));
    expect(down).toMatchObject({
      planCode: 'starter',
      state: 'downgraded',
      subscribedPlanCode: 'pro',
    });
    expect(down!.limits.maxBooths).toBe(1);
    expect(down!.limits.recapDays).toBe(30); // Starter: 30 days of recap
    expect(grace!.limits.recapDays ?? null).toBeNull(); // Pro: unlimited
    expect(down!.features.video).toBe(false);
    expect(down!.features.watermarkRemoval).toBe(false);
  });

  it('adds calendar months without overflowing', () => {
    expect(addMonthsUtc(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T10:00:00.000Z',
    );
    expect(addMonthsUtc(new Date('2026-11-25T00:00:00Z'), 1).toISOString()).toBe(
      '2026-12-25T00:00:00.000Z',
    );
    expect(addMonthsUtc(new Date('2026-12-15T00:00:00Z'), 1).toISOString()).toBe(
      '2027-01-15T00:00:00.000Z',
    );
  });

  it('order ids round-trip to the invoice id', () => {
    expect(invoiceIdFromOrder(invoiceOrderId('abc123xyz', 3))).toBe('abc123xyz');
    expect(invoiceIdFromOrder('no-dash-number-x')).toBeNull();
    expect(invoiceIdFromOrder('plain')).toBeNull();
  });
});

describe('lifecycle job', () => {
  it('late payment: banner state first, then downgrade; idempotent; open invoices voided', async () => {
    const orgId = await newOrg('Lapsing Org');
    const s0 = await sub(orgId);
    const end = s0.currentPeriodEnd.getTime();

    // Before the end: nothing to do.
    expect(await runBillingLifecycle(db, new Date(end - 5 * DAY))).toMatchObject({ pastDue: 0 });

    // Period over → past_due with a grace window.
    const r1 = await runBillingLifecycle(db, new Date(end + 1000));
    expect(r1.pastDue).toBeGreaterThanOrEqual(1);
    const s1 = await sub(orgId);
    expect(s1.status).toBe('past_due');
    expect(s1.graceUntil!.getTime()).toBe(end + GRACE_DAYS * DAY);
    expect(await runBillingLifecycle(db, new Date(end + 2000))).toMatchObject({
      pastDue: 0,
      downgraded: 0,
    });
    // The owner started a checkout during the grace period, then did not pay.
    const inv = await createCheckoutInvoice(db, {
      orgId,
      planCode: 'pro',
      now: new Date(end + DAY),
    });
    expect(inv.status).toBe('pending');

    // Inside the grace window: still the full plan.
    const e = await resolveEntitlements(db, orgId, new Date(end + 3 * DAY));
    expect(e).toMatchObject({ planCode: 'pro', state: 'grace' });

    // Grace over → Starter.
    const r2 = await runBillingLifecycle(db, new Date(end + 8 * DAY));
    expect(r2.downgraded).toBeGreaterThanOrEqual(1);
    const s2 = await sub(orgId);
    expect(s2.status).toBe('active');
    const after = await resolveEntitlements(db, orgId, new Date(end + 8 * DAY));
    expect(after).toMatchObject({ planCode: 'starter', state: 'active' });
    const [voided] = await db.select().from(billingInvoices).where(eq(billingInvoices.id, inv.id));
    expect(voided!.status).toBe('void');
    expect(await runBillingLifecycle(db, new Date(end + 9 * DAY))).toMatchObject({ downgraded: 0 });
    expect(await audit(orgId)).toEqual(
      expect.arrayContaining(['subscription.past_due', 'subscription.downgraded']),
    );
  });

  it('issues one renewal invoice shortly before a paid period ends', async () => {
    const orgId = await newOrg('Renewing Org');
    const first = await createCheckoutInvoice(db, { orgId, planCode: 'pro' });
    await applyInvoicePaid(db, first.id, {
      providerRef: 'tx1',
      paidAt: null,
      grossAmount: 150_000,
    });
    const s = await sub(orgId);
    const end = s.currentPeriodEnd.getTime();

    expect((await runBillingLifecycle(db, new Date(end - 10 * DAY))).renewalInvoices).toBe(0);
    expect(
      (await runBillingLifecycle(db, new Date(end - 2 * DAY))).renewalInvoices,
    ).toBeGreaterThanOrEqual(1);
    expect((await runBillingLifecycle(db, new Date(end - 1 * DAY))).renewalInvoices).toBe(0); // no duplicate
    const open = (
      await db.select().from(billingInvoices).where(eq(billingInvoices.orgId, orgId))
    ).filter((i) => i.status === 'pending');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: 'renewal', amount: 150_000 });
    expect(open[0]!.periodStart!.getTime()).toBe(end);

    // Paying it extends from the old end (no free days, no lost days).
    const paid = await applyInvoicePaid(
      db,
      open[0]!.id,
      { providerRef: 'tx2', paidAt: null, grossAmount: 150_000 },
      new Date(end - DAY),
    );
    expect(paid.changed).toBe(true);
    const s2 = await sub(orgId);
    expect(s2.currentPeriodStart.getTime()).toBe(end);
    expect(s2.currentPeriodEnd.getTime()).toBe(addMonthsUtc(new Date(end), 1).getTime());
    expect(s2.status).toBe('active');
  });
});

describe('upgrade and plan gating', () => {
  it('Starter cannot create a second booth; after paying Pro it can', async () => {
    const orgId = await newOrg('Gating Org');
    await adminSetSubscription(db, { orgId, planCode: 'starter', status: 'active', actorId: null });
    const make = (name: string) =>
      withUserContext(db, userId, (tx) =>
        createBoothFromTemplate(tx, { orgId, name, timezone: 'Asia/Jakarta', userId }),
      );
    await make('Pertama');
    await expect(make('Kedua')).rejects.toBeInstanceOf(PlanLimitError);

    const inv = await createCheckoutInvoice(db, { orgId, planCode: 'pro' });
    expect(inv).toMatchObject({ kind: 'upgrade', amount: 150_000, status: 'pending' });
    // Still blocked until the platform confirms the payment.
    await expect(make('Kedua')).rejects.toBeInstanceOf(PlanLimitError);

    const r = await applyInvoicePaid(db, inv.id, {
      providerRef: 'trx-1',
      paidAt: null,
      grossAmount: 150_000,
    });
    expect(r.changed).toBe(true);
    await make('Kedua');
    await make('Ketiga');
    await expect(make('Keempat')).rejects.toBeInstanceOf(PlanLimitError); // Pro: 3 booths
    expect(await audit(orgId)).toContain('subscription.paid');
  });

  it('a repeated notification changes nothing; a wrong amount is refused', async () => {
    const orgId = await newOrg('Dup Org');
    await adminSetSubscription(db, { orgId, planCode: 'starter', status: 'active', actorId: null });
    const inv = await createCheckoutInvoice(db, { orgId, planCode: 'pro' });
    await expect(
      applyInvoicePaid(db, inv.id, { providerRef: 'x', paidAt: null, grossAmount: 1 }),
    ).rejects.toMatchObject({ code: 'amount_mismatch' });
    expect(
      (await applyInvoicePaid(db, inv.id, { providerRef: 'x', paidAt: null, grossAmount: 150_000 }))
        .changed,
    ).toBe(true);
    const before = await sub(orgId);
    const again = await applyInvoicePaid(db, inv.id, {
      providerRef: 'x',
      paidAt: null,
      grossAmount: 150_000,
    });
    expect(again.changed).toBe(false);
    expect((await sub(orgId)).currentPeriodEnd.getTime()).toBe(before.currentPeriodEnd.getTime());
  });

  it('checkout is idempotent, voids a stale choice and refuses unpriced / downgrade requests', async () => {
    const orgId = await newOrg('Checkout Org');
    await adminSetSubscription(db, { orgId, planCode: 'starter', status: 'active', actorId: null });
    const a = await createCheckoutInvoice(db, { orgId, planCode: 'pro' });
    expect((await createCheckoutInvoice(db, { orgId, planCode: 'pro' })).id).toBe(a.id);
    const b = await createCheckoutInvoice(db, { orgId, planCode: 'business' });
    expect(b.id).not.toBe(a.id);
    expect(
      (await db.select().from(billingInvoices).where(eq(billingInvoices.id, a.id)))[0]!.status,
    ).toBe('void');

    await expect(createCheckoutInvoice(db, { orgId, planCode: 'starter' })).rejects.toMatchObject({
      code: 'plan_unavailable',
    });
    await setPlanPrice(db, { code: 'business', priceMonthly: null, actorId: null });
    await expect(createCheckoutInvoice(db, { orgId, planCode: 'business' })).rejects.toBeInstanceOf(
      BillingError,
    );
    await setPlanPrice(db, { code: 'business', priceMonthly: 400_000, actorId: null });

    await applyInvoicePaid(db, b.id, { providerRef: null, paidAt: null, grossAmount: 400_000 });
    await expect(createCheckoutInvoice(db, { orgId, planCode: 'pro' })).rejects.toMatchObject({
      code: 'downgrade_not_supported',
    });
  });

  it('manual plan change by the platform admin is audited and listed', async () => {
    const orgId = await newOrg('Admin Org');
    await adminSetSubscription(db, {
      orgId,
      planCode: 'business',
      status: 'active',
      periodDays: 90,
      actorId: userId,
      note: 'komplimen',
    });
    const list = await adminListOrgs(db);
    const row = list.find((o) => o.orgId === orgId)!;
    expect(row).toMatchObject({ planCode: 'business', status: 'active', state: 'active' });
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.orgId, orgId));
    expect(logs.find((l) => l.action === 'subscription.admin_set')).toMatchObject({
      actorId: userId,
    });
  });
});
