import { createId } from '@paralleldrive/cuid2';
import { hashPassword } from '@pb/crypto';
import { BUILTIN_TEMPLATES, buildTemplateConfig, createDefaultBoothConfig } from '@pb/schema';
import { eq, sql } from 'drizzle-orm';
import { AUTH_SHIM_MARKER } from './auth-shim';
import {
  boothConfigs,
  boothDrafts,
  booths,
  orgMembers,
  orgs,
  plans,
  subscriptions,
  templates,
  type PlanFeatures,
  type PlanLimits,
} from './schema';
import type { Db } from './types';

export const DEMO_USER = { email: 'demo@photobooth.local', password: 'demo12345' } as const;
export const DEMO_ORG_SLUG = 'demo';

type PlanSeed = {
  code: 'starter' | 'pro' | 'business';
  name: string;
  limits: PlanLimits;
  features: PlanFeatures;
};

// Prices are undecided (docs/open-questions.md #2), so price_monthly stays null.
export const PLAN_SEEDS: PlanSeed[] = [
  {
    code: 'starter',
    name: 'Starter',
    // Starter keeps 30 days of recap (PRD §11).
    limits: { maxBooths: 1, maxDevicesPerBooth: 1, maxFrames: 5, recapDays: 30 },
    features: {
      dslr: false,
      liveClip: false,
      video: false,
      watermarkRemoval: false,
      customDomain: false,
      export: false,
      auditLog: false,
      staff: false,
    },
  },
  {
    code: 'pro',
    name: 'Pro',
    limits: { maxBooths: 3, maxDevicesPerBooth: 2, maxFrames: null },
    features: {
      dslr: true,
      liveClip: true,
      video: true,
      watermarkRemoval: true,
      customDomain: false,
      export: true,
      auditLog: false,
      staff: false,
    },
  },
  {
    code: 'business',
    name: 'Business',
    limits: { maxBooths: 10, maxDevicesPerBooth: null, maxFrames: null },
    features: {
      dslr: true,
      liveClip: true,
      video: true,
      watermarkRemoval: true,
      customDomain: true,
      export: true,
      auditLog: true,
      staff: true,
    },
  },
];

export async function seedPlans(db: Db): Promise<void> {
  for (const p of PLAN_SEEDS) {
    await db
      .insert(plans)
      .values({ code: p.code, name: p.name, limits: p.limits, features: p.features })
      .onConflictDoUpdate({
        target: plans.code,
        set: { name: p.name, limits: p.limits, features: p.features },
      });
  }
}

/** Built-in public templates (upsert by key). */
export async function seedTemplates(db: Db): Promise<void> {
  for (const t of BUILTIN_TEMPLATES) {
    const values = {
      key: t.key,
      name: t.name,
      description: t.description,
      config: buildTemplateConfig(t),
      isPublic: true,
    };
    await db
      .insert(templates)
      .values(values)
      .onConflictDoUpdate({ target: templates.key, set: values });
  }
}

export async function isAuthShim(db: Db): Promise<boolean> {
  const rows = await db.execute<{ marker: string | null }>(
    sql`select obj_description('auth'::regnamespace, 'pg_namespace') as marker`,
  );
  const first = (
    Array.isArray(rows) ? rows[0] : (rows as { rows: { marker: string | null }[] }).rows[0]
  ) as { marker: string | null } | undefined;
  return first?.marker === AUTH_SHIM_MARKER;
}

/** Shim databases only: insert a user into auth.users. Returns the user id. */
export async function createShimUser(db: Db, email: string, password: string): Promise<string> {
  const rows = await db.execute<{ id: string }>(sql`
    insert into auth.users (email, encrypted_password)
    values (${email.toLowerCase()}, ${hashPassword(password)})
    on conflict (email) do update set email = excluded.email
    returning id`);
  const list = Array.isArray(rows) ? rows : (rows as { rows: { id: string }[] }).rows;
  return list[0]!.id;
}

/**
 * Idempotent seed: 3 plans, 1 demo org, 1 demo booth (draft + published v1).
 * On shim databases also creates the demo user (owner of the demo org).
 */
export async function seed(
  db: Db,
): Promise<{ orgId: string; boothId: string; userId: string | null }> {
  await seedPlans(db);
  await seedTemplates(db);

  const shim = await isAuthShim(db);
  const userId = shim ? await createShimUser(db, DEMO_USER.email, DEMO_USER.password) : null;

  const existing = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, DEMO_ORG_SLUG));
  if (existing[0]) {
    const [booth] = await db
      .select({ id: booths.id })
      .from(booths)
      .where(eq(booths.orgId, existing[0].id));
    return { orgId: existing[0].id, boothId: booth?.id ?? '', userId };
  }

  return db.transaction(async (tx) => {
    const orgId = createId();
    const boothId = createId();
    const configId = createId();
    const [pro] = await tx.select({ id: plans.id }).from(plans).where(eq(plans.code, 'pro'));
    const now = new Date();

    await tx.insert(orgs).values({ id: orgId, name: 'Demo Photobooth', slug: DEMO_ORG_SLUG });
    if (userId) await tx.insert(orgMembers).values({ orgId, userId, role: 'owner' });
    await tx.insert(subscriptions).values({
      orgId,
      planId: pro!.id,
      status: 'trialing',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 14 * 24 * 3600 * 1000),
    });

    const draft = createDefaultBoothConfig({ boothId, boothName: 'Booth Demo' });
    await tx.insert(booths).values({ id: boothId, orgId, name: 'Booth Demo' });
    await tx.insert(boothDrafts).values({ orgId, boothId, config: draft, updatedBy: userId });
    await tx.insert(boothConfigs).values({
      id: configId,
      orgId,
      boothId,
      version: 1,
      config: { ...draft, configVersion: 1 },
      publishedBy: userId,
    });
    await tx.update(booths).set({ activeConfigId: configId }).where(eq(booths.id, boothId));
    return { orgId, boothId, userId };
  });
}
