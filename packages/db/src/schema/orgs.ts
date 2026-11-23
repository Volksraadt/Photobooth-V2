import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps, tz } from './_common';

export const memberRole = pgEnum('member_role', ['owner', 'manager', 'operator']);
export const planCode = pgEnum('plan_code', ['starter', 'pro', 'business']);
export const subscriptionStatus = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
]);
export const invoiceStatus = pgEnum('invoice_status', [
  'pending',
  'paid',
  'expired',
  'failed',
  'void',
]);

export type PlanLimits = {
  /** null = unlimited */
  maxBooths: number | null;
  maxDevicesPerBooth: number | null;
  maxFrames: number | null;
};

export type PlanFeatures = {
  dslr: boolean;
  liveClip: boolean;
  video: boolean;
  watermarkRemoval: boolean;
  customDomain: boolean;
  export: boolean;
  auditLog: boolean;
  staff: boolean;
};

export const orgs = pgTable('orgs', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  timezone: text('timezone').notNull().default('Asia/Jakarta'),
  ...timestamps,
});

export const orgMembers = pgTable(
  'org_members',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    /** auth.users.id (Supabase). FK added in the RLS migration since auth schema is external. */
    userId: uuid('user_id').notNull(),
    role: memberRole('role').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('org_members_org_user_uq').on(t.orgId, t.userId),
    index('org_members_user_idx').on(t.userId),
  ],
);

export const plans = pgTable('plans', {
  id: id(),
  code: planCode('code').notNull().unique(),
  name: text('name').notNull(),
  /** IDR. null = price not decided yet (docs/open-questions.md #2). */
  priceMonthly: integer('price_monthly'),
  limits: jsonb('limits').$type<PlanLimits>().notNull(),
  features: jsonb('features').$type<PlanFeatures>().notNull(),
  ...timestamps,
});

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id),
    status: subscriptionStatus('status').notNull(),
    currentPeriodStart: tz('current_period_start').notNull(),
    currentPeriodEnd: tz('current_period_end').notNull(),
    graceUntil: tz('grace_until'),
    ...timestamps,
  },
  (t) => [index('subscriptions_org_idx').on(t.orgId)],
);

export const billingInvoices = pgTable(
  'billing_invoices',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => subscriptions.id),
    amount: integer('amount').notNull(),
    status: invoiceStatus('status').notNull(),
    providerRef: text('provider_ref'),
    paidAt: tz('paid_at'),
    ...timestamps,
  },
  (t) => [index('billing_invoices_org_idx').on(t.orgId)],
);
