import { resolveEntitlements } from './billing-repo';
import type { BoothConfig } from '@pb/schema';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  boothConfigs,
  booths,
  driveConnections,
  sessionOutputs,
  sessions,
  uploadJobs,
} from './schema';
import type { PlanFeatures } from './schema/orgs';
import type { Db } from './types';

/**
 * F5 output pipeline: files from the agent, `upload_jobs` (the job state of record; BullMQ only
 * wakes the worker), Drive connection and the data behind `/s/:code`. Used by apps/api and
 * apps/worker on the owner connection, so every query is scoped by an explicit org.
 */

type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
export type SessionRow = typeof sessions.$inferSelect;
export type OutputRow = typeof sessionOutputs.$inferSelect;
export type UploadJobRow = typeof uploadJobs.$inferSelect;
export type DriveConnectionRow = typeof driveConnections.$inferSelect;
export type DeviceScope = { id: string; orgId: string; boothId: string | null };
export type OutputKindName = (typeof sessionOutputs.$inferSelect)['kind'];

export class OutputRepoError extends Error {
  constructor(
    readonly code: 'session_unknown' | 'missing_files' | 'not_found' | 'nothing_to_retry',
    message: string,
    readonly missing: string[] = [],
  ) {
    super(message);
    this.name = 'OutputRepoError';
  }
}

/** Machine-readable job failures (upload_jobs.error_code); Studio maps them to Indonesian text. */
export const JOB_ERROR = {
  driveNotConnected: 'drive_not_connected',
  driveRevoked: 'drive_revoked',
  driveQuota: 'drive_quota',
  driveFolderMissing: 'drive_folder_missing',
  storageMissing: 'storage_missing',
  configMissing: 'config_missing',
  failed: 'failed',
} as const;

/** Errors that will not fix themselves: no automatic retry, the owner has to act. */
export const OWNER_ACTION_CODES: string[] = [
  JOB_ERROR.driveNotConnected,
  JOB_ERROR.driveRevoked,
  JOB_ERROR.driveQuota,
  JOB_ERROR.driveFolderMissing,
];

// --- session files (agent → storage) ------------------------------------------------------

/** The device's own session (same org and booth), or null. */
export async function deviceSession(
  db: DbOrTx,
  device: DeviceScope,
  sessionId: string,
): Promise<SessionRow | null> {
  if (!device.boothId) return null;
  const [row] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.orgId, device.orgId),
        eq(sessions.boothId, device.boothId),
      ),
    );
  return row ?? null;
}

export async function findOutputBySource(db: DbOrTx, sessionId: string, sourceFileId: string) {
  const [row] = await db
    .select()
    .from(sessionOutputs)
    .where(
      and(eq(sessionOutputs.sessionId, sessionId), eq(sessionOutputs.sourceFileId, sourceFileId)),
    );
  return row ?? null;
}

export type StoredFileInput = {
  sourceFileId: string;
  kind: OutputKindName;
  name: string;
  storagePath: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  slotIndex: number | null;
};

/** Records (or refreshes) a file that is now in object storage. Idempotent per source file id. */
export async function recordStoredFile(
  db: DbOrTx,
  session: Pick<SessionRow, 'id' | 'orgId'>,
  f: StoredFileInput,
): Promise<void> {
  await db
    .insert(sessionOutputs)
    .values({
      orgId: session.orgId,
      sessionId: session.id,
      kind: f.kind,
      name: f.name,
      storagePath: f.storagePath,
      sha256: f.sha256,
      bytes: f.bytes,
      mimeType: f.mimeType,
      slotIndex: f.slotIndex,
      sourceFileId: f.sourceFileId,
      status: 'stored',
    })
    .onConflictDoUpdate({
      target: [sessionOutputs.sessionId, sessionOutputs.sourceFileId],
      targetWhere: sql`${sessionOutputs.sourceFileId} is not null`,
      set: {
        storagePath: f.storagePath,
        sha256: f.sha256,
        bytes: f.bytes,
        mimeType: f.mimeType,
        name: f.name,
        status: 'stored',
        updatedAt: new Date(),
      },
    });
}

/**
 * The agent says "everything is uploaded". Verifies every listed file is stored with the same
 * hash, saves the manifest and creates the storage job the worker picks up.
 */
export async function completeSessionFiles(
  db: Db,
  device: DeviceScope,
  sessionId: string,
  manifest: { files: { id: string; sha256: string }[] } & Record<string, unknown>,
): Promise<{ session: SessionRow }> {
  const session = await deviceSession(db, device, sessionId);
  if (!session) throw new OutputRepoError('session_unknown', 'Sesi belum diterima server');
  const ids = manifest.files.map((f) => f.id);
  const rows = await db
    .select()
    .from(sessionOutputs)
    .where(and(eq(sessionOutputs.sessionId, sessionId), inArray(sessionOutputs.sourceFileId, ids)));
  const bySource = new Map(rows.map((r) => [r.sourceFileId, r]));
  const missing = manifest.files
    .filter((f) => bySource.get(f.id)?.sha256 !== f.sha256 || !bySource.get(f.id)?.storagePath)
    .map((f) => f.id);
  if (missing.length > 0) {
    throw new OutputRepoError('missing_files', 'Ada file yang belum tersimpan di server', missing);
  }
  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({
        manifest,
        filesCompleteAt: session.filesCompleteAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));
    await tx
      .insert(uploadJobs)
      .values({ orgId: session.orgId, sessionId, target: 'storage', status: 'pending' })
      .onConflictDoNothing();
  });
  return { session };
}

// --- jobs -----------------------------------------------------------------------------------

/** A job stuck in `running` longer than this belongs to a crashed worker and is taken over. */
export const JOB_STALE_MS = 10 * 60_000;

/**
 * Atomically takes the next due job (pending and past its backoff, or `running` but stale).
 * `FOR UPDATE SKIP LOCKED`: several workers never take the same job.
 */
export async function claimNextJob(
  db: Db,
  opts: { now?: Date; sessionId?: string } = {},
): Promise<UploadJobRow | null> {
  const now = opts.now ?? new Date();
  const stale = new Date(now.getTime() - JOB_STALE_MS);
  const nowIso = now.toISOString();
  const staleIso = stale.toISOString();
  const only = opts.sessionId ? sql`and session_id = ${opts.sessionId}` : sql``;
  const res = await db.execute<{ id: string }>(sql`
    update upload_jobs set status = 'running', attempts = attempts + 1, updated_at = ${nowIso}::timestamptz
    where id = (
      select id from upload_jobs
      where ((status = 'pending' and (next_attempt_at is null or next_attempt_at <= ${nowIso}::timestamptz))
         or (status = 'running' and updated_at < ${staleIso}::timestamptz)) ${only}
      order by case target when 'storage' then 0 else 1 end, created_at
      limit 1
      for update skip locked
    )
    returning id`);
  const list = Array.isArray(res) ? res : (res as unknown as { rows: { id: string }[] }).rows;
  const id = list[0]?.id;
  if (!id) return null;
  const [job] = await db.select().from(uploadJobs).where(eq(uploadJobs.id, id));
  return job ?? null;
}

export async function finishJob(db: DbOrTx, jobId: string) {
  await db
    .update(uploadJobs)
    .set({
      status: 'done',
      lastError: null,
      errorCode: null,
      nextAttemptAt: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(uploadJobs.id, jobId));
}

/** `retryAt` = back to pending with backoff; null = failed for good (owner/Studio must retry). */
export async function failJob(
  db: DbOrTx,
  jobId: string,
  f: { message: string; code: string; retryAt: Date | null },
) {
  await db
    .update(uploadJobs)
    .set({
      status: f.retryAt ? 'pending' : 'failed',
      lastError: f.message.slice(0, 1000),
      errorCode: f.code,
      nextAttemptAt: f.retryAt,
      finishedAt: f.retryAt ? null : new Date(),
      updatedAt: new Date(),
    })
    .where(eq(uploadJobs.id, jobId));
}

export async function ensureDriveJob(db: DbOrTx, session: Pick<SessionRow, 'id' | 'orgId'>) {
  await db
    .insert(uploadJobs)
    .values({ orgId: session.orgId, sessionId: session.id, target: 'drive', status: 'pending' })
    .onConflictDoNothing();
}

/** Studio "retry": resets failed jobs of one session (any target) so the worker picks them up. */
export async function retrySessionJobs(
  db: Db,
  orgId: string,
  sessionId: string,
): Promise<UploadJobRow[]> {
  const reset = await db
    .update(uploadJobs)
    .set({
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      finishedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(uploadJobs.orgId, orgId),
        eq(uploadJobs.sessionId, sessionId),
        eq(uploadJobs.status, 'failed'),
      ),
    )
    .returning();
  if (reset.length === 0) {
    throw new OutputRepoError('nothing_to_retry', 'Tidak ada upload gagal untuk sesi ini');
  }
  return reset;
}

/** After the owner reconnects Drive: failed jobs that waited for the owner start again. */
export async function requeueOwnerActionJobs(db: Db, orgId: string): Promise<number> {
  const reset = await db
    .update(uploadJobs)
    .set({
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      finishedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(uploadJobs.orgId, orgId),
        eq(uploadJobs.status, 'failed'),
        inArray(uploadJobs.errorCode, OWNER_ACTION_CODES),
      ),
    )
    .returning({ id: uploadJobs.id });
  return reset.length;
}

// --- worker data -----------------------------------------------------------------------------

export async function getSession(db: DbOrTx, sessionId: string) {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  return row ?? null;
}

export async function listSessionOutputs(db: DbOrTx, sessionId: string): Promise<OutputRow[]> {
  return db.select().from(sessionOutputs).where(eq(sessionOutputs.sessionId, sessionId));
}

export async function upsertOutput(
  db: DbOrTx,
  session: Pick<SessionRow, 'id' | 'orgId'>,
  o: {
    kind: OutputKindName;
    name: string;
    storagePath: string;
    sha256: string;
    bytes: number;
    mimeType: string;
    slotIndex?: number | null;
  },
) {
  await db
    .insert(sessionOutputs)
    .values({
      orgId: session.orgId,
      sessionId: session.id,
      kind: o.kind,
      name: o.name,
      storagePath: o.storagePath,
      sha256: o.sha256,
      bytes: o.bytes,
      mimeType: o.mimeType,
      slotIndex: o.slotIndex ?? null,
      status: 'stored',
    })
    .onConflictDoUpdate({
      target: [sessionOutputs.sessionId, sessionOutputs.kind, sessionOutputs.name],
      set: {
        storagePath: o.storagePath,
        sha256: o.sha256,
        bytes: o.bytes,
        mimeType: o.mimeType,
        // A re-generated file must be uploaded to Drive again.
        status: 'stored',
        driveFileId: null,
        updatedAt: new Date(),
      },
    });
}

export async function markOutputUploaded(db: DbOrTx, outputId: string, driveFileId: string) {
  await db
    .update(sessionOutputs)
    .set({ status: 'uploaded', driveFileId, updatedAt: new Date() })
    .where(eq(sessionOutputs.id, outputId));
}

export async function markOutputFailed(db: DbOrTx, outputId: string) {
  await db
    .update(sessionOutputs)
    .set({ status: 'failed', updatedAt: new Date() })
    .where(eq(sessionOutputs.id, outputId));
}

export async function setSessionDriveFolder(
  db: DbOrTx,
  sessionId: string,
  folderId: string,
  url?: string,
) {
  await db
    .update(sessions)
    .set({
      driveFolderId: folderId,
      ...(url ? { driveFolderUrl: url } : {}),
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, sessionId));
}

export async function getBoothInfo(db: DbOrTx, boothId: string) {
  const [row] = await db
    .select({ id: booths.id, name: booths.name, timezone: booths.timezone })
    .from(booths)
    .where(eq(booths.id, boothId));
  return row ?? null;
}

/** The published config version a session was shot with. */
export async function getPublishedConfig(
  db: DbOrTx,
  boothId: string,
  version: number,
): Promise<BoothConfig | null> {
  const [row] = await db
    .select({ config: boothConfigs.config })
    .from(boothConfigs)
    .where(and(eq(boothConfigs.boothId, boothId), eq(boothConfigs.version, version)));
  return (row?.config as BoothConfig | undefined) ?? null;
}

/** Features the org is entitled to now (Starter's after the grace period); none if unknown. */
export async function getOrgPlanFeatures(db: DbOrTx, orgId: string): Promise<PlanFeatures> {
  const e = await resolveEntitlements(db, orgId);
  return (
    e?.features ?? {
      dslr: false,
      liveClip: false,
      video: false,
      watermarkRemoval: false,
      customDomain: false,
      export: false,
      auditLog: false,
      staff: false,
    }
  );
}

// --- Drive connection ---------------------------------------------------------------------------

export async function getDriveConnection(db: DbOrTx, orgId: string) {
  const [row] = await db.select().from(driveConnections).where(eq(driveConnections.orgId, orgId));
  return row ?? null;
}

export async function saveDriveConnection(
  db: DbOrTx,
  c: {
    orgId: string;
    googleEmail: string;
    encryptedRefreshToken: string;
    rootFolderId: string | null;
    rootFolderName: string | null;
    userId: string | null;
  },
) {
  const values = {
    googleEmail: c.googleEmail,
    encryptedRefreshToken: c.encryptedRefreshToken,
    rootFolderId: c.rootFolderId,
    rootFolderName: c.rootFolderName,
    status: 'ok' as const,
    lastError: null,
    connectedBy: c.userId,
    updatedAt: new Date(),
  };
  await db
    .insert(driveConnections)
    .values({ orgId: c.orgId, ...values })
    .onConflictDoUpdate({ target: driveConnections.orgId, set: values });
}

export async function setDriveStatus(
  db: DbOrTx,
  orgId: string,
  status: 'ok' | 'failed' | 'revoked',
  lastError: string | null,
) {
  await db
    .update(driveConnections)
    .set({ status, lastError, updatedAt: new Date() })
    .where(eq(driveConnections.orgId, orgId));
}

export async function setDriveRootFolder(
  db: DbOrTx,
  orgId: string,
  folderId: string,
  folderName: string,
) {
  await db
    .update(driveConnections)
    .set({ rootFolderId: folderId, rootFolderName: folderName, updatedAt: new Date() })
    .where(eq(driveConnections.orgId, orgId));
}

export async function deleteDriveConnection(db: DbOrTx, orgId: string) {
  await db.delete(driveConnections).where(eq(driveConnections.orgId, orgId));
}

// --- short link + Studio -----------------------------------------------------------------------

export type ShortLinkState =
  | { state: 'not_found' }
  | { state: 'ready'; driveFolderUrl: string }
  | { state: 'processing' }
  | { state: 'failed' };

/** What `/s/:code` shows. Public: exposes nothing but the state and the (public-link) folder URL. */
export async function shortLinkState(db: DbOrTx, code: string): Promise<ShortLinkState> {
  const [s] = await db
    .select({ id: sessions.id, url: sessions.driveFolderUrl })
    .from(sessions)
    .where(eq(sessions.code, code));
  if (!s) return { state: 'not_found' };
  if (s.url) return { state: 'ready', driveFolderUrl: s.url };
  const jobs = await db
    .select({ status: uploadJobs.status, errorCode: uploadJobs.errorCode })
    .from(uploadJobs)
    .where(eq(uploadJobs.sessionId, s.id));
  // Needs the owner (Drive revoked, quota): the buyer should not wait forever on a spinner.
  if (jobs.some((j) => j.status === 'failed' && !OWNER_ACTION_CODES.includes(j.errorCode ?? '')))
    return { state: 'failed' };
  return { state: 'processing' };
}

/** Upload job state per session for Studio (RLS applies when called with a user Tx). */
export async function listUploadJobsForSessions(db: DbOrTx, sessionIds: string[]) {
  if (sessionIds.length === 0) return [];
  return db.select().from(uploadJobs).where(inArray(uploadJobs.sessionId, sessionIds));
}

/** Sessions whose Drive upload finished long ago: storage copy can go (retention). */
export async function sessionsReadyForStoragePurge(db: DbOrTx, olderThan: Date, limit = 50) {
  const rows = await db
    .select({ id: sessions.id, orgId: sessions.orgId })
    .from(sessions)
    .innerJoin(
      uploadJobs,
      and(eq(uploadJobs.sessionId, sessions.id), eq(uploadJobs.target, 'drive')),
    )
    .where(and(eq(uploadJobs.status, 'done'), lt(uploadJobs.finishedAt, olderThan)))
    .limit(limit);
  // Already purged sessions have no 'stored/uploaded' file with a path left.
  const out: { id: string; orgId: string }[] = [];
  for (const r of rows) {
    const [o] = await db
      .select({ id: sessionOutputs.id })
      .from(sessionOutputs)
      .where(
        and(eq(sessionOutputs.sessionId, r.id), sql`${sessionOutputs.storagePath} is not null`),
      )
      .limit(1);
    if (o) out.push(r);
  }
  return out;
}

export async function clearStoragePaths(db: DbOrTx, sessionId: string) {
  await db
    .update(sessionOutputs)
    .set({ storagePath: null, updatedAt: new Date() })
    .where(eq(sessionOutputs.sessionId, sessionId));
}

/** BullMQ queue the API wakes and the worker consumes (payload `{ sessionId }`). */
export const SESSION_QUEUE = 'pb-session-jobs';

/**
 * The delivered file of an agent-uploaded row changed (watermark applied): point the row at the
 * new object. `sha256` keeps the hash the agent sent (what `complete` verifies).
 */
export async function replaceOutputFile(
  db: DbOrTx,
  outputId: string,
  f: { storagePath: string; bytes: number },
) {
  await db
    .update(sessionOutputs)
    .set({
      storagePath: f.storagePath,
      bytes: f.bytes,
      status: 'stored',
      driveFileId: null,
      updatedAt: new Date(),
    })
    .where(eq(sessionOutputs.id, outputId));
}
