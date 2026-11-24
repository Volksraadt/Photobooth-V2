import type { FilterParams } from './filter';

/**
 * Single numeric definition of a Filter, shared by the renderer (SVG feColorMatrix + CSS overlays)
 * and the compositor (sharp recomb/linear + composite). See docs/schema.md A.4.
 *
 * Color part: one affine transform on sRGB values in 0..1, applied in this order:
 * brightness → contrast → saturation → hueRotate → sepia → warmth. No clamping between steps;
 * the result is clamped to 0..1 once.
 */
export type FilterColorMatrix = {
  /** 3×3 row-major: out[r] = m[0]*r + m[1]*g + m[2]*b + offset[0], ... */
  m: [number, number, number, number, number, number, number, number, number];
  /** Per-channel offset, 0..1 units. */
  offset: [number, number, number];
};

type Affine = FilterColorMatrix;

const IDENTITY: Affine = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], offset: [0, 0, 0] };

/** Warmth gain per channel at warmth = 1 (negated at -1). */
export const WARMTH_GAIN = { r: 0.15, g: 0.03, b: -0.15 } as const;

/** Vignette: black overlay, alpha = vignette × clamp((d − inner) / (1 − inner), 0, 1),
 *  d = elliptical distance from center, 1 at the corners (CSS `ellipse farthest-corner`). */
export const VIGNETTE_INNER = 0.45;

/** Grain: monochrome noise (mean 0.5) blended with `overlay` at opacity grain × GRAIN_OPACITY. */
export const GRAIN_OPACITY = 0.5;

function diag(
  r: number,
  g: number,
  b: number,
  offset: [number, number, number] = [0, 0, 0],
): Affine {
  return { m: [r, 0, 0, 0, g, 0, 0, 0, b], offset };
}

/** Apply `a` first, then `b`. */
function then(a: Affine, b: Affine): Affine {
  const m = new Array<number>(9) as Affine['m'];
  const offset = [0, 0, 0] as Affine['offset'];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += b.m[row * 3 + k]! * a.m[k * 3 + col]!;
      m[row * 3 + col] = sum;
    }
    let o = b.offset[row]!;
    for (let k = 0; k < 3; k++) o += b.m[row * 3 + k]! * a.offset[k]!;
    offset[row] = o;
  }
  return { m, offset };
}

// Matrices from the Filter Effects spec (saturate, hue-rotate, sepia).
function saturate(s: number): Affine {
  return {
    // prettier-ignore
    m: [
      0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
      0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
      0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
    ],
    offset: [0, 0, 0],
  };
}

function hueRotate(deg: number): Affine {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    // prettier-ignore
    m: [
      0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
      0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
      0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
    ],
    offset: [0, 0, 0],
  };
}

function sepia(amount: number): Affine {
  const a = 1 - amount;
  return {
    // prettier-ignore
    m: [
      0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a,
      0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a,
      0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a,
    ],
    offset: [0, 0, 0],
  };
}

export function filterColorMatrix(p: FilterParams): FilterColorMatrix {
  const steps: Affine[] = [
    diag(p.brightness, p.brightness, p.brightness),
    diag(p.contrast, p.contrast, p.contrast, [
      0.5 * (1 - p.contrast),
      0.5 * (1 - p.contrast),
      0.5 * (1 - p.contrast),
    ]),
    saturate(p.saturation),
    hueRotate(p.hueRotate),
    sepia(p.sepia),
    diag(1 + WARMTH_GAIN.r * p.warmth, 1 + WARMTH_GAIN.g * p.warmth, 1 + WARMTH_GAIN.b * p.warmth),
  ];
  return steps.reduce(then, IDENTITY);
}

/** Apply the color matrix to one sRGB pixel (0..255). Reference implementation for tests. */
export function applyFilterColorMatrix(
  matrix: FilterColorMatrix,
  rgb: [number, number, number],
): [number, number, number] {
  const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
  const out = [0, 1, 2].map((row) => {
    const v =
      matrix.m[row * 3]! * r +
      matrix.m[row * 3 + 1]! * g +
      matrix.m[row * 3 + 2]! * b +
      matrix.offset[row]!;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  });
  return out as [number, number, number];
}

export function isNeutralColorMatrix(matrix: FilterColorMatrix, epsilon = 1e-9): boolean {
  return (
    matrix.m.every((v, i) => Math.abs(v - IDENTITY.m[i]!) < epsilon) &&
    matrix.offset.every((v) => Math.abs(v) < epsilon)
  );
}
