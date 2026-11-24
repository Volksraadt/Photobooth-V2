import {
  getBoothInfo,
  getDriveConnection,
  getPublishedConfig,
  getSession,
  listSessionOutputs,
  markOutputUploaded,
  setDriveStatus,
  setSessionDriveFolder,
} from '@pb/db';
import { DriveClient, driveAad, driveFolderUrl, type DriveFolder } from '@pb/drive';
import { OUTPUT_KINDS, SessionManifestSchema, type OutputKind } from '@pb/storage';
import { JobError, type WorkerDeps } from './types';

/** Booth-local calendar day `YYYY-MM-DD` (Drive folders follow the owner's clock, not UTC). */
export function localDay(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Drive folder names cannot contain `/`; keep them readable and short. */
export function folderName(name: string, fallback: string): string {
  const n = [...name]
    .map((ch) => (ch === '/' || ch === '\\' || ch.charCodeAt(0) < 32 ? '-' : ch))
    .join('')
    .trim()
    .slice(0, 100);
  return n || fallback;
}

/**
 * Concurrent sessions of the same day would both "find nothing, create folder" and end up with two
 * folders of the same name. Serialize find-or-create per (parent, name) inside this process.
 */
const folderLocks = new Map<string, Promise<unknown>>();
async function ensureFolderOnce(
  drive: DriveClient,
  name: string,
  parentId: string,
): Promise<DriveFolder> {
  const key = `${parentId}\u0000${name}`;
  const previous = folderLocks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => drive.ensureFolder(name, parentId));
  folderLocks.set(key, next);
  try {
    return await next;
  } finally {
    if (folderLocks.get(key) === next) folderLocks.delete(key);
  }
}

/**
 * Job `upload-drive`: `/<root>/<booth folder>/<YYYY-MM-DD>/<CODE>/<original|mirrored|filtered|
 * composite|gif|video>/`, then "anyone with the link: reader" on the session folder and the folder
 * URL on the session (what `/s/:code` redirects to). The URL is only set after the last file is
 * up, so a buyer never lands on a half-empty folder.
 */
export async function uploadDrive(deps: WorkerDeps, sessionId: string): Promise<void> {
  const { db, storage } = deps;
  const log = deps.log ?? (() => {});
  const session = await getSession(db, sessionId);
  if (!session) throw new JobError('not_found', 'Sesi tidak ditemukan', true);

  const conn = await getDriveConnection(db, session.orgId);
  if (!conn || !deps.google || !deps.secretBox) {
    throw new JobError(
      'drive_not_connected',
      'Google Drive belum terhubung. Hubungkan di Studio → Integrasi, lalu coba lagi.',
      true,
    );
  }
  if (conn.status === 'revoked') {
    throw new JobError(
      'drive_revoked',
      'Akses Google Drive dicabut. Hubungkan ulang di Studio → Integrasi.',
      true,
    );
  }
  if (!conn.rootFolderId) {
    throw new JobError(
      'drive_folder_missing',
      'Folder root Google Drive belum dipilih. Pilih atau buat folder di Studio → Integrasi.',
      true,
    );
  }
  const box = deps.secretBox;
  const drive = new DriveClient(
    deps.driveTokens.supplier(session.orgId, deps.google, async () =>
      box.decrypt(conn.encryptedRefreshToken, driveAad(session.orgId)),
    ),
    deps.google.endpoints,
  );

  const rootFolder = await drive.getFolder(conn.rootFolderId);
  if (!rootFolder) {
    throw new JobError(
      'drive_folder_missing',
      'Folder root di Google Drive tidak ditemukan (mungkin dihapus). Pilih atau buat folder baru di Studio → Integrasi.',
      true,
    );
  }

  const outputs = (await listSessionOutputs(db, sessionId)).filter(
    (o) => o.storagePath && o.name && o.status !== 'failed',
  );
  if (outputs.length === 0)
    throw new JobError('storage_missing', 'Tidak ada file untuk diunggah', true);

  // Session folder (reused on retry so a crash never makes a second folder).
  let sessionFolderId = session.driveFolderId;
  if (sessionFolderId && !(await drive.getFolder(sessionFolderId))) sessionFolderId = null;
  if (!sessionFolderId) {
    const booth = await getBoothInfo(db, session.boothId);
    const manifest = SessionManifestSchema.safeParse(session.manifest);
    const config = manifest.success
      ? await getPublishedConfig(db, session.boothId, manifest.data.configVersion)
      : null;
    const boothName = folderName(config?.output.driveRootFolderName ?? '', booth?.name ?? 'Booth');
    const day = localDay(session.startedAt, booth?.timezone ?? 'UTC');
    const boothFolder = await ensureFolderOnce(drive, boothName, rootFolder.id);
    const dayFolder = await ensureFolderOnce(drive, day, boothFolder.id);
    sessionFolderId = (await ensureFolderOnce(drive, session.code, dayFolder.id)).id;
    await setSessionDriveFolder(db, sessionId, sessionFolderId);
  }

  // Subfolders for the kinds this session has files for, in the documented order.
  const subfolders = new Map<OutputKind, string>();
  for (const kind of OUTPUT_KINDS) {
    if (outputs.some((o) => o.kind === kind)) {
      subfolders.set(kind, (await ensureFolderOnce(drive, kind, sessionFolderId)).id);
    }
  }

  for (const o of outputs) {
    if (o.status === 'uploaded' && o.driveFileId) continue;
    const parent = subfolders.get(o.kind as OutputKind);
    if (!parent) continue;
    const bytes = await storage.get(o.storagePath!).catch(() => {
      throw new JobError('storage_missing', `File ${o.name} hilang dari storage`, true);
    });
    const { id } = await drive.uploadFile({
      name: o.name!,
      parentId: parent,
      bytes,
      mimeType: o.mimeType ?? 'application/octet-stream',
    });
    await markOutputUploaded(db, o.id, id);
  }

  await drive.shareAnyoneReader(sessionFolderId);
  await setSessionDriveFolder(db, sessionId, sessionFolderId, driveFolderUrl(sessionFolderId));
  await setDriveStatus(db, session.orgId, 'ok', null);
  log(`[worker] ${session.code}: uploaded to Drive`);
}
