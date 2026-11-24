import type { PrintProfile } from '@pb/schema';
import sharp, { type OverlayOptions } from 'sharp';
import type { RawImage } from './strip';

export type SheetLayout = {
  width: number;
  height: number;
  /** Top-left of each strip on the sheet. */
  strips: { x: number; y: number }[];
};

/** Sheet geometry for a print profile (2×6 strips: two side by side on 4×6 = 1200×1800 @300dpi). */
export function sheetLayout(profile: PrintProfile): SheetLayout {
  const b = profile.bleedPx;
  const { width } = profile.stripPx;
  const paperW = Math.round(profile.paper.widthIn * profile.dpi);
  const paperH = Math.round(profile.paper.heightIn * profile.dpi);
  return {
    width: paperW + b * 2,
    height: paperH + b * 2,
    strips: [
      { x: b, y: b },
      { x: b + width, y: b },
    ],
  };
}

/**
 * Print sheet: the same strip twice, side by side. `bleedPx` extends the outer edges (edge pixels
 * repeated) for printers that overscan; `cutMarks` draws short marks on the center cut line.
 */
export async function composeSheet(
  strip: RawImage,
  profile: PrintProfile,
  format: 'jpeg' | 'png' = 'jpeg',
): Promise<Buffer> {
  const layout = sheetLayout(profile);
  const b = profile.bleedPx;
  const stripPng = await sharp(strip.data, {
    raw: { width: strip.width, height: strip.height, channels: 4 },
  })
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 1 })
    .toBuffer();

  const extended = async (side: 'left' | 'right') =>
    b === 0
      ? stripPng
      : sharp(stripPng)
          .extend({
            top: b,
            bottom: b,
            left: side === 'left' ? b : 0,
            right: side === 'right' ? b : 0,
            extendWith: 'copy',
          })
          .png({ compressionLevel: 1 })
          .toBuffer();

  const layers: OverlayOptions[] = [
    { input: await extended('left'), left: 0, top: 0 },
    { input: await extended('right'), left: layout.strips[1]!.x, top: 0 },
  ];
  if (profile.cutMarks) {
    const x = layout.strips[1]!.x;
    const len = 36;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}">
      <g stroke="#7f7f7f" stroke-width="2">
        <line x1="${x}" y1="0" x2="${x}" y2="${len}"/>
        <line x1="${x}" y1="${layout.height - len}" x2="${x}" y2="${layout.height}"/>
      </g></svg>`;
    layers.push({ input: Buffer.from(svg), left: 0, top: 0 });
  }
  const sheet = sharp({
    create: {
      width: layout.width,
      height: layout.height,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite(layers)
    .withMetadata({ density: profile.dpi });
  return format === 'png'
    ? sheet.png().toBuffer()
    : sheet.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
}
