import {
  createCanvas,
  GlobalFonts,
  loadImage,
  type Canvas,
  type Image,
  type SKRSContext2D,
} from '@napi-rs/canvas';
import type { TokenValues } from '@pb/renderer/pure';
import type { BoothConfig, Element, FilterParams, Frame, PhotoSlot } from '@pb/schema';
import sharp, { type Sharp } from 'sharp';
import { drawElement } from './draw';
import { applyFilter } from './filter';

/** Image bytes or a file path. */
export type ImageSource = Buffer | Uint8Array | string;

export type ComposeStripInput = {
  config: BoothConfig;
  frame: Frame;
  /** Selected photo per slot index (1-based). Original, unmirrored camera files. */
  photos: Partial<Record<number, ImageSource>>;
  filter: FilterParams | null;
  /** Mirror photos like the buyer saw them (camera-view.mirror), as the Review preview does. */
  mirror: boolean;
  /** Short link `/s/:code` for download-qr. */
  downloadUrl: string | null;
  /** {{date}}; the session time (stored UTC, shown in the booth zone). */
  now: Date;
  /** {{price}} */
  price?: number;
  /** Bytes of a config asset (overlay, underlay, image elements, fonts). */
  loadAsset: (assetId: string) => Promise<Buffer>;
  /** Seed for grain noise (deterministic per session). */
  seed?: number;
};

export type RawImage = { data: Buffer; width: number; height: number; channels: 4 };

const registeredFonts = new Set<string>();

/** Uploaded fonts are referenced as `pb-font-<assetId>` (docs/schema.md A.5). */
function fontAssetIds(elements: Element[]): string[] {
  const ids = new Set<string>();
  for (const el of elements) {
    if (el.type !== 'text') continue;
    for (const m of el.fontFamily.matchAll(/pb-font-([A-Za-z0-9_-]+)/g)) ids.add(m[1]!);
  }
  return [...ids];
}

async function registerFonts(input: ComposeStripInput): Promise<void> {
  for (const id of fontAssetIds(input.frame.dynamicElements)) {
    if (registeredFonts.has(id)) continue;
    try {
      const bytes = await input.loadAsset(id);
      if (GlobalFonts.register(bytes, `pb-font-${id}`)) registeredFonts.add(id);
    } catch (err) {
      console.warn(`[compositor] font ${id} unavailable; falling back`, err);
    }
  }
}

/** Rasterizes an asset (PNG/JPEG/WebP/SVG) to exactly w×h using CSS object-fit semantics. */
async function rasterAsset(
  bytes: Buffer,
  width: number,
  height: number,
  fit: 'cover' | 'contain' | 'fill',
): Promise<Image> {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const png = await sharp(bytes, { density: 300, failOn: 'none' })
    .resize(w, h, {
      fit: fit === 'fill' ? 'fill' : fit,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return loadImage(png);
}

async function readSource(src: ImageSource): Promise<Sharp> {
  return sharp(typeof src === 'string' ? src : Buffer.from(src), { failOn: 'none' });
}

/** One slot photo: EXIF-oriented, mirrored if needed, center-cropped (object-fit: cover), filtered. */
async function slotPhoto(
  src: ImageSource,
  slot: PhotoSlot,
  filter: FilterParams | null,
  mirror: boolean,
  seed: number,
): Promise<Canvas> {
  const w = Math.max(1, Math.round(slot.width));
  const h = Math.max(1, Math.round(slot.height));
  let img = (await readSource(src)).rotate();
  if (mirror) img = img.flop();
  const { data, info } = await img
    .resize(w, h, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
    .removeAlpha()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  applyFilter(data, info.width, info.height, filter, seed + slot.index);
  const canvas = createCanvas(info.width, info.height);
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(info.width, info.height);
  imageData.data.set(data);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function drawSlot(ctx: SKRSContext2D, slot: PhotoSlot, photo: Canvas) {
  ctx.save();
  ctx.translate(slot.x + slot.width / 2, slot.y + slot.height / 2);
  if (slot.rotation) ctx.rotate((slot.rotation * Math.PI) / 180);
  ctx.beginPath();
  const r = Math.min(slot.borderRadius, slot.width / 2, slot.height / 2);
  if (r > 0) ctx.roundRect(-slot.width / 2, -slot.height / 2, slot.width, slot.height, r);
  else ctx.rect(-slot.width / 2, -slot.height / 2, slot.width, slot.height);
  ctx.clip();
  ctx.drawImage(photo, -slot.width / 2, -slot.height / 2, slot.width, slot.height);
  ctx.restore();
}

/**
 * The print strip (printProfile.stripPx, 600×1800 for 2×6 @300dpi), layered exactly like the
 * renderer's <FrameComposite>: white paper → underlay → photos → overlay → dynamic elements.
 */
export async function composeStrip(input: ComposeStripInput): Promise<RawImage> {
  const { config, frame } = input;
  const { width, height } = config.printProfile.stripPx;
  const seed = input.seed ?? 1;

  const imageElements = frame.dynamicElements.filter(
    (e): e is Extract<Element, { type: 'image' }> => e.type === 'image' && e.visible,
  );
  const [underlay, overlay, photos, elementImages] = await Promise.all([
    frame.underlayAssetId
      ? input.loadAsset(frame.underlayAssetId).then((b) => rasterAsset(b, width, height, 'fill'))
      : null,
    input.loadAsset(frame.overlayAssetId).then((b) => rasterAsset(b, width, height, 'fill')),
    Promise.all(
      frame.slots.map(async (slot) => {
        const src = input.photos[slot.index];
        return src
          ? ([slot, await slotPhoto(src, slot, input.filter, input.mirror, seed)] as const)
          : null;
      }),
    ),
    Promise.all(
      imageElements.map(async (el) => {
        try {
          const bytes = await input.loadAsset(el.assetId);
          return [
            el.assetId + ':' + el.id,
            await rasterAsset(bytes, el.width, el.height, el.fit),
          ] as const;
        } catch {
          return null;
        }
      }),
    ),
    registerFonts(input),
  ]);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  if (underlay) ctx.drawImage(underlay, 0, 0, width, height);
  for (const entry of photos) if (entry) drawSlot(ctx, entry[0], entry[1]);
  ctx.drawImage(overlay, 0, 0, width, height);

  const images = new Map(elementImages.filter((e) => e !== null));
  const tokens: TokenValues = {
    price: input.price ?? config.pricing.basePrice,
    boothName: config.output.driveRootFolderName,
    date: input.now,
    timezone: config.timezone,
    locale: config.locale,
  };
  for (const el of frame.dynamicElements) {
    drawElement(ctx, el, {
      tokens,
      downloadUrl: input.downloadUrl,
      assets: { image: (assetId) => images.get(`${assetId}:${el.id}`) },
    });
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  return { data: Buffer.from(imageData.data.buffer), width, height, channels: 4 };
}

/** Encodes a composed image with 300 dpi metadata. */
export async function encodeImage(
  raw: RawImage,
  format: 'jpeg' | 'png',
  dpi = 300,
): Promise<Buffer> {
  const img = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .flatten({ background: '#ffffff' })
    .withMetadata({ density: dpi });
  return format === 'png'
    ? img.png({ compressionLevel: 6 }).toBuffer()
    : img.jpeg({ quality: 95, chromaSubsampling: '4:4:4', mozjpeg: false }).toBuffer();
}
