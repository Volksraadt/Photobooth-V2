import { resolveEntitlements } from './billing-repo';
import { createId } from '@paralleldrive/cuid2';
import {
  createDefaultBoothConfig,
  instantiateTemplate,
  pruneUnusedAssets,
  type BoothConfig,
} from '@pb/schema';
import { and, asc, count, desc, eq, isNull, max, sql } from 'drizzle-orm';
import {
  assets,
  auditLogs,
  boothConfigs,
  boothDrafts,
  booths,
  devices,
  templates,
  type PlanLimits,
} from './schema';
import type { Tx } from './types';

/**
 * F2 Studio data access (editor, publish, versions, assets, templates, devices).
 * Every function takes a Tx from withUserContext(): RLS enforces org access.
 */

export class PlanLimitError extends Error {
  constructor(
    readonly limit: keyof PlanLimits,
    readonly max: number,
    readonly planName: string,
  ) {
    super(`Batas paket ${planName}: maksimal ${max}`);
    this.name = 'PlanLimitError';
  }
}

export type OrgPlan = { code: string; name: string; limits: PlanLimits };

/** Plan of the org's current subscription (latest one). */
export async function getOrgPlan(tx: Tx, orgId: string): Promise<OrgPlan | null> {
  // Effective plan: a lapsed subscription keeps its limits for the grace period, then Starter.
  const e = await resolveEntitlements(tx, orgId);
  return e ? { code: e.planCode, name: e.planName, limits: e.limits } : null;
}

// --- Templates & booth creation --------------------------------------------------------------

export async function listTemplates(tx: Tx) {
  return tx
    .select({
      id: templates.id,
      key: templates.key,
      name: templates.name,
      description: templates.description,
      config: templates.config,
    })
    .from(templates)
    .where(eq(templates.isPublic, true))
    .orderBy(asc(templates.name));
}

/** Creates a booth + draft from a template (or the default design). Enforces maxBooths. */
export async function createBoothFromTemplate(
  tx: Tx,
  input: {
    orgId: string;
    name: string;
    timezone: string;
    userId: string;
    templateId?: string | null;
  },
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (!name) throw new Error('Nama booth wajib diisi');
  const plan = await getOrgPlan(tx, input.orgId);
  const maxBooths = plan?.limits.maxBooths ?? null;
  if (plan && maxBooths !== null) {
    const [row] = await tx.select({ n: count() }).from(booths).where(eq(booths.orgId, input.orgId));
    if ((row?.n ?? 0) >= maxBooths) throw new PlanLimitError('maxBooths', maxBooths, plan.name);
  }
  const id = createId();
  let config: BoothConfig | null = null;
  if (input.templateId) {
    const [t] = await tx
      .select({ config: templates.config })
      .from(templates)
      .where(eq(templates.id, input.templateId));
    if (!t) throw new Error('Template tidak ditemukan');
    config = instantiateTemplate(t.config as BoothConfig, {
      boothId: id,
      boothName: name,
      timezone: input.timezone,
    });
  }
  await tx.insert(booths).values({ id, orgId: input.orgId, name, timezone: input.timezone });
  config ??= createDefaultBoothConfig({ boothId: id, boothName: name, timezone: input.timezone });
  await tx
    .insert(boothDrafts)
    .values({ orgId: input.orgId, boothId: id, config, updatedBy: input.userId });
  return { id };
}

// --- Draft & publish -------------------------------------------------------------------------

export async function saveDraft(
  tx: Tx,
  input: { boothId: string; config: BoothConfig; userId: string },
) {
  const rows = await tx
    .update(boothDrafts)
    .set({ config: input.config, updatedBy: input.userId })
    .where(eq(boothDrafts.boothId, input.boothId))
    .returning({ updatedAt: boothDrafts.updatedAt });
  if (!rows[0]) throw new Error('Draft tidak ditemukan atau tidak boleh diubah');
  return rows[0];
}

export const BOOTH_CONFIG_CHANNEL = 'pb_booth_config';

/**
 * Publishes a (validated) config as a new immutable version and activates it.
 * Unused AssetRefs are pruned; devices are notified via pg_notify.
 */
export async function publishConfig(
  tx: Tx,
  input: {
    boothId: string;
    config: BoothConfig;
    userId: string;
    action?: 'publish' | 'rollback';
    fromVersion?: number;
  },
): Promise<{ id: string; version: number }> {
  const [booth] = await tx
    .select({ id: booths.id, orgId: booths.orgId })
    .from(booths)
    .where(eq(booths.id, input.boothId));
  if (!booth) throw new Error('Booth tidak ditemukan');

  const plan = await getOrgPlan(tx, booth.orgId);
  const maxFrames = plan?.limits.maxFrames ?? null;
  if (plan && maxFrames !== null && input.config.frames.length > maxFrames) {
    throw new PlanLimitError('maxFrames', maxFrames, plan.name);
  }

  const [last] = await tx
    .select({ v: max(boothConfigs.version) })
    .from(boothConfigs)
    .where(eq(boothConfigs.boothId, booth.id));
  const version = (last?.v ?? 0) + 1;
  const config: BoothConfig = {
    ...pruneUnusedAssets(input.config),
    boothId: booth.id,
    configVersion: version,
  };
  const id = createId();
  await tx.insert(boothConfigs).values({
    id,
    orgId: booth.orgId,
    boothId: booth.id,
    version,
    config,
    publishedBy: input.userId,
  });
  await tx.update(booths).set({ activeConfigId: id }).where(eq(booths.id, booth.id));
  await tx.insert(auditLogs).values({
    orgId: booth.orgId,
    actorId: input.userId,
    action: input.action === 'rollback' ? 'booth.rollback' : 'booth.publish',
    entity: 'booth_config',
    entityId: id,
    after: { boothId: booth.id, version, fromVersion: input.fromVersion ?? null },
  });
  await tx.execute(sql`select pg_notify(${BOOTH_CONFIG_CHANNEL}, ${booth.id})`);
  return { id, version };
}

export async function listConfigVersions(tx: Tx, boothId: string) {
  return tx
    .select({
      id: boothConfigs.id,
      version: boothConfigs.version,
      publishedAt: boothConfigs.publishedAt,
      publishedBy: boothConfigs.publishedBy,
      activeConfigId: booths.activeConfigId,
    })
    .from(boothConfigs)
    .innerJoin(booths, eq(booths.id, boothConfigs.boothId))
    .where(eq(boothConfigs.boothId, boothId))
    .orderBy(desc(boothConfigs.version));
}

export async function getConfigVersion(tx: Tx, boothId: string, version: number) {
  const [row] = await tx
    .select({ id: boothConfigs.id, version: boothConfigs.version, config: boothConfigs.config })
    .from(boothConfigs)
    .where(and(eq(boothConfigs.boothId, boothId), eq(boothConfigs.version, version)));
  return row ?? null;
}

// --- Assets ---------------------------------------------------------------------------------

export type AssetRow = typeof assets.$inferSelect;

export async function listAssets(tx: Tx, orgId: string): Promise<AssetRow[]> {
  return tx.select().from(assets).where(eq(assets.orgId, orgId)).orderBy(desc(assets.createdAt));
}

export async function insertAsset(
  tx: Tx,
  input: Omit<typeof assets.$inferInsert, 'createdAt' | 'updatedAt'>,
): Promise<AssetRow> {
  const [row] = await tx.insert(assets).values(input).returning();
  return row!;
}

// --- Devices --------------------------------------------------------------------------------

export async function listDevices(tx: Tx, boothId: string) {
  return tx
    .select({
      id: devices.id,
      name: devices.name,
      platform: devices.platform,
      appVersion: devices.appVersion,
      lastHeartbeatAt: devices.lastHeartbeatAt,
      lastConfigVersion: devices.lastConfigVersion,
      cameraStatus: devices.cameraStatus,
      revokedAt: devices.revokedAt,
      createdAt: devices.createdAt,
    })
    .from(devices)
    .where(eq(devices.boothId, boothId))
    .orderBy(asc(devices.createdAt));
}

export async function revokeDevice(tx: Tx, deviceId: string, userId: string) {
  const [row] = await tx
    .update(devices)
    .set({ revokedAt: new Date() })
    .where(and(eq(devices.id, deviceId), isNull(devices.revokedAt)))
    .returning({ orgId: devices.orgId });
  if (row) {
    await tx.insert(auditLogs).values({
      orgId: row.orgId,
      actorId: userId,
      action: 'device.revoke',
      entity: 'device',
      entityId: deviceId,
    });
  }
  return !!row;
}
