import { and, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import {
  auditLogs,
  billingInvoices,
  orgs,
  plans,
  subscriptions,
  type PlanFeatures,
  type PlanLimits,
} from './schema';
import type { Db, Tx } from './types';

/**
 * Subscriptions, entitlements and platform billing (F6).
 *
 * Money here is the platform's own: the owner pays the PLATFORM's Midtrans account for the
 * subscription (docs/decisions.md). Nothing in this file touches `payment_credentials` (the
 * owner's gateway for buyer payments). Callers pass an owner connection (api/worker) or a Studio
 * Tx (RLS: members read their own subscription and invoices).
 */

type DbOrTx = Db | Tx;

/** Days a booth keeps its full plan after the paid period ended (docs/open-questions.md #4). */
export const GRACE_DAYS = 7;
/** Renewal invoices are issued this many days before the period ends. */
export const RENEWAL_LEAD_DAYS = 3;
const DAY_MS = 86_400_000;

export const PLAN_RANK: Record<string, number> = { starter: 0, pro: 1, business: 2 };

export class BillingError extends Error {
  constructor(
    readonly code:
      | 'plan_unavailable'
      | 'price_missing'
      | 'downgrade_not_supported'
      | 'no_subscription'
      | 'not_found'
      | 'amount_mismatch'
      | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

/** UTC calendar-month addition; Jan 31 + 1 month = Feb 28/29 (never March). */
export function addMonthsUtc(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}

export type PlanRow = typeof plans.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type InvoiceRow = typeof billingInvoices.$inferSelect;

export type EntitlementState =
  /** Free trial running. */
  | 'trial'
  /** Paid period running (or the free base plan). */
  | 'active'
  /** Period ended, not paid yet: full plan until `graceUntil`. Booths keep running. */
  | 'grace'
  /** Grace over: limited to the Starter plan (existing booths are not switched off). */
  | 'downgraded';

export type Entitlements = {
  /** What the org is entitled to NOW (Starter when downgraded). */
  planCode: string;
  planName: string;
  limits: PlanLimits;
  features: PlanFeatures;
  state: EntitlementState;
  /** Raw subscription status. */
  status: SubscriptionRow['status'];
  /** The plan on the subscription row (differs from planCode when downgraded). */
  subscribedPlanCode: string;
  periodEnd: Date | null;
  graceUntil: Date | null;
};

/**
 * What an org may do right now. Computed lazily from the clock, so the rules hold even if the
 * billing job has not run yet: an expired period gets {@link GRACE_DAYS} of full access, then
 * Starter limits. Returns null when there is no plan data (empty database in tests).
 */
export async function resolveEntitlements(
  db: DbOrTx,
  orgId: string,
  now: Date = new Date(),
  graceDays: number = GRACE_DAYS,
): Promise<Entitlements | null> {
  const [row] = await db
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.orgId, orgId))
    .orderBy(desc(subscriptions.currentPeriodEnd))
    .limit(1);
  const [starter] = await db.select().from(plans).where(eq(plans.code, 'starter'));
  if (!row) {
    if (!starter) return null;
    return entitlementOf(starter, 'active', 'active', starter.code, null, null);
  }
  const { sub, plan } = row;
  if (plan.code === 'starter') {
    return entitlementOf(plan, 'active', sub.status, plan.code, sub.currentPeriodEnd, null);
  }
  const periodEnd = sub.currentPeriodEnd;
  const graceUntil = sub.graceUntil ?? new Date(periodEnd.getTime() + graceDays * DAY_MS);
  const expiredPaid = sub.status === 'past_due' || periodEnd.getTime() < now.getTime();
  if (sub.status === 'canceled') {
    return limited(plan, sub, starter, periodEnd, graceUntil);
  }
  if (!expiredPaid) {
    return entitlementOf(
      plan,
      sub.status === 'trialing' ? 'trial' : 'active',
      sub.status,
      plan.code,
      periodEnd,
      null,
    );
  }
  if (now.getTime() <= graceUntil.getTime()) {
    return entitlementOf(plan, 'grace', sub.status, plan.code, periodEnd, graceUntil);
  }
  return limited(plan, sub, starter, periodEnd, graceUntil);
}

function entitlementOf(
  plan: PlanRow,
  state: EntitlementState,
  status: SubscriptionRow['status'],
  subscribedPlanCode: string,
  periodEnd: Date | null,
  graceUntil: Date | null,
): Entitlements {
  return {
    planCode: plan.code,
    planName: plan.name,
    limits: plan.limits,
    features: plan.features,
    state,
    status,
    subscribedPlanCode,
    periodEnd,
    graceUntil,
  };
}

function limited(
  plan: PlanRow,
  sub: SubscriptionRow,
  starter: PlanRow | undefined,
  periodEnd: Date,
  graceUntil: Date,
): Entitlements {
  const base = starter ?? plan;
  return entitlementOf(base, 'downgraded', sub.status, plan.code, periodEnd, graceUntil);
}

/** Throws-free feature check used by API and Studio guards. */
export function hasFeature(e: Entitlements | null, feature: keyof PlanFeatures): boolean {
  return !!e?.features[feature];
}

// --- plans -----------------------------------------------------------------------------------

export async function listPlans(db: DbOrTx): Promise<PlanRow[]> {
  const rows = await db.select().from(plans);
  return rows.sort((a, b) => (PLAN_RANK[a.code] ?? 9) - (PLAN_RANK[b.code] ?? 9));
}

export async function getPlanByCode(db: DbOrTx, code: string): Promise<PlanRow | null> {
  const [p] = await db
    .select()
    .from(plans)
    .where(eq(plans.code, code as PlanRow['code']));
  return p ?? null;
}

/** Platform admin: sets the monthly price (IDR, null = not for sale yet). */
export async function setPlanPrice(
  db: Db,
  input: { code: string; priceMonthly: number | null; actorId: string | null },
) {
  const plan = await getPlanByCode(db, input.code);
  if (!plan) throw new BillingError('not_found', 'Paket tidak ditemukan');
  if (
    input.priceMonthly !== null &&
    (!Number.isInteger(input.priceMonthly) || input.priceMonthly < 0)
  )
    throw new BillingError('invalid', 'Harga harus bilangan bulat ≥ 0');
  await db
    .update(plans)
    .set({ priceMonthly: input.priceMonthly, updatedAt: new Date() })
    .where(eq(plans.id, plan.id));
  return plan;
}

// --- invoices ---------------------------------------------------------------------------------

/** Provider order id of one charge attempt: `<invoice id>-<attempt>` (cuid2 ids have no dash). */
export const invoiceOrderId = (invoiceId: string, attempt: number) => `${invoiceId}-${attempt}`;
export function invoiceIdFromOrder(orderId: string): string | null {
  const i = orderId.lastIndexOf('-');
  return i > 0 && /^\d+$/.test(orderId.slice(i + 1)) ? orderId.slice(0, i) : null;
}

export async function getInvoice(db: DbOrTx, invoiceId: string): Promise<InvoiceRow | null> {
  const [r] = await db.select().from(billingInvoices).where(eq(billingInvoices.id, invoiceId));
  return r ?? null;
}

export async function listInvoices(db: DbOrTx, orgId: string, limit = 24) {
  return db
    .select({ invoice: billingInvoices, planCode: plans.code, planName: plans.name })
    .from(billingInvoices)
    .leftJoin(plans, eq(plans.id, billingInvoices.planId))
    .where(eq(billingInvoices.orgId, orgId))
    .orderBy(desc(billingInvoices.createdAt))
    .limit(limit);
}

async function currentSubscription(db: DbOrTx, orgId: string) {
  const [s] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId))
    .orderBy(desc(subscriptions.currentPeriodEnd))
    .limit(1);
  return s ?? null;
}

async function hasPaidInvoice(db: DbOrTx, orgId: string): Promise<boolean> {
  const [r] = await db
    .select({ id: billingInvoices.id })
    .from(billingInvoices)
    .where(and(eq(billingInvoices.orgId, orgId), eq(billingInvoices.status, 'paid')))
    .limit(1);
  return !!r;
}

/**
 * The invoice an owner pays to take `planCode`. Idempotent: an open invoice for the same plan is
 * returned as is. A different open invoice (older upgrade choice) is voided. Buying the plan the
 * org is already on pays the next period ("renewal"); a higher plan, or the first purchase after
 * a trial, starts a fresh period right away ("upgrade", no proration: the new price applies for a
 * whole month from the payment).
 */
export async function createCheckoutInvoice(
  db: Db,
  input: { orgId: string; planCode: string; now?: Date },
): Promise<InvoiceRow> {
  const now = input.now ?? new Date();
  const plan = await getPlanByCode(db, input.planCode);
  if (!plan || plan.code === 'starter')
    throw new BillingError('plan_unavailable', 'Paket ini tidak bisa dibeli.');
  if (!plan.priceMonthly || plan.priceMonthly <= 0)
    throw new BillingError('price_missing', `Harga paket ${plan.name} belum ditetapkan.`);

  return db.transaction(async (tx) => {
    // Serialize checkouts of one org.
    await tx.execute(sql`select id from orgs where id = ${input.orgId} for update`);
    const sub = await currentSubscription(tx, input.orgId);
    const ent = await resolveEntitlements(tx, input.orgId, now);
    if (!sub || !ent)
      throw new BillingError('no_subscription', 'Organisasi belum punya langganan.');
    const subscribedRank = PLAN_RANK[ent.subscribedPlanCode] ?? 0;
    const targetRank = PLAN_RANK[plan.code] ?? 0;
    const paying = ent.state === 'active' || ent.state === 'grace';
    if (paying && ent.subscribedPlanCode !== 'starter' && targetRank < subscribedRank)
      throw new BillingError(
        'downgrade_not_supported',
        'Turun paket otomatis terjadi bila langganan tidak diperpanjang.',
      );

    const sameAsCurrent =
      sub.planId === plan.id && sub.status !== 'trialing' && ent.state !== 'downgraded';
    const firstPurchase = !(await hasPaidInvoice(tx, input.orgId));
    const kind: 'upgrade' | 'renewal' = sameAsCurrent && !firstPurchase ? 'renewal' : 'upgrade';

    const open = await tx
      .select()
      .from(billingInvoices)
      .where(and(eq(billingInvoices.orgId, input.orgId), eq(billingInvoices.status, 'pending')));
    const same = open.find((i) => i.planId === plan.id && i.kind === kind);
    for (const i of open) {
      if (i !== same)
        await tx
          .update(billingInvoices)
          .set({ status: 'void', updatedAt: now })
          .where(eq(billingInvoices.id, i.id));
    }
    if (same) return same;

    const periodStart = kind === 'renewal' ? sub.currentPeriodEnd : now;
    const [inv] = await tx
      .insert(billingInvoices)
      .values({
        orgId: input.orgId,
        subscriptionId: sub.id,
        amount: plan.priceMonthly!,
        status: 'pending',
        planId: plan.id,
        kind,
        periodStart,
        periodEnd: addMonthsUtc(periodStart, 1),
        dueAt: kind === 'renewal' ? sub.currentPeriodEnd : now,
      })
      .returning();
    return inv!;
  });
}

/** Records a new charge attempt (before the provider call, so the order id is never reused). */
export async function beginInvoiceCharge(db: Db, invoiceId: string): Promise<InvoiceRow> {
  const [inv] = await db
    .update(billingInvoices)
    .set({ attempts: sql`${billingInvoices.attempts} + 1`, updatedAt: new Date() })
    .where(and(eq(billingInvoices.id, invoiceId), eq(billingInvoices.status, 'pending')))
    .returning();
  if (!inv) throw new BillingError('not_found', 'Tagihan tidak ada atau sudah tidak berlaku.');
  return inv;
}

export async function saveInvoiceCharge(
  db: Db,
  invoiceId: string,
  charge: { qrString: string; expiresAt: Date; providerRef: string | null; env: string },
) {
  await db
    .update(billingInvoices)
    .set({
      qrString: charge.qrString,
      qrExpiresAt: charge.expiresAt,
      providerRef: charge.providerRef,
      env: charge.env,
      updatedAt: new Date(),
    })
    .where(eq(billingInvoices.id, invoiceId));
}

export async function touchInvoiceChecked(db: Db, invoiceId: string, at: Date) {
  await db
    .update(billingInvoices)
    .set({ lastCheckedAt: at })
    .where(eq(billingInvoices.id, invoiceId));
}

export type InvoicePaid = {
  providerRef: string | null;
  paidAt: Date | null;
  grossAmount: number | null;
};

/**
 * A verified payment for an invoice. Idempotent (a repeated notification changes nothing) and
 * race-safe (invoice row locked). Activates the plan: sets the new period, clears the grace
 * window and voids other open invoices of the org.
 */
export async function applyInvoicePaid(
  db: Db,
  invoiceId: string,
  paid: InvoicePaid,
  now: Date = new Date(),
): Promise<{ changed: boolean; invoice: InvoiceRow }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from billing_invoices where id = ${invoiceId} for update`);
    const inv = await getInvoice(tx, invoiceId);
    if (!inv) throw new BillingError('not_found', 'Tagihan tidak ditemukan');
    if (inv.status === 'paid') return { changed: false, invoice: inv };
    if (paid.grossAmount !== null && paid.grossAmount !== inv.amount)
      throw new BillingError('amount_mismatch', 'Nominal pembayaran tidak sama dengan tagihan');

    const sub = await currentSubscription(tx, inv.orgId);
    const plan = inv.planId ? await tx.select().from(plans).where(eq(plans.id, inv.planId)) : [];
    if (!sub || !plan[0])
      throw new BillingError('no_subscription', 'Langganan/paket tidak ditemukan');

    let start: Date;
    if (inv.kind === 'renewal') {
      const wanted = inv.periodStart ?? sub.currentPeriodEnd;
      // Paying late (more than the grace window after the period ended) restarts the period now.
      start = wanted.getTime() >= now.getTime() - GRACE_DAYS * DAY_MS ? wanted : now;
    } else {
      start = now;
    }
    const end = addMonthsUtc(start, 1);
    const paidAt = paid.paidAt ?? now;

    const [updated] = await tx
      .update(billingInvoices)
      .set({
        status: 'paid',
        paidAt,
        providerRef: paid.providerRef ?? inv.providerRef,
        periodStart: start,
        periodEnd: end,
        updatedAt: now,
      })
      .where(eq(billingInvoices.id, invoiceId))
      .returning();
    await tx
      .update(subscriptions)
      .set({
        planId: plan[0].id,
        status: 'active',
        currentPeriodStart: start,
        currentPeriodEnd: end,
        graceUntil: null,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, sub.id));
    await tx
      .update(billingInvoices)
      .set({ status: 'void', updatedAt: now })
      .where(
        and(
          eq(billingInvoices.orgId, inv.orgId),
          eq(billingInvoices.status, 'pending'),
          ne(billingInvoices.id, invoiceId),
        ),
      );
    await tx.insert(auditLogs).values({
      orgId: inv.orgId,
      actorId: null,
      action: 'subscription.paid',
      entity: 'subscription',
      entityId: sub.id,
      before: { planId: sub.planId, status: sub.status, periodEnd: sub.currentPeriodEnd },
      after: { planCode: plan[0].code, invoiceId, periodStart: start, periodEnd: end },
    });
    return { changed: true, invoice: updated! };
  });
}

// --- lifecycle (worker, hourly) ------------------------------------------------------------------

export type LifecycleResult = {
  pastDue: number;
  downgraded: number;
  renewalInvoices: number;
};

/**
 * Moves subscriptions through their life; safe to run any number of times.
 *  1. period ended → `past_due`, grace window starts (full plan, banner in Studio)
 *  2. grace over   → Starter, open invoices voided (booths keep running, new limits apply)
 *  3. renewal invoice issued {@link RENEWAL_LEAD_DAYS} days before the period ends
 */
export async function runBillingLifecycle(
  db: Db,
  now: Date = new Date(),
  opts: { graceDays?: number; leadDays?: number } = {},
): Promise<LifecycleResult> {
  const graceDays = opts.graceDays ?? GRACE_DAYS;
  const leadDays = opts.leadDays ?? RENEWAL_LEAD_DAYS;
  const [starter] = await db.select().from(plans).where(eq(plans.code, 'starter'));
  const result: LifecycleResult = { pastDue: 0, downgraded: 0, renewalInvoices: 0 };

  // 1. paid/trial period over
  const ended = await db
    .select({ sub: subscriptions })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        ne(plans.code, 'starter'),
        inArray(subscriptions.status, ['trialing', 'active']),
        lte(subscriptions.currentPeriodEnd, now),
      ),
    );
  for (const { sub } of ended) {
    const graceUntil = new Date(sub.currentPeriodEnd.getTime() + graceDays * DAY_MS);
    await db
      .update(subscriptions)
      .set({ status: 'past_due', graceUntil, updatedAt: now })
      .where(eq(subscriptions.id, sub.id));
    await db.insert(auditLogs).values({
      orgId: sub.orgId,
      actorId: null,
      action: 'subscription.past_due',
      entity: 'subscription',
      entityId: sub.id,
      before: { status: sub.status },
      after: { status: 'past_due', graceUntil },
    });
    result.pastDue++;
  }

  // 2. grace over
  if (starter) {
    const overdue = await db
      .select({ sub: subscriptions })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(
        and(
          ne(plans.code, 'starter'),
          eq(subscriptions.status, 'past_due'),
          lte(subscriptions.graceUntil, now),
        ),
      );
    for (const { sub } of overdue) {
      await db.transaction(async (tx) => {
        await tx
          .update(subscriptions)
          .set({
            planId: starter.id,
            status: 'active',
            graceUntil: null,
            currentPeriodStart: now,
            currentPeriodEnd: addMonthsUtc(now, 1),
            updatedAt: now,
          })
          .where(eq(subscriptions.id, sub.id));
        await tx
          .update(billingInvoices)
          .set({ status: 'void', updatedAt: now })
          .where(and(eq(billingInvoices.orgId, sub.orgId), eq(billingInvoices.status, 'pending')));
        await tx.insert(auditLogs).values({
          orgId: sub.orgId,
          actorId: null,
          action: 'subscription.downgraded',
          entity: 'subscription',
          entityId: sub.id,
          before: { planId: sub.planId, status: sub.status },
          after: { planCode: 'starter', reason: 'grace_expired' },
        });
      });
      result.downgraded++;
    }
  }

  // 3. renewal invoices (paid plans that were paid for at least once, still within or near the period)
  const renewable = await db
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        ne(plans.code, 'starter'),
        inArray(subscriptions.status, ['active', 'past_due']),
        lte(subscriptions.currentPeriodEnd, new Date(now.getTime() + leadDays * DAY_MS)),
      ),
    );
  for (const { sub, plan } of renewable) {
    if (!plan.priceMonthly || plan.priceMonthly <= 0) continue;
    const [open] = await db
      .select({ id: billingInvoices.id })
      .from(billingInvoices)
      .where(and(eq(billingInvoices.orgId, sub.orgId), eq(billingInvoices.status, 'pending')))
      .limit(1);
    if (open) continue;
    const paidBefore = await hasPaidInvoice(db, sub.orgId);
    const kind = paidBefore ? 'renewal' : 'upgrade';
    const start = kind === 'renewal' ? sub.currentPeriodEnd : now;
    await db.insert(billingInvoices).values({
      orgId: sub.orgId,
      subscriptionId: sub.id,
      amount: plan.priceMonthly,
      status: 'pending',
      planId: plan.id,
      kind,
      periodStart: start,
      periodEnd: addMonthsUtc(start, 1),
      dueAt: sub.currentPeriodEnd,
    });
    result.renewalInvoices++;
  }
  return result;
}

// --- platform admin -------------------------------------------------------------------------------

export type AdminOrgRow = {
  orgId: string;
  name: string;
  slug: string;
  createdAt: Date;
  planCode: string | null;
  subscribedPlanCode: string | null;
  status: SubscriptionRow['status'] | null;
  state: EntitlementState | null;
  periodEnd: Date | null;
  graceUntil: Date | null;
  booths: number;
  openInvoices: number;
};

/** Every org with its plan and state. Platform admin only (cross-org read, owner connection). */
export async function adminListOrgs(db: Db, now: Date = new Date()): Promise<AdminOrgRow[]> {
  const rows = await db.select().from(orgs).orderBy(desc(orgs.createdAt));
  const boothCounts = await db.execute<{ org_id: string; n: number }>(
    sql`select org_id, count(*)::int as n from booths group by org_id`,
  );
  const invCounts = await db.execute<{ org_id: string; n: number }>(
    sql`select org_id, count(*)::int as n from billing_invoices where status = 'pending' group by org_id`,
  );
  const list = (r: unknown) =>
    (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as { org_id: string; n: number }[];
  const booths = new Map(list(boothCounts).map((r) => [r.org_id, Number(r.n)]));
  const invoices = new Map(list(invCounts).map((r) => [r.org_id, Number(r.n)]));
  const out: AdminOrgRow[] = [];
  for (const o of rows) {
    const e = await resolveEntitlements(db, o.id, now);
    out.push({
      orgId: o.id,
      name: o.name,
      slug: o.slug,
      createdAt: o.createdAt,
      planCode: e?.planCode ?? null,
      subscribedPlanCode: e?.subscribedPlanCode ?? null,
      status: e?.status ?? null,
      state: e?.state ?? null,
      periodEnd: e?.periodEnd ?? null,
      graceUntil: e?.graceUntil ?? null,
      booths: booths.get(o.id) ?? 0,
      openInvoices: invoices.get(o.id) ?? 0,
    });
  }
  return out;
}

/** Platform admin: set an org's plan by hand (support, comps, corrections). Always audited. */
export async function adminSetSubscription(
  db: Db,
  input: {
    orgId: string;
    planCode: string;
    status: SubscriptionRow['status'];
    /** Days from now the period lasts. Default 30. */
    periodDays?: number;
    actorId: string | null;
    note?: string;
  },
  now: Date = new Date(),
) {
  const plan = await getPlanByCode(db, input.planCode);
  if (!plan) throw new BillingError('not_found', 'Paket tidak ditemukan');
  const days = input.periodDays ?? 30;
  if (!Number.isInteger(days) || days < 0 || days > 3650)
    throw new BillingError('invalid', 'Lama periode tidak valid');
  await db.transaction(async (tx) => {
    const sub = await currentSubscription(tx, input.orgId);
    const end = new Date(now.getTime() + days * DAY_MS);
    if (sub) {
      await tx
        .update(subscriptions)
        .set({
          planId: plan.id,
          status: input.status,
          currentPeriodStart: now,
          currentPeriodEnd: end,
          graceUntil: null,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, sub.id));
    } else {
      await tx.insert(subscriptions).values({
        orgId: input.orgId,
        planId: plan.id,
        status: input.status,
        currentPeriodStart: now,
        currentPeriodEnd: end,
      });
    }
    await tx
      .update(billingInvoices)
      .set({ status: 'void', updatedAt: now })
      .where(and(eq(billingInvoices.orgId, input.orgId), eq(billingInvoices.status, 'pending')));
    await tx.insert(auditLogs).values({
      orgId: input.orgId,
      actorId: input.actorId,
      action: 'subscription.admin_set',
      entity: 'subscription',
      entityId: sub?.id ?? input.orgId,
      before: sub
        ? { planId: sub.planId, status: sub.status, periodEnd: sub.currentPeriodEnd }
        : null,
      after: {
        planCode: plan.code,
        status: input.status,
        periodEnd: end,
        note: input.note ?? null,
      },
    });
  });
}
