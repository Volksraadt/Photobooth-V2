import type { PhotoSlot } from '@pb/schema';

export type AlphaImage = {
  width: number;
  height: number;
  /** One alpha value (0–255) per pixel, row-major. */
  alpha: ArrayLike<number>;
};

/** Strip size of the print profile (slots are stored in these px). */
export const STRIP_PX = { width: 600, height: 1800 } as const;

const MAX_SLOTS = 12;

/**
 * Finds the photo windows of a frame overlay: enclosed transparent areas (alpha < 128) that do
 * not touch the image edge and cover at least 0.5% of it. Returned top-to-bottom, left-to-right,
 * as slots in strip px (the overlay is stretched to the strip, so other sizes are scaled).
 */
export function detectSlots(img: AlphaImage): PhotoSlot[] {
  const { width: w, height: h, alpha } = img;
  if (w < 4 || h < 4) return [];
  // Work on a coarse grid (≤ ~600 cells on the long side) to stay fast on large uploads.
  const step = Math.max(1, Math.floor(Math.max(w, h) / 600));
  const gw = Math.ceil(w / step);
  const gh = Math.ceil(h / step);
  const clear = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const y = Math.min(h - 1, gy * step);
    for (let gx = 0; gx < gw; gx++) {
      const x = Math.min(w - 1, gx * step);
      if (alpha[y * w + x]! < 128) clear[gy * gw + gx] = 1;
    }
  }

  const seen = new Uint8Array(gw * gh);
  const boxes: { x0: number; y0: number; x1: number; y1: number; cells: number }[] = [];
  const queue = new Int32Array(gw * gh);
  for (let start = 0; start < clear.length; start++) {
    if (!clear[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let x0 = gw;
    let y0 = gh;
    let x1 = -1;
    let y1 = -1;
    let cells = 0;
    let edge = false;
    while (head < tail) {
      const i = queue[head++]!;
      const x = i % gw;
      const y = (i - x) / gw;
      cells++;
      if (x === 0 || y === 0 || x === gw - 1 || y === gh - 1) edge = true;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const near = [
        x > 0 ? i - 1 : -1,
        x < gw - 1 ? i + 1 : -1,
        y > 0 ? i - gw : -1,
        y < gh - 1 ? i + gw : -1,
      ];
      for (const n of near) {
        if (n >= 0 && clear[n] && !seen[n]) {
          seen[n] = 1;
          queue[tail++] = n;
        }
      }
    }
    if (!edge && cells >= gw * gh * 0.005) boxes.push({ x0, y0, x1, y1, cells });
  }

  const sx = STRIP_PX.width / w;
  const sy = STRIP_PX.height / h;
  const r = (v: number) => Math.round(v * 100) / 100;
  return boxes
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
    .slice(0, MAX_SLOTS)
    .map((b, i) => {
      const { left, top, right, bottom } = refine(img, b, step);
      return {
        index: i + 1,
        x: r(left * sx),
        y: r(top * sy),
        width: r((right - left) * sx),
        height: r((bottom - top) * sy),
        rotation: 0,
        borderRadius: 0,
      };
    });
}

/** Exact pixel bounds of the transparent area around a coarse grid box. */
function refine(
  { width: w, height: h, alpha }: AlphaImage,
  b: { x0: number; y0: number; x1: number; y1: number },
  step: number,
) {
  const sx0 = Math.max(0, (b.x0 - 1) * step);
  const sy0 = Math.max(0, (b.y0 - 1) * step);
  const sx1 = Math.min(w - 1, (b.x1 + 2) * step);
  const sy1 = Math.min(h - 1, (b.y1 + 2) * step);
  let left = w;
  let top = h;
  let right = -1;
  let bottom = -1;
  for (let y = sy0; y <= sy1; y++) {
    for (let x = sx0; x <= sx1; x++) {
      if (alpha[y * w + x]! >= 128) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return { left, top, right: right + 1, bottom: bottom + 1 };
}

/** Reads an image file in the browser and returns its alpha channel. */
export async function readAlpha(file: Blob): Promise<AlphaImage> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas tidak tersedia.');
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const alpha = new Uint8Array(bitmap.width * bitmap.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!;
  return { width: bitmap.width, height: bitmap.height, alpha };
}
