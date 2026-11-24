import { createHash } from 'node:crypto';
import {
  completeSessionFiles,
  deviceSession,
  findOutputBySource,
  OutputRepoError,
  recordStoredFile,
} from '@pb/db';
import {
  AGENT_KINDS,
  FileIdSchema,
  SessionManifestSchema,
  sessionObjectKey,
  safeFileName,
} from '@pb/storage';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { AppEnv } from '../types';

/** Largest file the agent may upload (a 60 MB camera original is already generous). */
export const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

const FileHeaders = z.object({
  kind: z.enum(AGENT_KINDS),
  name: z.string().min(1).max(120),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  slot: z.coerce.number().int().min(1).max(16).nullable(),
});

/**
 * Agent → object storage (mounted under `/device`, device token). The agent uploads the originals
 * and the composite itself, then calls `complete`, which creates the job for the worker.
 * Both calls are idempotent so the agent can retry after any failure.
 */
export function deviceOutputRoutes() {
  const app = new Hono<AppEnv>();

  /**
   * `PUT /device/sessions/:sessionId/files/:fileId`, raw bytes. Metadata in headers:
   * x-pb-kind, x-pb-name, x-pb-sha256, x-pb-slot. The hash is verified against the body, so a
   * truncated upload is never accepted as stored.
   */
  // bodyLimit also stops a chunked upload without Content-Length at the cap, instead of buffering
  // it whole first (audit R6).
  app.put(
    '/sessions/:sessionId/files/:fileId',
    bodyLimit({
      maxSize: MAX_UPLOAD_BYTES,
      onError: (c) => c.json({ error: 'too_large' }, 413),
    }),
    async (c) => {
      const { db, storage } = c.var.deps;
      const device = c.var.device;
      const fileId = FileIdSchema.safeParse(c.req.param('fileId'));
      const headers = FileHeaders.safeParse({
        kind: c.req.header('x-pb-kind'),
        name: c.req.header('x-pb-name'),
        sha256: c.req.header('x-pb-sha256'),
        slot: c.req.header('x-pb-slot') ?? null,
      });
      if (!fileId.success || !headers.success) return c.json({ error: 'invalid_headers' }, 400);
      const length = Number(c.req.header('content-length') ?? 0);
      if (length > MAX_UPLOAD_BYTES) return c.json({ error: 'too_large' }, 413);

      const session = await deviceSession(db, device, c.req.param('sessionId'));
      // The session record arrives through the outbox; the agent waits and tries again.
      if (!session) return c.json({ error: 'session_unknown' }, 409);

      const existing = await findOutputBySource(db, session.id, fileId.data);
      if (existing?.sha256 === headers.data.sha256 && existing.storagePath) {
        if (await storage.exists(existing.storagePath))
          return c.json({ stored: true, already: true });
      }

      const bytes = Buffer.from(await c.req.arrayBuffer());
      if (bytes.byteLength > MAX_UPLOAD_BYTES) return c.json({ error: 'too_large' }, 413);
      if (bytes.byteLength === 0) return c.json({ error: 'empty_body' }, 400);
      if (createHash('sha256').update(bytes).digest('hex') !== headers.data.sha256) {
        return c.json(
          { error: 'hash_mismatch', message: 'Isi file tidak cocok dengan hash.' },
          422,
        );
      }

      const name = safeFileName(headers.data.name);
      const key = sessionObjectKey(
        session.orgId,
        session.id,
        headers.data.kind,
        `${fileId.data}-${name}`,
      );
      await storage.put(key, bytes, c.req.header('content-type') ?? 'application/octet-stream');
      await recordStoredFile(db, session, {
        sourceFileId: fileId.data,
        kind: headers.data.kind,
        name,
        storagePath: key,
        sha256: headers.data.sha256,
        bytes: bytes.byteLength,
        mimeType: c.req.header('content-type') ?? 'application/octet-stream',
        slotIndex: headers.data.slot,
      });
      return c.json({ stored: true, already: false });
    },
  );

  /** `POST /device/sessions/:sessionId/complete` with the manifest. */
  app.post('/sessions/:sessionId/complete', async (c) => {
    const body = SessionManifestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body', issues: body.error.issues }, 400);
    const { db, jobs } = c.var.deps;
    try {
      const { session } = await completeSessionFiles(
        db,
        c.var.device,
        c.req.param('sessionId'),
        body.data,
      );
      // Waking is best effort: the worker also polls the job table.
      void jobs.wake(session.id).catch((err) => console.warn('[api] job wake failed', err));
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof OutputRepoError) {
        const status =
          err.code === 'session_unknown' ? 409 : err.code === 'missing_files' ? 409 : 400;
        return c.json({ error: err.code, message: err.message, missing: err.missing }, status);
      }
      throw err;
    }
  });

  return app;
}
