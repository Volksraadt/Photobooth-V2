import { mkdirSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { sha256Hex } from './device-api';
import type { AgentStore, LocalFileRow, LocalSessionRow } from './store';

export type SessionRef = {
  id: string;
  code: string;
  boothId: string;
  configVersion: number;
  /** ISO 8601 UTC. */
  startedAt: string;
};

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

/** Writes a file and fsyncs it: a confirmed shot must survive a power cut. */
export async function writeDurable(path: string, bytes: Uint8Array): Promise<void> {
  const fh = await open(path, 'w');
  try {
    await fh.writeFile(bytes);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

export class ImageRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageRejectedError';
  }
}

/**
 * Session files on disk (dataDir/sessions/<YYYY-MM-DD UTC>/<CODE>/original|composite|print/)
 * with their metadata in local_files. Kept until upload is confirmed (F5).
 */
export class SessionFiles {
  readonly root: string;

  constructor(private readonly store: AgentStore) {
    this.root = join(store.dataDir, 'sessions');
    mkdirSync(this.root, { recursive: true });
  }

  dir(session: Pick<LocalSessionRow, 'started_at' | 'code'>, sub?: string): string {
    const day = session.started_at.slice(0, 10);
    const dir = join(this.root, day, session.code, ...(sub ? [sub] : []));
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  ensure(ref: SessionRef): LocalSessionRow {
    return this.store.ensureSession(ref);
  }

  /** Stores one original still (never mirrored). Validates that the bytes are an image. */
  async saveShot(input: {
    session: SessionRef;
    slotIndex: number;
    takeNumber: number;
    bytes: Uint8Array;
    source: 'tablet' | 'webcam' | 'mock';
    capturedAt?: string;
  }): Promise<LocalFileRow> {
    const meta = await sharp(input.bytes, { failOn: 'error' })
      .metadata()
      .catch((err: unknown) => {
        throw new ImageRejectedError(`Bukan gambar yang valid (${String(err)})`);
      });
    const mime =
      meta.format === 'jpeg'
        ? 'image/jpeg'
        : meta.format === 'png'
          ? 'image/png'
          : meta.format === 'webp'
            ? 'image/webp'
            : meta.format === 'heif'
              ? 'image/heic'
              : null;
    if (!mime || !meta.width || !meta.height) {
      throw new ImageRejectedError(`Format foto tidak didukung (${meta.format ?? '?'})`);
    }
    // EXIF orientation 5..8 = rotated 90°: report the displayed size.
    const rotated = (meta.orientation ?? 1) >= 5;
    const width = rotated ? meta.height : meta.width;
    const height = rotated ? meta.width : meta.height;

    const row = this.ensure(input.session);
    const name = `slot${input.slotIndex}-take${input.takeNumber}-${Date.now().toString(36)}.${EXT[mime]}`;
    const path = join(this.dir(row, 'original'), name);
    await writeDurable(path, input.bytes);
    return this.store.addFile({
      session_id: row.id,
      kind: 'original',
      slot_index: input.slotIndex,
      take_number: input.takeNumber,
      path,
      mime_type: mime,
      width,
      height,
      bytes: input.bytes.byteLength,
      sha256: sha256Hex(input.bytes),
      source: input.source,
      captured_at: input.capturedAt ?? new Date().toISOString(),
    });
  }

  async saveOutput(
    session: LocalSessionRow,
    kind: 'composite' | 'print',
    name: string,
    bytes: Uint8Array,
    mime: string,
    size: { width: number; height: number },
  ): Promise<LocalFileRow> {
    const path = join(this.dir(session, kind), name);
    await writeDurable(path, bytes);
    return this.store.addFile({
      session_id: session.id,
      kind,
      slot_index: null,
      take_number: null,
      path,
      mime_type: mime,
      width: size.width,
      height: size.height,
      bytes: bytes.byteLength,
      sha256: sha256Hex(bytes),
      source: 'agent',
      captured_at: null,
    });
  }
}
