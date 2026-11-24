'use client';

import {
  filterColorMatrix,
  GRAIN_OPACITY,
  isNeutralColorMatrix,
  VIGNETTE_INNER,
  type FilterParams,
} from '@pb/schema';
import { useId, type CSSProperties } from 'react';

/** feColorMatrix `values` (4×5 row-major) for the shared filter matrix. */
export function filterMatrixValues(params: FilterParams): string {
  const { m, offset } = filterColorMatrix(params);
  const r = (v: number) => Number(v.toFixed(6));
  // prettier-ignore
  return [
    r(m[0]), r(m[1]), r(m[2]), 0, r(offset[0]),
    r(m[3]), r(m[4]), r(m[5]), 0, r(offset[1]),
    r(m[6]), r(m[7]), r(m[8]), 0, r(offset[2]),
    0, 0, 0, 1, 0,
  ].join(' ');
}

/** CSS radial gradient for the vignette overlay (see VIGNETTE_INNER in @pb/schema). */
export function vignetteGradient(amount: number): string {
  return `radial-gradient(ellipse farthest-corner at 50% 50%, rgba(0,0,0,0) ${VIGNETTE_INNER * 100}%, rgba(0,0,0,${amount}) 100%)`;
}

const GRAIN_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">' +
      '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>' +
      '<feColorMatrix type="saturate" values="0"/></filter>' +
      '<rect width="100%" height="100%" filter="url(#n)"/></svg>',
  );

export type FilteredImageProps = {
  src: string;
  params?: FilterParams | null;
  fit?: 'cover' | 'contain' | 'fill';
  mirror?: boolean;
  alt?: string;
  style?: CSSProperties;
};

/**
 * Image with a Filter applied exactly as defined in @pb/schema filter-math: one color matrix
 * (SVG feColorMatrix, sRGB) plus vignette and grain overlays.
 */
export function FilteredImage({
  src,
  params,
  fit = 'cover',
  mirror,
  alt = '',
  style,
}: FilteredImageProps) {
  const id = `pb-f${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const neutral = !params || isNeutralColorMatrix(filterColorMatrix(params));
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', ...style }}>
      {!neutral && (
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
          <filter id={id} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={filterMatrixValues(params)} />
          </filter>
        </svg>
      )}
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: fit,
          display: 'block',
          filter: neutral ? undefined : `url(#${id})`,
          transform: mirror ? 'scaleX(-1)' : undefined,
        }}
      />
      {params && params.vignette > 0 && (
        <div
          data-pb-vignette
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: vignetteGradient(params.vignette),
          }}
        />
      )}
      {params && params.grain > 0 && (
        <div
          data-pb-grain
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            backgroundImage: `url("${GRAIN_URL}")`,
            mixBlendMode: 'overlay',
            opacity: params.grain * GRAIN_OPACITY,
          }}
        />
      )}
    </div>
  );
}
