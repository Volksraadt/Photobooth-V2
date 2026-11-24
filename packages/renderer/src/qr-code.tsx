'use client';

import { useMemo } from 'react';
import { QR_QUIET_ZONE, qrPath } from './qr-path';

export { qrPath };

export function QrCode({
  value,
  foreground = '#000000',
  background = '#ffffff',
  label,
}: {
  value: string;
  foreground?: string;
  background?: string;
  label?: string;
}) {
  const { size, d } = useMemo(() => qrPath(value), [value]);
  // 2-module quiet zone; element padding adds more.
  const q = QR_QUIET_ZONE;
  return (
    <svg
      viewBox={`${-q} ${-q} ${size + q * 2} ${size + q * 2}`}
      width="100%"
      height="100%"
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      data-pb-qr={value}
      style={{ display: 'block' }}
    >
      <rect x={-q} y={-q} width={size + q * 2} height={size + q * 2} fill={background} />
      <path d={d} fill={foreground} />
    </svg>
  );
}
