'use client';

import QRCode from 'qrcode';
import { useMemo } from 'react';

/** SVG path of the QR modules (1 unit = 1 module), plus the module count. */
export function qrPath(text: string): { size: number; d: string } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const { size, data } = qr.modules;
  let d = '';
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (data[y * size + x]) {
        const start = x;
        while (x < size && data[y * size + x]) x++;
        d += `M${start} ${y}h${x - start}v1h${start - x}z`;
      } else {
        x++;
      }
    }
  }
  return { size, d };
}

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
  const q = 2;
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
