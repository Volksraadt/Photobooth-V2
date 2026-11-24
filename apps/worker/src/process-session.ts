import { createHash } from 'node:crypto';
import {
  getOrgPlanFeatures,
  getPublishedConfig,
  getSession,
  listSessionOutputs,
  replaceOutputFile,
  upsertOutput,
  type OutputKindName,
  type OutputRow,
} from '@pb/db';
import {
  applyWatermark,
  buildGif,
  buildVideoFrame,
  composeStrip,
  encodeImage,
  filterPhoto,
  mirrorPhoto,
  pickVideoPhotos,
  prng,
} from '@pb/compositor';
import { migrateBoothConfig, type BoothConfig } from '@pb/schema';
import {
  SessionManifestSchema,
  sessionObjectKey,
  type OutputKind,
  type SessionManifest,
} from '@pb/storage';
import { createAssetLoader } from './assets';
import { renderVideo } from './ffmpeg';
import { JobError, type WorkerDeps } from './types';

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Same seed the agent uses for the strip's grain, so a rebuilt composite is identical. */
function hashSeed(code: string): number {
  let h = 2166136261;
  for (let i = 0; i < code.length; i++) h = Math.imul(h ^ code.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Job `process-session` (storage target): from the agent's originals to every output file.
 *   mirrored/ flipped originals · filtered/ the buyer's filter · composite/ the strip from the booth
 *   (rebuilt if missing) · gif/ · video/ 1080×1920 (ffmpeg).
 * Derived files are written to object storage and recorded in `session_outputs`; running it again
 * reuses what already exists, so a retry after a crash is cheap and does not duplicate anything.
 * Platforms plans that require it get a watermark on every digital output except `original/`.
 */
export async function processSession(deps: WorkerDeps, sessionId: string): Promise<void> {
  const { db, storage } = deps;
  const log = deps.log ?? (() => {});
  const session = await getSession(db, sessionId);
  if (!session) throw new JobError('not_found', 'Sesi tidak ditemukan', true);
  const parsed = SessionManifestSchema.safeParse(session.manifest);
  if (!parsed.success) throw new JobError('config_missing', 'Manifest sesi belum lengkap', true);
  const manifest: SessionManifest = parsed.data;

  const rawConfig = await getPublishedConfig(db, session.boothId, manifest.configVersion);
  if (!rawConfig)
    throw new JobError(
      'config_missing',
      `Config versi ${manifest.configVersion} tidak ditemukan`,
      true,
    );
  const migrated = migrateBoothConfig(rawConfig);
  if (!migrated.success) throw new JobError('config_missing', 'Config sesi tidak valid', true);
  const config: BoothConfig = migrated.config;

  const features = await getOrgPlanFeatures(db, session.orgId);
  const watermark = !features.watermarkRemoval;
  const outputs = await listSessionOutputs(db, sessionId);
  const sourceRow = (fileId: string) => outputs.find((o) => o.sourceFileId === fileId);
  const have = (kind: OutputKindName, name: string) =>
    outputs.find((o) => o.kind === kind && o.name === name && o.storagePath && !o.sourceFileId);

  const cameraView = config.pages.capture.elements.find((e) => e.type === 'camera-view');
  const mirror = cameraView?.type === 'camera-view' ? cameraView.mirror : false;
  const filter = config.filters.find((f) => f.id === manifest.filterId)?.params ?? null;
  const code = session.code;
  const loadAsset = createAssetLoader(config, deps.fetchAsset);

  const put = async (
    kind: OutputKindName,
    name: string,
    bytes: Buffer,
    mimeType: string,
    slotIndex: number | null,
  ) => {
    const key = sessionObjectKey(session.orgId, session.id, kind as OutputKind, name);
    await storage.put(key, bytes, mimeType);
    await upsertOutput(db, session, {
      kind,
      name,
      storagePath: key,
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
      mimeType,
      slotIndex,
    });
    return key;
  };
  const wm = (b: Buffer) => (watermark ? applyWatermark(b) : Promise.resolve(b));

  // 1. The selected originals, verified against the hash the agent sent.
  const shots = [...manifest.shots].sort((a, b) => a.slotIndex - b.slotIndex);
  const originals: { slotIndex: number; bytes: Buffer }[] = [];
  for (const shot of shots) {
    const row = sourceRow(shot.fileId);
    if (!row?.storagePath)
      throw new JobError(
        'storage_missing',
        `Foto slot ${shot.slotIndex} tidak ada di storage`,
        true,
      );
    let bytes: Buffer;
    try {
      bytes = await storage.get(row.storagePath);
    } catch {
      throw new JobError(
        'storage_missing',
        `Foto slot ${shot.slotIndex} hilang dari storage`,
        true,
      );
    }
    if (row.sha256 && sha256(bytes) !== row.sha256)
      throw new JobError('storage_missing', `Foto slot ${shot.slotIndex} rusak di storage`, true);
    originals.push({ slotIndex: shot.slotIndex, bytes });
  }

  // 2. mirrored/ and filtered/ (the filtered file is also the frame source for GIF and video).
  const filteredForMedia: Buffer[] = [];
  for (const o of originals) {
    const n = String(o.slotIndex);
    const mirroredName = `${code}-foto${n}-mirror.jpg`;
    if (!have('mirrored', mirroredName)) {
      await put(
        'mirrored',
        mirroredName,
        await wm(await mirrorPhoto(o.bytes)),
        'image/jpeg',
        o.slotIndex,
      );
    }
    const filteredName = `${code}-foto${n}-filter.jpg`;
    const existing = have('filtered', filteredName);
    if (existing?.storagePath) {
      filteredForMedia.push(await storage.get(existing.storagePath));
    } else {
      const f = await filterPhoto(o.bytes, filter, {
        mirror,
        seed: hashSeed(code) + o.slotIndex,
        maxWidth: 4000,
      });
      const withMark = await wm(f);
      await put('filtered', filteredName, withMark, 'image/jpeg', o.slotIndex);
      filteredForMedia.push(withMark);
    }
  }

  // 3. composite/: the strip printed at the booth; rebuilt here if the agent never sent it.
  const stripFile = manifest.files.find((f) => f.kind === 'composite');
  const stripRow: OutputRow | undefined = stripFile ? sourceRow(stripFile.id) : undefined;
  if (stripRow?.storagePath) {
    if (watermark) {
      const derivedKey = sessionObjectKey(
        session.orgId,
        session.id,
        'composite',
        stripRow.name ?? `${code}-strip.jpg`,
      );
      if (stripRow.storagePath !== derivedKey) {
        const marked = await applyWatermark(await storage.get(stripRow.storagePath));
        await storage.put(derivedKey, marked, 'image/jpeg');
        await replaceOutputFile(db, stripRow.id, {
          storagePath: derivedKey,
          bytes: marked.byteLength,
        });
      }
    }
  } else if (!have('composite', `${code}-strip.jpg`)) {
    log(`[worker] ${code}: composite missing, rebuilding`);
    const frame = config.frames.find((f) => f.id === manifest.frameId);
    if (!frame)
      throw new JobError('config_missing', `Frame ${manifest.frameId} tidak ada di config`, true);
    const photos: Record<number, Buffer> = {};
    for (const o of originals) photos[o.slotIndex] = o.bytes;
    const strip = await composeStrip({
      config,
      frame,
      photos,
      filter,
      mirror,
      downloadUrl: manifest.downloadUrl,
      now: session.startedAt,
      price: session.grossAmount,
      loadAsset,
      seed: hashSeed(code),
    });
    const jpeg = await encodeImage(strip, 'jpeg', config.printProfile.dpi);
    await put('composite', `${code}-strip.jpg`, await wm(jpeg), 'image/jpeg', null);
  }

  // 4. gif/
  if (config.output.gif.enabled && filteredForMedia.length > 0) {
    const name = `${code}.gif`;
    if (!have('gif', name)) {
      const gif = await buildGif(filteredForMedia, {
        frameDelayMs: config.output.gif.frameDelayMs,
        width: config.output.gif.width,
      });
      await put('gif', name, gif, 'image/gif', null);
    }
  }

  // 5. video/
  const v = config.output.video;
  if (v.enabled && filteredForMedia.length > 0) {
    const name = `${code}.mp4`;
    if (!have('video', name)) {
      const picked = pickVideoPhotos(
        filteredForMedia.map((buf, i) => ({ buf, i })),
        v.photoPick,
        v.photoCount,
        prng(hashSeed(code)),
      );
      let background: Buffer | null = null;
      if (v.backgroundAssetId) {
        const ref = config.assets.find((a) => a.id === v.backgroundAssetId);
        // A video background is not supported yet (docs/open-questions.md): solid color instead.
        if (ref?.kind === 'image') background = await loadAsset(ref.id);
      }
      const music = v.musicAssetId ? await loadAsset(v.musicAssetId) : null;
      const frames = await Promise.all(
        picked.map((p) =>
          buildVideoFrame({
            photo: p.buf,
            width: v.resolution.width,
            height: v.resolution.height,
            background,
          }),
        ),
      );
      const mp4 = await renderVideo({
        frames,
        secondsPerPhoto: v.secondsPerPhoto,
        music,
        ffmpegPath: deps.ffmpegPath,
      });
      await put('video', name, mp4, 'video/mp4', null);
    }
  }
  log(`[worker] ${code}: outputs ready`);
}
