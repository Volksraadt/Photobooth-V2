import type { Image, SKRSContext2D } from '@napi-rs/canvas';
import { createCanvas } from '@napi-rs/canvas';
import { qrPath, QR_QUIET_ZONE, resolveTextTokens, type TokenValues } from '@pb/renderer/pure';
import type { BoxStyle, Element, ElementOf } from '@pb/schema';

/**
 * Canvas (Skia) drawing of frame dynamic elements, mirroring the renderer's DOM/CSS output:
 * border-box sizing, CSS border inside the box, box-shadow blur = 2σ, `overflow: hidden` +
 * border-radius clipping, `opacity` as group opacity, rotation about the element center.
 */

export type ElementAssets = {
  /** Decoded image for an `image` element, already sized to the element box per its `fit`. */
  image(assetId: string): Image | undefined;
};

export type DrawContext = {
  tokens: TokenValues;
  downloadUrl: string | null;
  assets: ElementAssets;
};

function roundRectPath(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  if (radius > 0) ctx.roundRect(x, y, w, h, radius);
  else ctx.rect(x, y, w, h);
}

function hasBorder(style: BoxStyle | undefined): style is BoxStyle & { borderWidth: number } {
  return !!(style?.borderWidth && style.borderColor);
}

/** Background + shadow of a CSS box at (0,0,w,h). */
function drawBoxBackground(
  ctx: SKRSContext2D,
  w: number,
  h: number,
  fill: string | undefined,
  style: BoxStyle | undefined,
  ellipse = false,
): void {
  if (!fill) return;
  ctx.save();
  if (style?.shadow) {
    ctx.shadowColor = style.shadow.color;
    ctx.shadowOffsetX = style.shadow.x;
    ctx.shadowOffsetY = style.shadow.y;
    ctx.shadowBlur = style.shadow.blur;
  }
  ctx.fillStyle = fill;
  if (ellipse) {
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    roundRectPath(ctx, 0, 0, w, h, style?.borderRadius ?? 0);
  }
  ctx.fill();
  ctx.restore();
}

function drawBoxBorder(ctx: SKRSContext2D, w: number, h: number, style: BoxStyle | undefined) {
  if (!hasBorder(style)) return;
  const bw = style.borderWidth;
  ctx.save();
  ctx.strokeStyle = style.borderColor!;
  ctx.lineWidth = bw;
  roundRectPath(
    ctx,
    bw / 2,
    bw / 2,
    w - bw,
    h - bw,
    Math.max(0, (style.borderRadius ?? 0) - bw / 2),
  );
  ctx.stroke();
  ctx.restore();
}

function clipBox(ctx: SKRSContext2D, w: number, h: number, style: BoxStyle | undefined) {
  roundRectPath(ctx, 0, 0, w, h, style?.borderRadius ?? 0);
  ctx.clip();
}

// --- text ---

/** CSS `white-space: pre-wrap; overflow-wrap: break-word` line breaking. */
export function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const width = (s: string) => ctx.measureText(s.replace(/\s+$/, '')).width;
  for (const paragraph of text.split('\n')) {
    const tokens = paragraph.match(/\S+\s*|\s+/g) ?? [''];
    let line = '';
    for (const token of tokens) {
      if (line && width(line + token) > maxWidth) {
        lines.push(line);
        line = '';
      }
      if (!line && width(token) > maxWidth) {
        // A single word wider than the box: break between characters.
        let part = '';
        for (const ch of token) {
          if (part && width(part + ch) > maxWidth) {
            lines.push(part);
            part = '';
          }
          part += ch;
        }
        line = part;
        continue;
      }
      line += token;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * CSS generic families → the fonts Chromium (Kiosk webview / Studio) picks on this OS, so the
 * print uses the same glyphs as the screen. Skia alone would fall back to its own default.
 */
const GENERIC_FONTS: Record<string, Record<string, string>> = {
  win32: {
    'system-ui': '"Segoe UI"',
    '-apple-system': '"Segoe UI"',
    blinkmacsystemfont: '"Segoe UI"',
    'sans-serif': 'Arial',
    serif: '"Times New Roman"',
    monospace: 'Consolas',
  },
  darwin: {
    'system-ui': '"SF Pro Text", "Helvetica Neue"',
    '-apple-system': '"SF Pro Text", "Helvetica Neue"',
    blinkmacsystemfont: '"SF Pro Text", "Helvetica Neue"',
    'sans-serif': 'Helvetica',
    serif: 'Times',
    monospace: 'Menlo',
  },
  linux: {
    'system-ui': 'Ubuntu, Cantarell, "DejaVu Sans"',
    '-apple-system': 'Ubuntu, Cantarell, "DejaVu Sans"',
    blinkmacsystemfont: 'Ubuntu, Cantarell, "DejaVu Sans"',
    'sans-serif': '"DejaVu Sans", "Liberation Sans"',
    serif: '"DejaVu Serif", "Liberation Serif"',
    monospace: '"DejaVu Sans Mono", "Liberation Mono"',
  },
};

export function resolveFontFamily(family: string, platform: string = process.platform): string {
  const map = GENERIC_FONTS[platform] ?? GENERIC_FONTS.linux!;
  return family
    .split(',')
    .map((part) => {
      const name = part.trim();
      return map[name.replace(/^["']|["']$/g, '').toLowerCase()] ?? name;
    })
    .join(', ');
}

function cssFont(weight: number, size: number, family: string): string {
  return `${weight} ${size}px ${resolveFontFamily(family)}`;
}

function drawText(ctx: SKRSContext2D, el: ElementOf<'text'>, dc: DrawContext) {
  const w = el.width;
  const h = el.height;
  drawBoxBackground(ctx, w, h, el.style?.fill, el.style);
  drawBoxBorder(ctx, w, h, el.style);
  const inset = hasBorder(el.style) ? el.style!.borderWidth! : 0;
  const content = resolveTextTokens(el.content, dc.tokens);
  ctx.save();
  ctx.font = cssFont(el.fontWeight, el.fontSize, el.fontFamily);
  ctx.letterSpacing = `${el.letterSpacing}px`;
  ctx.fillStyle = el.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const boxW = w - inset * 2;
  const lines = wrapText(ctx, content, boxW);
  const probe = ctx.measureText('Hg');
  const ascent = probe.fontBoundingBoxAscent;
  const descent = probe.fontBoundingBoxDescent;
  const lineBox = el.lineHeight * el.fontSize;
  // CSS half-leading: the font's content area is centered in each line box.
  const baselineInLine = (lineBox - (ascent + descent)) / 2 + ascent;
  lines.forEach((line, i) => {
    const visible = line.replace(/\s+$/, '');
    // letter-spacing is also applied after the last glyph; Chrome counts it in the line width.
    const lw = ctx.measureText(visible).width;
    const x =
      el.align === 'center'
        ? inset + (boxW - lw) / 2
        : el.align === 'right'
          ? inset + boxW - lw
          : inset;
    ctx.fillText(visible, x, inset + i * lineBox + baselineInLine);
  });
  ctx.restore();
}

// --- shapes, images, QR ---

function drawShape(ctx: SKRSContext2D, el: ElementOf<'shape'>) {
  const w = el.width;
  const h = el.height;
  if (el.shape === 'line') {
    ctx.save();
    ctx.strokeStyle = el.style?.borderColor ?? el.style?.fill ?? '#ffffff';
    ctx.lineWidth = el.style?.borderWidth ?? 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const ellipse = el.shape === 'ellipse';
  drawBoxBackground(ctx, w, h, el.style?.fill, el.style, ellipse);
  if (hasBorder(el.style)) {
    if (ellipse) {
      const bw = el.style!.borderWidth!;
      ctx.save();
      ctx.strokeStyle = el.style!.borderColor!;
      ctx.lineWidth = bw;
      ctx.beginPath();
      ctx.ellipse(
        w / 2,
        h / 2,
        Math.max(0, w / 2 - bw / 2),
        Math.max(0, h / 2 - bw / 2),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.restore();
    } else {
      drawBoxBorder(ctx, w, h, el.style);
    }
  }
}

function drawImage(ctx: SKRSContext2D, el: ElementOf<'image'>, dc: DrawContext) {
  const w = el.width;
  const h = el.height;
  drawBoxBackground(ctx, w, h, el.style?.fill, el.style);
  const img = dc.assets.image(el.assetId);
  if (img) {
    ctx.save();
    clipBox(ctx, w, h, el.style);
    ctx.drawImage(img, 0, 0, w, h);
    ctx.restore();
  }
  drawBoxBorder(ctx, w, h, el.style);
}

function drawDownloadQr(ctx: SKRSContext2D, el: ElementOf<'download-qr'>, dc: DrawContext) {
  const w = el.width;
  const h = el.height;
  // Renderer: `background: el.background` then boxStyle (style.fill overrides).
  drawBoxBackground(ctx, w, h, el.style?.fill ?? el.background, el.style);
  drawBoxBorder(ctx, w, h, el.style);
  if (!dc.downloadUrl) return;
  const inset = (hasBorder(el.style) ? el.style!.borderWidth! : 0) + el.padding;
  const cw = w - inset * 2;
  const ch = h - inset * 2;
  if (cw <= 0 || ch <= 0) return;
  const { size, d } = qrPath(dc.downloadUrl);
  const modules = size + QR_QUIET_ZONE * 2;
  const side = Math.min(cw, ch);
  const ox = inset + (cw - side) / 2;
  const oy = inset + (ch - side) / 2;
  const unit = side / modules;
  ctx.save();
  ctx.fillStyle = el.background;
  ctx.fillRect(ox, oy, side, side);
  ctx.fillStyle = el.foreground;
  // Same modules as the renderer's SVG path; edges snapped to whole px (shape-rendering: crispEdges).
  const edge = (i: number) => Math.round(i * unit);
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
    const x = Number(m[1]) + QR_QUIET_ZONE;
    const y = Number(m[2]) + QR_QUIET_ZONE;
    const run = Number(m[3]);
    const x0 = edge(x);
    const y0 = edge(y);
    ctx.fillRect(ox + x0, oy + y0, edge(x + run) - x0, edge(y + 1) - y0);
  }
  ctx.restore();
}

function drawBody(ctx: SKRSContext2D, el: Element, dc: DrawContext): void {
  switch (el.type) {
    case 'text':
      return drawText(ctx, el, dc);
    case 'shape':
      return drawShape(ctx, el);
    case 'image':
      return drawImage(ctx, el, dc);
    case 'download-qr':
      return drawDownloadQr(ctx, el, dc);
    default:
      // Frames only allow text/image/shape/download-qr (docs/schema.md A.6).
      return;
  }
}

/** Draws one element at its strip position (rotation about its center, group opacity). */
export function drawElement(ctx: SKRSContext2D, el: Element, dc: DrawContext): void {
  if (!el.visible || el.opacity <= 0) return;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  if (el.opacity >= 1) {
    ctx.save();
    ctx.translate(cx, cy);
    if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.translate(-el.width / 2, -el.height / 2);
    drawBody(ctx, el, dc);
    ctx.restore();
    return;
  }
  // CSS opacity composites the element as a group: draw offscreen, then blend once.
  const pad = Math.ceil(
    el.style?.shadow
      ? el.style.shadow.blur * 2 +
          Math.max(Math.abs(el.style.shadow.x), Math.abs(el.style.shadow.y))
      : 0,
  );
  const layer = createCanvas(Math.ceil(el.width) + pad * 2, Math.ceil(el.height) + pad * 2);
  const lctx = layer.getContext('2d');
  lctx.translate(pad, pad);
  drawBody(lctx, el, dc);
  ctx.save();
  ctx.globalAlpha = el.opacity;
  ctx.translate(cx, cy);
  if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.drawImage(layer, -el.width / 2 - pad, -el.height / 2 - pad);
  ctx.restore();
}
