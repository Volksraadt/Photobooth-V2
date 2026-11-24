import {
  filterColorMatrix,
  GRAIN_OPACITY,
  isNeutralColorMatrix,
  VIGNETTE_INNER,
  type FilterParams,
} from '@pb/schema';

/** Deterministic PRNG (mulberry32) so a session always composes to the same bytes. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Applies a Filter to an RGBA buffer in place, exactly as docs/schema.md A.4 defines it:
 * one affine color transform on sRGB values (clamped once), then the vignette overlay, then
 * grain blended with `overlay`. Same order as the renderer's <FilteredImage> layers.
 *
 * Done in JS rather than sharp `recomb` + `linear`: sharp would clamp to 8 bits between the two
 * operations, while the definition clamps only once at the end. Slot-sized buffers are small.
 */
export function applyFilter(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  params: FilterParams | null | undefined,
  seed = 1,
): void {
  if (!params) return;
  const matrix = filterColorMatrix(params);
  if (!isNeutralColorMatrix(matrix)) {
    const { m, offset } = matrix;
    // Lookup tables: m[i] * v for every 8-bit v, in 0..1 output units.
    const lut = m.map((k) => {
      const t = new Float64Array(256);
      for (let v = 0; v < 256; v++) t[v] = k * (v / 255);
      return t;
    });
    const [o0, o1, o2] = offset;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      data[i] = to8(lut[0]![r]! + lut[1]![g]! + lut[2]![b]! + o0);
      data[i + 1] = to8(lut[3]![r]! + lut[4]![g]! + lut[5]![b]! + o1);
      data[i + 2] = to8(lut[6]![r]! + lut[7]![g]! + lut[8]![b]! + o2);
    }
  }

  if (params.vignette > 0) {
    // CSS `radial-gradient(ellipse farthest-corner)`: d = 1 at the corners.
    const cx = width / 2;
    const cy = height / 2;
    const rx = cx * Math.SQRT2;
    const ry = cy * Math.SQRT2;
    for (let y = 0; y < height; y++) {
      const dy = (y + 0.5 - cy) / ry;
      for (let x = 0; x < width; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const d = Math.sqrt(dx * dx + dy * dy);
        const t = Math.min(1, Math.max(0, (d - VIGNETTE_INNER) / (1 - VIGNETTE_INNER)));
        const keep = 1 - params.vignette * t;
        if (keep >= 1) continue;
        const i = (y * width + x) * 4;
        data[i] = Math.round(data[i]! * keep);
        data[i + 1] = Math.round(data[i + 1]! * keep);
        data[i + 2] = Math.round(data[i + 2]! * keep);
      }
    }
  }

  if (params.grain > 0) {
    const opacity = params.grain * GRAIN_OPACITY;
    const rand = prng(seed);
    for (let i = 0; i < data.length; i += 4) {
      // Monochrome noise, mean 0.5 (triangular distribution, like smoothed turbulence).
      const n = (rand() + rand()) / 2;
      for (let c = 0; c < 3; c++) {
        const base = data[i + c]! / 255;
        const blended = base <= 0.5 ? 2 * base * n : 1 - 2 * (1 - base) * (1 - n);
        data[i + c] = to8(base + (blended - base) * opacity);
      }
    }
  }
}

function to8(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}
