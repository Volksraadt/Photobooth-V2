import { createCanvas } from '@napi-rs/canvas';
import type { FilterParams } from '@pb/schema';
import sharp from 'sharp';
import { applyFilter } from './filter';
import { resolveFontFamily } from './draw';
import type { ImageSource } from './strip';

/**
 * Per-session digital outputs (docs/phases/F5): mirrored, filtered, GIF, watermark and the video
 * frames. Same decode path as the strip (EXIF orientation first, then flip/crop/filter), so a
 * filtered file matches what the buyer saw in Review.
 */

const JPEG = { quality: 92, chromaSubsampling: '4:4:4', mozjpeg: false } as const;

function open(src: ImageSource) {
  return sharp(typeof src === 'string' ? src : Buffer.from(src), { failOn: 'none' }).rotate();
}

/** `mirrored/`: the photo flipped horizontally, like the buyer's screen (EXIF-oriented, full size). */
export async function mirrorPhoto(src: ImageSource): Promise<Buffer> {
  return open(src).flop().jpeg(JPEG).withMetadata({ orientation: undefined }).toBuffer();
}

/**
 * `filtered/`: the buyer's filter on the photo (full size). `mirror` follows the booth's
 * camera-view setting, i.e. the orientation the buyer approved in Review.
 */
export async function filterPhoto(
  src: ImageSource,
  filter: FilterParams | null,
  opts: { mirror: boolean; seed?: number; maxWidth?: number },
): Promise<Buffer> {
  let img = open(src);
  if (opts.mirror) img = img.flop();
  if (opts.maxWidth) img = img.resize({ width: opts.maxWidth, withoutEnlargement: true });
  const { data, info } = await img
    .removeAlpha()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  applyFilter(data, info.width, info.height, filter, opts.seed ?? 1);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .removeAlpha()
    .jpeg(JPEG)
    .toBuffer();
}

/** Animated GIF of the photos in order, each shown `frameDelayMs`, resized to `width`. */
export async function buildGif(
  frames: ImageSource[],
  opts: { frameDelayMs: number; width: number },
): Promise<Buffer> {
  if (frames.length === 0) throw new Error('GIF needs at least one photo');
  const width = Math.max(16, Math.round(opts.width));
  // All frames share the first frame's aspect ratio (cover-cropped) so the GIF does not jump.
  const first = await open(frames[0]!).resize({ width }).toBuffer({ resolveWithObject: true });
  const height = first.info.height;
  const buffers = await Promise.all(
    frames.map((f) =>
      open(f)
        .resize(width, height, { fit: 'cover', position: 'centre' })
        .removeAlpha()
        .png()
        .toBuffer(),
    ),
  );
  if (buffers.length === 1) {
    return sharp(buffers[0]!).gif().toBuffer();
  }
  return sharp(buffers, { join: { animated: true } })
    .gif({ delay: buffers.map(() => Math.max(20, Math.round(opts.frameDelayMs))), loop: 0 })
    .toBuffer();
}

export const WATERMARK_TEXT = 'photobooth-platform';

/** Small translucent badge, bottom right; ~26% of the image width (never covers faces). */
export async function applyWatermark(
  src: ImageSource,
  opts: { text?: string } = {},
): Promise<Buffer> {
  const base = await open(src).toBuffer({ resolveWithObject: true });
  const { width, height } = base.info;
  const text = opts.text ?? WATERMARK_TEXT;
  const fontPx = Math.max(12, Math.round(Math.min(width, height) * 0.032));
  const padX = Math.round(fontPx * 0.7);
  const padY = Math.round(fontPx * 0.4);
  const font = `600 ${fontPx}px ${resolveFontFamily('system-ui, sans-serif')}`;
  const probe = createCanvas(10, 10).getContext('2d');
  probe.font = font;
  const textW = Math.ceil(probe.measureText(text).width);
  const badgeW = textW + padX * 2;
  const badgeH = Math.round(fontPx * 1.2) + padY * 2;
  const badge = createCanvas(badgeW, badgeH);
  const ctx = badge.getContext('2d');
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.roundRect(0, 0, badgeW, badgeH, badgeH / 2);
  ctx.fill();
  ctx.font = font;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padX, badgeH / 2 + fontPx * 0.04);
  const margin = Math.round(fontPx * 0.8);
  const left = Math.max(0, width - badgeW - margin);
  const top = Math.max(0, height - badgeH - margin);
  return sharp(base.data)
    .composite([{ input: badge.toBuffer('image/png'), left, top }])
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4', mozjpeg: false })
    .withMetadata({ density: 300 })
    .toBuffer();
}

export type VideoFrameInput = {
  photo: ImageSource;
  width: number;
  height: number;
  /** Image drawn behind the photo (cover); null = solid dark background. */
  background: ImageSource | null;
};

/**
 * One 1080×1920 video frame: the photo fitted to the full width at 16:9 and centered vertically,
 * on the background. ffmpeg then just holds each frame for `secondsPerPhoto`.
 */
export async function buildVideoFrame(f: VideoFrameInput): Promise<Buffer> {
  const photoH = Math.round((f.width * 9) / 16 / 2) * 2;
  const photo = await open(f.photo)
    .resize(f.width, photoH, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
    .removeAlpha()
    .toBuffer();
  const bg = f.background
    ? await open(f.background)
        .resize(f.width, f.height, { fit: 'cover', position: 'centre' })
        .removeAlpha()
        .toBuffer()
    : await sharp({
        create: { width: f.width, height: f.height, channels: 3, background: '#111111' },
      })
        .png()
        .toBuffer();
  return sharp(bg)
    .composite([{ input: photo, left: 0, top: Math.round((f.height - photoH) / 2) }])
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

/** Picks `count` photos for the video (PRD §8): `first`, or `random` seeded by the session. */
export function pickVideoPhotos<T>(
  photos: T[],
  mode: 'random' | 'first' | 'buyer',
  count: number,
  rand: () => number,
): T[] {
  if (photos.length <= count) return [...photos];
  if (mode === 'first') return photos.slice(0, count);
  // `buyer`: the flow has no pick step yet (docs/open-questions.md), so it behaves like random.
  const pool = [...photos];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count).sort((a, b) => photos.indexOf(a) - photos.indexOf(b));
}
