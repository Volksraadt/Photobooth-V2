import type { AssetRef } from './booth-config';

/**
 * Built-in 600×1800 strip overlay: white strip with 4 transparent photo windows
 * (540×360 at x=30, y=40/420/800/1180). Matches DEFAULT_STRIP_SLOTS.
 */
export const DEFAULT_STRIP_OVERLAY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1800" viewBox="0 0 600 1800">' +
  '<path fill="#ffffff" fill-rule="evenodd" d="M0 0H600V1800H0Z' +
  'M30 40H570V400H30Z' +
  'M30 420H570V780H30Z' +
  'M30 800H570V1160H30Z' +
  'M30 1180H570V1540H30Z"/></svg>';

// Precomputed so the schema package stays sync and browser-safe; verified by test.
export const DEFAULT_STRIP_OVERLAY_SHA256 =
  'd7e74f7b90f38a4a503a031f65e2967ba87ac440de7365bcea828bbd28ae1023';

export const DEFAULT_STRIP_OVERLAY_ASSET_ID = 'builtin-strip-overlay-4';

export const DEFAULT_STRIP_SLOTS = [40, 420, 800, 1180].map((y, i) => ({
  index: i + 1,
  x: 30,
  y,
  width: 540,
  height: 360,
  rotation: 0,
  borderRadius: 0,
}));

export function defaultStripOverlayAsset(): AssetRef {
  return {
    id: DEFAULT_STRIP_OVERLAY_ASSET_ID,
    kind: 'image',
    url: `data:image/svg+xml;base64,${btoa(DEFAULT_STRIP_OVERLAY_SVG)}`,
    sha256: DEFAULT_STRIP_OVERLAY_SHA256,
    bytes: DEFAULT_STRIP_OVERLAY_SVG.length,
  };
}
