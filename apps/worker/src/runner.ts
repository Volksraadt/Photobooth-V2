import {
  claimNextJob,
  clearStoragePaths,
  ensureDriveJob,
  failJob,
  finishJob,
  getSession,
  JOB_ERROR,
  sessionsReadyForStoragePurge,
  setDriveStatus,
  type UploadJobRow,
} from '@pb/db';
import { DriveError } from '@pb/drive';
import { StorageError } from '@pb/storage';
import { processSession } from './process-session';
import { JobError, type WorkerDeps } from './types';
import { uploadDrive } from './upload-drive';

/** After this many tries a job stops retrying by itself; the owner can still retry from Studio. */
export const MAX_ATTEMPTS = 8;

/** 15 s, 30 s, 1 min … capped at 15 min. */
export function backoffMs(attempt: number): number {
  return Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, attempt - 1));
}

type Classified = { code: string; message: string; retry: boolean };

/** What a thrown error means for the job, in words an owner can act on. */
export function classify(err: unknown, attempts: number): Classified {
  if (err instanceof JobError)
    return { code: err.code, message: err.message, retry: !err.permanent };
  if (err instanceof DriveError) {
    switch (err.kind) {
      case 'auth':
        return {
          code: JOB_ERROR.driveRevoked,
          message:
            'Akses Google Drive dicabut atau kedaluwarsa. Hubungkan ulang di Studio → Integrasi.',
          retry: false,
        };
      case 'quota':
        return {
          code: JOB_ERROR.driveQuota,
          message: 'Penyimpanan Google Drive penuh. Kosongkan ruang Drive, lalu coba lagi.',
          retry: false,
        };
      case 'not_found':
        return {
          code: JOB_ERROR.driveFolderMissing,
          message:
            'Folder di Google Drive tidak ditemukan atau tidak bisa diakses. Pilih folder di Studio → Integrasi.',
          retry: false,
        };
      default:
        return { code: JOB_ERROR.failed, message: err.message, retry: attempts < MAX_ATTEMPTS };
    }
  }
  if (err instanceof StorageError && err.code === 'not_found')
    return { code: JOB_ERROR.storageMissing, message: err.message, retry: false };
  return {
    code: JOB_ERROR.failed,
    message: err instanceof Error ? err.message : String(err),
    retry: attempts < MAX_ATTEMPTS,
  };
}

/**
 * Takes due jobs from `upload_jobs` and runs them. The table is the queue of record; BullMQ (when
 * Redis is configured) and a poll timer only decide *when* `drain()` runs.
 */
export class JobRunner {
  private running = 0;
  private stopped = false;

  constructor(
    private readonly deps: WorkerDeps,
    private readonly concurrency = 2,
  ) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  stop() {
    this.stopped = true;
  }

  /** Runs every due job (optionally of one session) until none is left. Returns how many ran. */
  async drain(sessionId?: string): Promise<number> {
    let ran = 0;
    const workers = Array.from({ length: this.concurrency }, async () => {
      for (;;) {
        if (this.stopped) return;
        const job = await claimNextJob(this.deps.db, { now: this.now(), sessionId });
        if (!job) return;
        this.running++;
        try {
          await this.run(job);
        } finally {
          this.running--;
          ran++;
        }
      }
    });
    await Promise.all(workers);
    return ran;
  }

  async run(job: UploadJobRow): Promise<void> {
    const { db } = this.deps;
    const log = this.deps.log ?? (() => {});
    try {
      if (job.target === 'storage') {
        await processSession(this.deps, job.sessionId);
        await finishJob(db, job.id);
        const session = await getSession(db, job.sessionId);
        if (session) await ensureDriveJob(db, session);
      } else {
        await uploadDrive(this.deps, job.sessionId);
        await finishJob(db, job.id);
      }
    } catch (err) {
      const c = classify(err, job.attempts);
      const retryAt = c.retry ? new Date(this.now().getTime() + backoffMs(job.attempts)) : null;
      log(
        `[worker] job ${job.target} ${job.sessionId} failed (attempt ${job.attempts}${retryAt ? `, retry ${retryAt.toISOString()}` : ', giving up'}): ${c.message}`,
      );
      await failJob(db, job.id, { message: c.message, code: c.code, retryAt });
      if (c.code === JOB_ERROR.driveRevoked) {
        // Remember it so Studio shows "revoked" and new sessions fail fast with the same message.
        await setDriveStatus(db, job.orgId, 'revoked', c.message);
        this.deps.driveTokens.forget(job.orgId);
      } else if (c.code === JOB_ERROR.driveQuota || c.code === JOB_ERROR.driveFolderMissing) {
        await setDriveStatus(db, job.orgId, 'failed', c.message);
      }
    }
  }

  /**
   * Retention (open-questions #5): the storage copy of a session whose Drive upload finished
   * `days` ago is deleted. Drive is then the only copy, as the owner expects.
   */
  async purgeOldStorage(days: number): Promise<number> {
    const { db, storage } = this.deps;
    const cutoff = new Date(this.now().getTime() - days * 86_400_000);
    const sessions = await sessionsReadyForStoragePurge(db, cutoff);
    for (const s of sessions) {
      await storage.deletePrefix(`${s.orgId}/sessions/${s.id}`);
      await clearStoragePaths(db, s.id);
    }
    return sessions.length;
  }
}
