import {
  applyFilterColorMatrix,
  createDefaultBoothConfig,
  filterColorMatrix,
  NEUTRAL_FILTER_PARAMS,
  STRIP_2X6_PROFILE,
  type BoothConfig,
  type Element,
  type FilterParams,
  type Frame,
} from '@pb/schema';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { applyFilter } from './filter';
import { composeSheet, sheetLayout } from './sheet';
import { composeStrip, encodeImage, type RawImage } from './strip';

let n = 0;
const config: BoothConfig = createDefaultBoothConfig({
  boothId: 'booth-test',
  boothName: 'Booth Uji',
  timezone: 'Asia/Jakarta',
  idFactory: () => `id${++n}`,
});

function loadAsset(assetId: string): Promise<Buffer> {
  const asset = config.assets.find((a) => a.id === assetId);
  if (!asset) return Promise.reject(new Error(`asset ${assetId}`));
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(asset.url);
  if (!m) return Promise.reject(new Error('not a data url'));
  return Promise.resolve(
    m[2] ? Buffer.from(m[3]!, 'base64') : Buffer.from(decodeURIComponent(m[3]!), 'utf8'),
  );
}

/** Transparent overlay so slot pixels are visible. */
const CLEAR_OVERLAY = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1800"></svg>',
);

function solid(color: { r: number; g: number; b: number }, width = 400, height = 300) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg({ quality: 100 })
    .toBuffer();
}

function px(img: RawImage, x: number, y: number) {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
}

function baseFrame(patch: Partial<Frame> = {}): Frame {
  return { ...config.frames[0]!, dynamicElements: [], ...patch };
}

const clearLoader = (id: string) =>
  id === 'clear' ? Promise.resolve(CLEAR_OVERLAY) : loadAsset(id);

describe('filter (shared definition with the renderer)', () => {
  it('matches the filter-math reference exactly for every channel value', () => {
    const params: FilterParams = {
      ...NEUTRAL_FILTER_PARAMS,
      brightness: 1.1,
      contrast: 1.25,
      saturation: 0.6,
      hueRotate: 25,
      sepia: 0.3,
      warmth: -0.4,
    };
    const matrix = filterColorMatrix(params);
    const data = new Uint8Array(256 * 3 * 4);
    for (let i = 0; i < 256 * 3; i++) {
      data[i * 4] = i % 256;
      data[i * 4 + 1] = (i * 7) % 256;
      data[i * 4 + 2] = (i * 13) % 256;
      data[i * 4 + 3] = 255;
    }
    const input = Uint8Array.from(data);
    applyFilter(data, 256 * 3, 1, params);
    for (let i = 0; i < 256 * 3; i++) {
      const ref = applyFilterColorMatrix(matrix, [
        input[i * 4]!,
        input[i * 4 + 1]!,
        input[i * 4 + 2]!,
      ]);
      expect([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]).toEqual(ref);
    }
  });

  it('darkens corners with the vignette and leaves the center', () => {
    const w = 100;
    const h = 60;
    const data = new Uint8Array(w * h * 4).fill(200);
    applyFilter(data, w, h, { ...NEUTRAL_FILTER_PARAMS, vignette: 1 });
    const at = (x: number, y: number) => data[(y * w + x) * 4]!;
    expect(at(50, 30)).toBe(200);
    expect(at(0, 0)).toBeLessThan(20);
  });

  it('grain keeps the mean brightness (statistically)', () => {
    const w = 200;
    const h = 200;
    const data = new Uint8Array(w * h * 4).fill(128);
    applyFilter(data, w, h, { ...NEUTRAL_FILTER_PARAMS, grain: 1 }, 42);
    let sum = 0;
    let varSum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i]!;
    const mean = sum / (w * h);
    for (let i = 0; i < data.length; i += 4) varSum += (data[i]! - mean) ** 2;
    expect(Math.abs(mean - 128)).toBeLessThan(2);
    expect(Math.sqrt(varSum / (w * h))).toBeGreaterThan(5);
  });
});

describe('composeStrip', () => {
  it('puts each photo center-cropped into its slot (positions in strip px)', async () => {
    const frame = baseFrame({ overlayAssetId: 'clear' });
    const colors = [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 },
      { r: 255, g: 255, b: 0 },
    ];
    const photos = Object.fromEntries(
      await Promise.all(frame.slots.map(async (s, i) => [s.index, await solid(colors[i]!)])),
    );
    const strip = await composeStrip({
      config,
      frame,
      photos,
      filter: null,
      mirror: false,
      downloadUrl: null,
      now: new Date('2026-11-24T05:00:00Z'),
      loadAsset: clearLoader,
    });
    expect([strip.width, strip.height]).toEqual([600, 1800]);
    frame.slots.forEach((slot, i) => {
      const c = colors[i]!;
      const inside = px(strip, slot.x + slot.width / 2, slot.y + slot.height / 2);
      inside.forEach((v, k) => expect(Math.abs(v - [c.r, c.g, c.b][k]!)).toBeLessThan(6));
      // Just outside the slot: white paper.
      expect(px(strip, slot.x + slot.width / 2, slot.y - 3)).toEqual([255, 255, 255]);
    });
  });

  it('crops the center of a wide photo and mirrors when asked', async () => {
    const slot = {
      index: 1,
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      rotation: 0,
      borderRadius: 0,
    };
    const frame = baseFrame({ overlayAssetId: 'clear', slots: [slot] });
    // 400×200: left half red, right half blue. Square crop keeps the middle 200 px.
    const photo = await sharp({
      create: { width: 400, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .composite([
        {
          input: {
            create: { width: 200, height: 200, channels: 3, background: { r: 0, g: 0, b: 255 } },
          },
          left: 200,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const run = (mirror: boolean) =>
      composeStrip({
        config,
        frame,
        photos: { 1: photo },
        filter: null,
        mirror,
        downloadUrl: null,
        now: new Date(),
        loadAsset: clearLoader,
      });
    const plain = await run(false);
    expect(px(plain, 120, 200)).toEqual([255, 0, 0]);
    expect(px(plain, 280, 200)).toEqual([0, 0, 255]);
    const mirrored = await run(true);
    expect(px(mirrored, 120, 200)).toEqual([0, 0, 255]);
    expect(px(mirrored, 280, 200)).toEqual([255, 0, 0]);
  });

  it('rounds slot corners and rotates slots about their center', async () => {
    const slot = {
      index: 1,
      x: 100,
      y: 300,
      width: 300,
      height: 200,
      rotation: 90,
      borderRadius: 40,
    };
    const frame = baseFrame({ overlayAssetId: 'clear', slots: [slot] });
    const strip = await composeStrip({
      config,
      frame,
      photos: { 1: await solid({ r: 0, g: 0, b: 0 }) },
      filter: null,
      mirror: false,
      downloadUrl: null,
      now: new Date(),
      loadAsset: clearLoader,
    });
    // Rotated 90°: occupies x 150..350, y 250..550 around center (250, 400).
    expect(px(strip, 250, 260)).toEqual([0, 0, 0]);
    expect(px(strip, 120, 400)).toEqual([255, 255, 255]);
    // Rounded corner of the rotated box stays white.
    expect(px(strip, 152, 252)).toEqual([255, 255, 255]);
  });

  it('applies the selected filter to photos (same numbers as the screen)', async () => {
    const frame = baseFrame({ overlayAssetId: 'clear' });
    const slot = frame.slots[0]!;
    const filter = { ...NEUTRAL_FILTER_PARAMS, saturation: 0 };
    const strip = await composeStrip({
      config,
      frame,
      photos: { [slot.index]: await solid({ r: 200, g: 40, b: 40 }) },
      filter,
      mirror: false,
      downloadUrl: null,
      now: new Date(),
      loadAsset: clearLoader,
    });
    const got = px(strip, slot.x + slot.width / 2, slot.y + slot.height / 2);
    const ref = applyFilterColorMatrix(filterColorMatrix(filter), [200, 40, 40]);
    got.forEach((v, k) => expect(Math.abs(v - ref[k]!)).toBeLessThanOrEqual(3));
  });

  it('draws the overlay, the {{date}} text inside its box and a scannable download QR', async () => {
    const frame = config.frames[0]!;
    const qr: Element = {
      id: 'qr1',
      name: 'QR',
      type: 'download-qr',
      x: 400,
      y: 1580,
      width: 170,
      height: 170,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      padding: 8,
      foreground: '#000000',
      background: '#ffffff',
    };
    const url = 'https://pb.example/s/ABCD2345';
    const strip = await composeStrip({
      config,
      frame: { ...frame, dynamicElements: [...frame.dynamicElements, qr] },
      photos: {},
      filter: null,
      mirror: false,
      downloadUrl: url,
      now: new Date('2026-11-24T20:00:00Z'), // 25 Nov in Asia/Jakarta
      loadAsset,
    });
    // Date text element (y 1670..1730, x 30..570): has ink; area right below it is untouched.
    const dateEl = frame.dynamicElements[1]!;
    let ink = 0;
    for (let y = dateEl.y; y < dateEl.y + dateEl.height; y++) {
      for (let x = dateEl.x; x < 380; x++) if (px(strip, x, y)[0]! < 128) ink++;
    }
    expect(ink).toBeGreaterThan(200);

    // QR decodes to the short link.
    const crop = await sharp(strip.data, { raw: { width: 600, height: 1800, channels: 4 } })
      .extract({ left: 390, top: 1570, width: 190, height: 190 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const decoded = jsQR(new Uint8ClampedArray(crop.data), crop.info.width, crop.info.height);
    expect(decoded?.data).toBe(url);
  });
});

describe('print sheet', () => {
  it('lays two identical strips side by side on 4×6 @300dpi with cut marks', async () => {
    const frame = baseFrame({ overlayAssetId: 'clear' });
    const strip = await composeStrip({
      config,
      frame,
      photos: { 1: await solid({ r: 255, g: 0, b: 0 }) },
      filter: null,
      mirror: false,
      downloadUrl: null,
      now: new Date(),
      loadAsset: clearLoader,
    });
    const sheet = await composeSheet(strip, STRIP_2X6_PROFILE, 'png');
    const meta = await sharp(sheet).metadata();
    expect([meta.width, meta.height, meta.density]).toEqual([1200, 1800, 300]);
    const raw = await sharp(sheet).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const img: RawImage = { data: raw.data, width: 1200, height: 1800, channels: 4 };
    const s = frame.slots[0]!;
    const cx = s.x + s.width / 2;
    const cy = s.y + s.height / 2;
    expect(px(img, cx, cy)).toEqual(px(img, cx + 600, cy));
    expect(px(img, cx, cy)[0]).toBeGreaterThan(240);
    // Cut mark at the top of the center line.
    expect(px(img, 600, 10)[0]).toBeLessThan(200);
  });

  it('adds bleed around the sheet', () => {
    expect(sheetLayout({ ...STRIP_2X6_PROFILE, bleedPx: 12 })).toEqual({
      width: 1224,
      height: 1824,
      strips: [
        { x: 12, y: 12 },
        { x: 612, y: 12 },
      ],
    });
  });
});

describe('performance', () => {
  it('composes 4 full-resolution (12 MP) tablet photos into a strip + sheet quickly', async () => {
    const big = await sharp({
      create: { width: 4032, height: 3024, channels: 3, background: { r: 120, g: 90, b: 60 } },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="4032" height="3024"><circle cx="2016" cy="1512" r="900" fill="#e11d48"/></svg>',
          ),
        },
      ])
      .jpeg({ quality: 92 })
      .toBuffer();
    const frame = config.frames[0]!;
    const filter = config.filters[2]!.params;
    const t0 = performance.now();
    const strip = await composeStrip({
      config,
      frame,
      photos: Object.fromEntries(frame.slots.map((s) => [s.index, big])),
      filter: { ...filter, vignette: 0.4, grain: 0.3 },
      mirror: true,
      downloadUrl: 'https://pb.example/s/ABCD2345',
      now: new Date(),
      loadAsset,
    });
    const [jpeg, sheet] = await Promise.all([
      encodeImage(strip, 'jpeg'),
      composeSheet(strip, config.printProfile),
    ]);
    const ms = performance.now() - t0;
    console.log(`[compositor] 4×12MP → strip + sheet in ${Math.round(ms)} ms`);
    expect(jpeg.length).toBeGreaterThan(10_000);
    expect(sheet.length).toBeGreaterThan(10_000);
    expect(ms).toBeLessThan(8000);
  }, 30_000);
});

describe('font families', () => {
  it('maps CSS generic families to the fonts Chromium uses on each OS', async () => {
    const { resolveFontFamily } = await import('./draw');
    expect(resolveFontFamily('Inter, system-ui, sans-serif', 'win32')).toBe(
      'Inter, "Segoe UI", Arial',
    );
    expect(resolveFontFamily('"pb-font-abc", sans-serif', 'darwin')).toBe(
      '"pb-font-abc", Helvetica',
    );
    expect(resolveFontFamily('Poppins', 'linux')).toBe('Poppins');
  });
});
