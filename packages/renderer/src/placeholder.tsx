'use client';

import type { CSSProperties } from 'react';

/** Labeled hatch box: flow-bound element without data in editor mode. */
export function Placeholder({
  label,
  width,
  height,
  style,
}: {
  label: string;
  width: number;
  height: number;
  style?: CSSProperties;
}) {
  const fontSize = Math.max(14, Math.min(48, Math.min(width, height) * 0.12));
  return (
    <div
      data-pb-placeholder
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 8,
        background:
          'repeating-linear-gradient(45deg, rgba(148,163,184,0.28) 0 12px, rgba(148,163,184,0.14) 12px 24px)',
        color: 'rgba(241,245,249,0.95)',
        textShadow: '0 1px 2px rgba(0,0,0,0.6)',
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 600,
        fontSize,
        lineHeight: 1.2,
        overflow: 'hidden',
        ...style,
      }}
    >
      {label}
    </div>
  );
}

/** Neutral pulsing box: live element still waiting for data (no text, owner controls copy). */
export function Pending({ style }: { style?: CSSProperties }) {
  return (
    <div
      data-pb-pending
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(148,163,184,0.35)',
        animation: 'pb-shimmer 1.4s ease-in-out infinite',
        ...style,
      }}
    />
  );
}

/**
 * Sample photo (landscape 3:2) used for filter thumbnails and previews without real shots.
 * Inline SVG so it works offline and in tests.
 */
export const SAMPLE_PHOTO_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">' +
      '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#fde68a"/></linearGradient></defs>' +
      '<rect width="1200" height="800" fill="url(#s)"/>' +
      '<circle cx="930" cy="210" r="110" fill="#fb923c"/>' +
      '<path d="M0 560 Q300 420 600 540 T1200 500 V800 H0Z" fill="#16a34a"/>' +
      '<path d="M0 650 Q400 560 800 660 T1200 640 V800 H0Z" fill="#15803d"/>' +
      '<circle cx="430" cy="420" r="80" fill="#f1c7a6"/>' +
      '<path d="M310 800 Q320 560 430 540 Q540 560 550 800Z" fill="#db2777"/>' +
      '<circle cx="700" cy="450" r="70" fill="#a16207"/>' +
      '<path d="M600 800 Q610 600 700 580 Q790 600 800 800Z" fill="#7c3aed"/>' +
      '</svg>',
  );
