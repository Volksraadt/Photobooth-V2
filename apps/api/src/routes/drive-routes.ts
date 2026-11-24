import {
  auditLogs,
  deleteDriveConnection,
  getDriveConnection,
  getSession,
  OutputRepoError,
  requeueOwnerActionJobs,
  retrySessionJobs,
  saveDriveConnection,
  setDriveRootFolder,
  setDriveStatus,
  type Db,
} from '@pb/db';
import { SecretBoxError, type SecretBox } from '@pb/crypto';
import { DRIVE_SCOPE, DriveClient, DriveError, driveAad, driveFolderUrl } from '@pb/drive';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { orgMembership, requireOrgEditor } from '../middleware/org-access';
import type { AppEnv, ResolvedDeps } from '../types';

export const DEFAULT_ROOT_FOLDER = 'Photobooth';
const STATE_AAD = 'google-oauth-state:v1';
const STATE_TTL_MS = 10 * 60_000;

type OAuthState = { orgId: string; userId: string; exp: number };

/** A DriveClient for one org, using the stored (encrypted) refresh token. */
export function orgDriveClient(deps: ResolvedDeps, orgId: string, encryptedRefresh: string) {
  if (!deps.google || !deps.secretBox) throw new Error('Google Drive belum dikonfigurasi');
  const box = deps.secretBox;
  return new DriveClient(
    deps.driveTokens.supplier(orgId, deps.google, async () =>
      box.decrypt(encryptedRefresh, driveAad(orgId)),
    ),
    deps.google.endpoints,
  );
}

function connectionView(c: Awaited<ReturnType<typeof getDriveConnection>>) {
  if (!c) return null;
  return {
    googleEmail: c.googleEmail,
    status: c.status,
    lastError: c.lastError,
    rootFolderId: c.rootFolderId,
    rootFolderName: c.rootFolderName,
    rootFolderUrl: c.rootFolderId ? driveFolderUrl(c.rootFolderId) : null,
    connectedAt: c.updatedAt.toISOString(),
  };
}

/** Plain Indonesian text for what went wrong with Drive (shown in Studio). */
export function driveErrorMessage(err: unknown): string {
  if (err instanceof DriveError) {
    if (err.kind === 'auth')
      return 'Akses Google Drive dicabut atau kedaluwarsa. Hubungkan ulang Google Drive.';
    if (err.kind === 'quota') return 'Penyimpanan Google Drive penuh. Kosongkan ruang Drive Anda.';
    if (err.kind === 'not_found')
      return 'Folder di Google Drive tidak ditemukan atau sudah dihapus.';
    return `Google Drive bermasalah sementara (${err.message}).`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Studio-facing Drive endpoints (mounted inside `/studio`, user token). */
export function studioDriveRoutes() {
  const app = new Hono<AppEnv>();

  const needGoogle = (c: Context<AppEnv>) =>
    c.var.deps.google && c.var.deps.secretBox
      ? null
      : c.json(
          {
            error: 'drive_not_configured',
            message:
              'Server belum dikonfigurasi untuk Google Drive (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SECRET_MASTER_KEY).',
          },
          503,
        );

  const audit = (db: Db, orgId: string, userId: string, action: string, after: unknown) =>
    db.insert(auditLogs).values({
      orgId,
      actorId: userId,
      action,
      entity: 'drive_connections',
      entityId: orgId,
      after: after as object,
    });

  app.get('/orgs/:orgId/integrations/google-drive', async (c) => {
    const orgId = c.req.param('orgId');
    const denied = await requireOrgEditor(c, orgId);
    if (denied) return denied;
    const { deps } = c.var;
    return c.json({
      configured: !!(deps.google && deps.secretBox),
      scope: DRIVE_SCOPE,
      redirectUri: deps.google?.redirectUri ?? null,
      connection: connectionView(await getDriveConnection(deps.db, orgId)),
    });
  });

  /** Returns the Google consent URL; Studio sends the browser there. */
  app.post('/orgs/:orgId/integrations/google-drive/connect', async (c) => {
    const orgId = c.req.param('orgId');
    const denied = await requireOrgEditor(c, orgId);
    if (denied) return denied;
    const unavailable = needGoogle(c);
    if (unavailable) return unavailable;
    const { google, secretBox } = c.var.deps;
    const state = secretBox!.encrypt(
      JSON.stringify({
        orgId,
        userId: c.var.user.userId,
        exp: Date.now() + STATE_TTL_MS,
      } satisfies OAuthState),
      STATE_AAD,
    );
    return c.json({ url: google!.authUrl(state) });
  });

  app.delete('/orgs/:orgId/integrations/google-drive', async (c) => {
    const orgId = c.req.param('orgId');
    const denied = await requireOrgEditor(c, orgId);
    if (denied) return denied;
    const { db, driveTokens } = c.var.deps;
    await deleteDriveConnection(db, orgId);
    driveTokens.forget(orgId);
    await audit(db, orgId, c.var.user.userId, 'integration.drive.disconnect', null);
    return c.json({ ok: true });
  });

  /** Folders this app created (drive.file cannot see any other folder). */
  app.get('/orgs/:orgId/integrations/google-drive/folders', async (c) => {
    const orgId = c.req.param('orgId');
    const denied = await requireOrgEditor(c, orgId);
    if (denied) return denied;
    const conn = await getDriveConnection(c.var.deps.db, orgId);
    if (!conn)
      return c.json({ error: 'not_connected', message: 'Google Drive belum terhubung.' }, 409);
    try {
      const client = orgDriveClient(c.var.deps, orgId, conn.encryptedRefreshToken);
      return c.json({ folders: await client.listAppFolders() });
    } catch (err) {
      return driveFailure(c, orgId, err);
    }
  });

  const RootBody = z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('create'), name: z.string().trim().min(1).max(100) }),
    z.object({ mode: z.literal('existing'), folderId: z.string().min(5).max(200) }),
  ]);

  /** Choose or create the root folder every booth folder is made under. */
  app.put('/orgs/:orgId/integrations/google-drive/root-folder', async (c) => {
    const orgId = c.req.param('orgId');
    const denied = await requireOrgEditor(c, orgId);
    if (denied) return denied;
    const body = RootBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body', message: 'Data tidak valid.' }, 400);
    const { db } = c.var.deps;
    const conn = await getDriveConnection(db, orgId);
    if (!conn)
      return c.json({ error: 'not_connected', message: 'Google Drive belum terhubung.' }, 409);
    try {
      const client = orgDriveClient(c.var.deps, orgId, conn.encryptedRefreshToken);
      const folder =
        body.data.mode === 'create'
          ? await client.createFolder(body.data.name, null)
          : await client.getFolder(body.data.folderId);
      if (!folder) {
        return c.json(
          { error: 'folder_missing', message: 'Folder tidak ditemukan di Google Drive.' },
          404,
        );
      }
      await setDriveRootFolder(db, orgId, folder.id, folder.name);
      await setDriveStatus(db, orgId, 'ok', null);
      await audit(db, orgId, c.var.user.userId, 'integration.drive.root_folder', {
        folderId: folder.id,
        name: folder.name,
      });
      const requeued = await requeueOwnerActionJobs(db, orgId);
      return c.json({ folder, requeued });
    } catch (err) {
      return driveFailure(c, orgId, err);
    }
  });

  app.post('/orgs/:orgId/integrations/google-drive/test', async (c) => {
    const orgId = c.req.param('orgId');
    const denied = await requireOrgEditor(c, orgId);
    if (denied) return denied;
    const { db } = c.var.deps;
    const conn = await getDriveConnection(db, orgId);
    if (!conn) return c.json({ ok: false, message: 'Google Drive belum terhubung.' });
    try {
      const client = orgDriveClient(c.var.deps, orgId, conn.encryptedRefreshToken);
      const email = await client.accountEmail();
      const root = conn.rootFolderId ? await client.getFolder(conn.rootFolderId) : null;
      if (conn.rootFolderId && !root) {
        const message = 'Folder root tidak ditemukan di Google Drive. Pilih atau buat folder baru.';
        await setDriveStatus(db, orgId, 'failed', message);
        return c.json({ ok: false, message });
      }
      await setDriveStatus(db, orgId, 'ok', null);
      return c.json({
        ok: true,
        message: `Terhubung ke Google Drive${email ? ` (${email})` : ''}.`,
      });
    } catch (err) {
      const message = driveErrorMessage(err);
      await markFailure(db, orgId, err, message);
      return c.json({ ok: false, message });
    }
  });

  /** Studio "retry upload" for one session. Any org member (operators included). */
  app.post('/orgs/:orgId/sessions/:sessionId/retry-upload', async (c) => {
    const orgId = c.req.param('orgId');
    if (!(await orgMembership(c, orgId)))
      return c.json({ error: 'not_found', message: 'Organisasi tidak ditemukan.' }, 404);
    const { db, jobs } = c.var.deps;
    const session = await getSession(db, c.req.param('sessionId'));
    if (!session || session.orgId !== orgId)
      return c.json({ error: 'not_found', message: 'Sesi tidak ditemukan.' }, 404);
    try {
      await retrySessionJobs(db, orgId, session.id);
    } catch (err) {
      if (err instanceof OutputRepoError)
        return c.json({ error: err.code, message: err.message }, 409);
      throw err;
    }
    void jobs.wake(session.id).catch(() => undefined);
    return c.json({ ok: true });
  });

  return app;
}

async function markFailure(db: Db, orgId: string, err: unknown, message: string) {
  const revoked = err instanceof DriveError && err.kind === 'auth';
  await setDriveStatus(db, orgId, revoked ? 'revoked' : 'failed', message);
}

async function driveFailure(c: Context<AppEnv>, orgId: string, err: unknown) {
  if (err instanceof SecretBoxError) {
    return c.json(
      {
        error: 'decrypt_failed',
        message: 'Token Google Drive tidak dapat dibaca. Hubungkan ulang.',
      },
      409,
    );
  }
  const message = driveErrorMessage(err);
  await markFailure(c.var.deps.db, orgId, err, message);
  return c.json({ error: 'drive_error', message }, 502);
}

/**
 * Public OAuth callback (Google redirects the owner's browser here). The `state` is an encrypted,
 * expiring blob made by `/connect`; it ties the callback to one org and user.
 */
export function googleOAuthRoutes() {
  const app = new Hono<AppEnv>();

  app.get('/callback', async (c) => {
    const { deps } = c.var;
    const back = (result: string) =>
      c.redirect(`${deps.studioUrl.replace(/\/$/, '')}/integrations?drive=${result}`, 302);
    if (!deps.google || !deps.secretBox) return back('not_configured');
    if (c.req.query('error')) return back('denied');

    let state: OAuthState;
    try {
      state = JSON.parse(
        deps.secretBox.decrypt(c.req.query('state') ?? '', STATE_AAD),
      ) as OAuthState;
    } catch {
      return c.text('Permintaan tidak valid. Mulai lagi dari Studio.', 400);
    }
    if (state.exp < Date.now()) return back('expired');
    const code = c.req.query('code');
    if (!code) return back('denied');

    try {
      const tokens = await deps.google.exchangeCode(code);
      if (!tokens.refreshToken) return back('no_refresh_token');
      // Only the narrow scope is acceptable (we never ask for more, but verify what was granted).
      if (!tokens.scope.split(' ').includes(DRIVE_SCOPE)) return back('scope_missing');

      const orgId = state.orgId;
      const box: SecretBox = deps.secretBox;
      const encrypted = box.encrypt(tokens.refreshToken, driveAad(orgId));
      const client = new DriveClient(async () => tokens.accessToken, deps.google.endpoints);
      const email = await client.accountEmail();

      // Keep the previous root folder only if this account can still see it.
      const previous = await getDriveConnection(deps.db, orgId);
      let root = previous?.rootFolderId ? await client.getFolder(previous.rootFolderId) : null;
      if (!root) root = await client.ensureFolder(DEFAULT_ROOT_FOLDER, null);

      await saveDriveConnection(deps.db, {
        orgId,
        googleEmail: email || previous?.googleEmail || 'unknown',
        encryptedRefreshToken: encrypted,
        rootFolderId: root.id,
        rootFolderName: root.name,
        userId: state.userId,
      });
      deps.driveTokens.forget(orgId);
      await deps.db.insert(auditLogs).values({
        orgId,
        actorId: state.userId,
        action: 'integration.drive.connect',
        entity: 'drive_connections',
        entityId: orgId,
        // The token itself is never logged.
        after: { googleEmail: email, rootFolderName: root.name },
      });
      // Jobs that failed because Drive was missing/revoked start again.
      await requeueOwnerActionJobs(deps.db, orgId);
      return back('connected');
    } catch (err) {
      console.error(
        '[api] google oauth callback failed:',
        err instanceof Error ? err.message : err,
      );
      return back('error');
    }
  });

  return app;
}
