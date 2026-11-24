import { createId } from '@paralleldrive/cuid2';
import type { BoothConfig } from '@pb/schema';
import { and, count, eq, inArray, isNull, lt } from 'drizzle-orm';
import { getOrgPlan, PlanLimitError } from './booth-repo';
import {
  auditLogs,
  boothConfigs,
  booths,
  deviceEvents,
  devices,
  pairingCodes,
  printJobs,
  sessions,
} from './schema';
import type { Db, Tx } from './types';

/**
 * Device-side data access for apps/api. Uses the owner connection (no RLS), so every
 * query is scoped explicitly: pairing by code + token hash, device queries by device org.
 */

export const PAIRING_TTL_MS = 10 * 60 * 1000;

function sixDigits(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return n.toString().padStart(6, '0');
}

/** Kiosk asks for a pairing code, proving later possession of its token by the hash. */
export async function createPairingCode(
  db: Db,
  input: { tokenHash: string; fingerprint: string },
): Promise<{ code: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = sixDigits();
    // Expired codes are reused: free them first.
    await db
      .delete(pairingCodes)
      .where(and(eq(pairingCodes.code, code), lt(pairingCodes.expiresAt, new Date())));
    const rows = await db
      .insert(pairingCodes)
      .values({ code, deviceFingerprint: input.fingerprint, tokenHash: input.tokenHash, expiresAt })
      .onConflictDoNothing()
      .returning({ code: pairingCodes.code });
    if (rows[0]) return { code, expiresAt };
  }
  throw new Error('Tidak bisa membuat kode pairing');
}

export type PairingStatus =
  | { status: 'pending'; expiresAt: Date }
  | { status: 'claimed'; boothId: string }
  | { status: 'expired' }
  | { status: 'unknown' };

export async function pairingStatus(
  db: Db,
  code: string,
  tokenHash: string,
): Promise<PairingStatus> {
  const [row] = await db
    .select()
    .from(pairingCodes)
    .where(and(eq(pairingCodes.code, code), eq(pairingCodes.tokenHash, tokenHash)));
  if (!row) return { status: 'unknown' };
  if (row.claimedBoothId) return { status: 'claimed', boothId: row.claimedBoothId };
  if (row.expiresAt.getTime() < Date.now()) return { status: 'expired' };
  return { status: 'pending', expiresAt: row.expiresAt };
}

export class PairingError extends Error {
  constructor(readonly code: 'invalid' | 'expired') {
    super(code === 'expired' ? 'Kode pairing kedaluwarsa' : 'Kode pairing tidak ditemukan');
    this.name = 'PairingError';
  }
}

/**
 * Owner/manager enters the code in Studio. The caller has already verified the user may edit
 * the booth. Creates the device with the kiosk-generated token hash; enforces maxDevicesPerBooth.
 */
export async function claimPairingCode(
  db: Db,
  input: { code: string; boothId: string; orgId: string; name: string; userId: string },
): Promise<{ deviceId: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(pairingCodes)
      .where(and(eq(pairingCodes.code, input.code), isNull(pairingCodes.claimedBoothId)))
      .for('update');
    if (!row?.tokenHash) throw new PairingError('invalid');
    if (row.expiresAt.getTime() < Date.now()) throw new PairingError('expired');

    const plan = await getOrgPlan(tx as unknown as Tx, input.orgId);
    const max = plan?.limits.maxDevicesPerBooth ?? null;
    if (plan && max !== null) {
      const [n] = await tx
        .select({ n: count() })
        .from(devices)
        .where(
          and(
            eq(devices.boothId, input.boothId),
            eq(devices.orgId, input.orgId),
            isNull(devices.revokedAt),
          ),
        );
      if ((n?.n ?? 0) >= max) throw new PlanLimitError('maxDevicesPerBooth', max, plan.name);
    }

    const deviceId = createId();
    await tx.insert(devices).values({
      id: deviceId,
      orgId: input.orgId,
      boothId: input.boothId,
      name: input.name,
      tokenHash: row.tokenHash,
    });
    await tx
      .update(pairingCodes)
      .set({ claimedBoothId: input.boothId })
      .where(eq(pairingCodes.id, row.id));
    await tx.insert(auditLogs).values({
      orgId: input.orgId,
      actorId: input.userId,
      action: 'device.pair',
      entity: 'device',
      entityId: deviceId,
      after: { boothId: input.boothId, name: input.name },
    });
    return { deviceId };
  });
}

/** Active published config of the device's booth (scoped to the device org). */
export async function activeConfigForDevice(
  db: Db,
  device: { orgId: string; boothId: string | null },
): Promise<{ id: string; version: number; config: BoothConfig } | null> {
  if (!device.boothId) return null;
  const [row] = await db
    .select({ id: boothConfigs.id, version: boothConfigs.version, config: boothConfigs.config })
    .from(booths)
    .innerJoin(
      boothConfigs,
      and(eq(boothConfigs.id, booths.activeConfigId), eq(boothConfigs.orgId, device.orgId)),
    )
    .where(and(eq(booths.id, device.boothId), eq(booths.orgId, device.orgId)));
  return row ?? null;
}

export async function recordHeartbeat(
  db: Db,
  device: { id: string; orgId: string },
  input: {
    configVersion?: number | null;
    appVersion?: string | null;
    platform?: string | null;
    cameraStatus?: 'ok' | 'error' | 'disconnected' | 'unknown';
    printerStatus?: 'ok' | 'warning' | 'error' | 'disconnected' | 'unknown';
    /** Items the agent still has to deliver (F6: "data belum tersinkron"). */
    outboxPending?: number;
    uploadsPending?: number;
  },
) {
  await db
    .update(devices)
    .set({
      lastHeartbeatAt: new Date(),
      ...(input.configVersion !== undefined ? { lastConfigVersion: input.configVersion } : {}),
      ...(input.appVersion ? { appVersion: input.appVersion } : {}),
      ...(input.platform ? { platform: input.platform } : {}),
      ...(input.cameraStatus ? { cameraStatus: input.cameraStatus } : {}),
      ...(input.printerStatus ? { printerStatus: input.printerStatus } : {}),
      ...(input.outboxPending !== undefined ? { outboxPending: input.outboxPending } : {}),
      ...(input.uploadsPending !== undefined ? { uploadsPending: input.uploadsPending } : {}),
    })
    .where(and(eq(devices.id, device.id), eq(devices.orgId, device.orgId)));
}

export type DeviceEventInput = {
  /** Agent outbox id: makes delivery idempotent (retries after a lost response). */
  id: string;
  level: 'info' | 'warn' | 'error';
  kind: string;
  message: string | null;
  data: unknown;
  occurredAt: Date;
};

export type DevicePrintJobInput = {
  id: string;
  sessionCode: string | null;
  sheets: number;
  status: 'queued' | 'printing' | 'done' | 'failed';
  occurredAt: Date;
};

/**
 * Stores events and print jobs sent from a device's outbox, scoped to the device org.
 * Rows are keyed by the outbox id, so re-sending a batch inserts nothing twice. Returns the
 * ids that are now stored (new or already present). A print job links to its session only if
 * that session (by code) already exists in the same org.
 */
export async function recordDeviceOutbox(
  db: Db,
  device: { id: string; orgId: string },
  input: { events: DeviceEventInput[]; printJobs: DevicePrintJobInput[] },
): Promise<string[]> {
  const accepted: string[] = [];
  if (input.events.length) {
    await db
      .insert(deviceEvents)
      .values(
        input.events.map((e) => ({
          id: e.id,
          orgId: device.orgId,
          deviceId: device.id,
          level: e.level,
          kind: e.kind,
          message: e.message,
          data: e.data ?? null,
          occurredAt: e.occurredAt,
        })),
      )
      .onConflictDoNothing({ target: deviceEvents.id });
    const stored = await db
      .select({ id: deviceEvents.id })
      .from(deviceEvents)
      .where(
        and(
          eq(deviceEvents.orgId, device.orgId),
          eq(deviceEvents.deviceId, device.id),
          inArray(
            deviceEvents.id,
            input.events.map((e) => e.id),
          ),
        ),
      );
    accepted.push(...stored.map((r) => r.id));
  }
  if (input.printJobs.length) {
    const codes = [
      ...new Set(input.printJobs.map((j) => j.sessionCode).filter((c): c is string => !!c)),
    ];
    const known = codes.length
      ? await db
          .select({ id: sessions.id, code: sessions.code })
          .from(sessions)
          .where(and(eq(sessions.orgId, device.orgId), inArray(sessions.code, codes)))
      : [];
    const byCode = new Map(known.map((s) => [s.code, s.id]));
    await db
      .insert(printJobs)
      .values(
        input.printJobs.map((j) => ({
          id: j.id,
          orgId: device.orgId,
          deviceId: device.id,
          sessionId: j.sessionCode ? (byCode.get(j.sessionCode) ?? null) : null,
          sheets: j.sheets,
          status: j.status,
          occurredAt: j.occurredAt,
        })),
      )
      .onConflictDoNothing({ target: printJobs.id });
    const stored = await db
      .select({ id: printJobs.id })
      .from(printJobs)
      .where(
        and(
          eq(printJobs.orgId, device.orgId),
          eq(printJobs.deviceId, device.id),
          inArray(
            printJobs.id,
            input.printJobs.map((j) => j.id),
          ),
        ),
      );
    accepted.push(...stored.map((r) => r.id));
  }
  return accepted;
}
