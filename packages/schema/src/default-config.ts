import { createId } from '@paralleldrive/cuid2';
import { CURRENT_SCHEMA_VERSION, type BoothConfig } from './booth-config';
import type { BoxStyle, TextStyle } from './common';
import {
  DEFAULT_STRIP_OVERLAY_ASSET_ID,
  DEFAULT_STRIP_SLOTS,
  defaultStripOverlayAsset,
} from './default-assets';
import type { BaseElement, ButtonAction, Element, ElementOf, ElementType } from './elements';
import { NEUTRAL_FILTER_PARAMS, type Filter } from './filter';
import { STRIP_2X6_PROFILE, type Frame } from './frame';
import type { Page, PageType } from './page';

export type CreateDefaultBoothConfigOptions = {
  boothId: string;
  boothName?: string;
  timezone?: string;
  /** Override for deterministic ids in tests. */
  idFactory?: () => string;
};

const FONT = 'Inter, system-ui, sans-serif';
const C = {
  bg: '#0f172a',
  panel: '#1e293b',
  accent: '#ec4899',
  text: '#ffffff',
  muted: '#cbd5e1',
  dark: '#0f172a',
};

/** Simple, complete, valid config: landscape 1920×1080, 1 frame with 4 slots, 3 filters. */
export function createDefaultBoothConfig(opts: CreateDefaultBoothConfigOptions): BoothConfig {
  const id = opts.idFactory ?? createId;
  const boothName = opts.boothName ?? 'Photobooth';

  type Geo = Pick<BaseElement, 'x' | 'y' | 'width' | 'height'>;
  const base = (name: string, g: Geo): BaseElement => ({
    id: id(),
    name,
    ...g,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  });
  const make = <T extends ElementType>(
    type: T,
    name: string,
    g: Geo,
    props: Omit<ElementOf<T>, keyof BaseElement | 'type'> & Partial<BaseElement>,
  ): Element => ({ ...base(name, g), type, ...props }) as unknown as Element;

  const textStyle = (fontSize: number, extra: Partial<TextStyle> = {}): TextStyle => ({
    fontFamily: FONT,
    fontSize,
    fontWeight: 400,
    color: C.text,
    align: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    ...extra,
  });
  const text = (content: string, g: Geo, fontSize: number, extra: Partial<TextStyle> = {}) =>
    make('text', content.slice(0, 40), g, { content, ...textStyle(fontSize, extra) });

  const primary: BoxStyle = { fill: C.accent, borderRadius: 999 };
  const secondary: BoxStyle = {
    fill: 'transparent',
    borderColor: C.muted,
    borderWidth: 3,
    borderRadius: 999,
  };
  const button = (label: string, action: ButtonAction, g: Geo, style: BoxStyle = primary) =>
    make('button', `Tombol ${label}`, g, {
      action,
      label,
      textStyle: textStyle(40, { fontWeight: 700 }),
      style,
      pressedStyle: {
        ...style,
        fill: style.fill === 'transparent' ? 'rgba(255,255,255,0.1)' : '#be185d',
      },
    });
  const title = (content: string) =>
    text(content, { x: 160, y: 60, width: 1600, height: 120 }, 72, { fontWeight: 700 });

  const solid = { kind: 'color', color: C.bg } as const;
  const page = (type: PageType, elements: Element[], extra: Partial<Page> = {}): Page => ({
    type,
    background: solid,
    elements,
    transitionIn: { kind: 'fade', durationMs: 250 },
    ...extra,
  });

  const filters: Filter[] = [
    {
      id: id(),
      name: 'Normal',
      params: { ...NEUTRAL_FILTER_PARAMS },
      enabled: true,
      isDefault: true,
    },
    {
      id: id(),
      name: 'Hitam Putih',
      params: { ...NEUTRAL_FILTER_PARAMS, saturation: 0, contrast: 1.1 },
      enabled: true,
      isDefault: false,
    },
    {
      id: id(),
      name: 'Hangat',
      params: { ...NEUTRAL_FILTER_PARAMS, warmth: 0.3, saturation: 1.1, brightness: 1.05 },
      enabled: true,
      isDefault: false,
    },
  ];

  const stripText = (content: string, y: number, h: number, size: number, weight = 400) =>
    make(
      'text',
      content,
      { x: 30, y, width: 540, height: h },
      {
        content,
        ...textStyle(size, { color: C.dark, fontWeight: weight }),
      },
    );
  const frames: Frame[] = [
    {
      id: id(),
      name: 'Klasik Putih',
      thumbnailAssetId: DEFAULT_STRIP_OVERLAY_ASSET_ID,
      overlayAssetId: DEFAULT_STRIP_OVERLAY_ASSET_ID,
      slots: DEFAULT_STRIP_SLOTS.map((s) => ({ ...s })),
      dynamicElements: [
        stripText('{{boothName}}', 1580, 80, 48, 700),
        stripText('{{date}}', 1670, 60, 32),
      ],
      enabled: true,
      sortOrder: 0,
    },
  ];

  const photoSlot = (slotIndex: number, y: number) =>
    make(
      'photo-slot',
      `Slot ${slotIndex}`,
      { x: 1500, y, width: 330, height: 220 },
      {
        slotIndex,
        emptyStyle: {
          fill: C.panel,
          borderRadius: 16,
          showNumber: true,
          numberColor: C.muted,
          numberFontFamily: FONT,
          numberFontSize: 72,
        },
        filledStyle: { borderRadius: 16 },
        activeStyle: { borderColor: C.accent, borderWidth: 6, borderRadius: 16 },
        showRetakeButton: true,
      },
    );

  const pages: Record<PageType, Page> = {
    cover: page(
      'cover',
      [
        text(boothName, { x: 160, y: 300, width: 1600, height: 160 }, 120, { fontWeight: 800 }),
        text('Sentuh untuk mulai', { x: 560, y: 520, width: 800, height: 80 }, 48, {
          color: C.muted,
        }),
        {
          ...button('Mulai', { kind: 'start' }, { x: 760, y: 700, width: 400, height: 120 }),
          animation: { loop: 'pulse' },
        },
        text(
          'Dengan melanjutkan, Anda setuju foto disimpan dan diunggah agar dapat diunduh.',
          { x: 360, y: 990, width: 1200, height: 40 },
          22,
          { color: C.muted },
        ),
      ],
      {
        background: { kind: 'gradient', css: 'linear-gradient(135deg, #1e1b4b 0%, #831843 100%)' },
      },
    ),
    tutorial: page(
      'tutorial',
      [button('Lanjut', { kind: 'next' }, { x: 1460, y: 900, width: 360, height: 110 })],
      {
        slides: [
          {
            id: id(),
            durationSec: 5,
            elements: [
              text('Cara pakai', { x: 160, y: 200, width: 1600, height: 120 }, 80, {
                fontWeight: 700,
              }),
              text(
                '1. Pilih frame  ·  2. Bayar  ·  3. Berpose 4 kali  ·  4. Ambil cetakan',
                { x: 160, y: 420, width: 1600, height: 120 },
                48,
              ),
            ],
          },
        ],
      },
    ),
    framePick: page('framePick', [
      title('Pilih Frame'),
      make(
        'frame-picker',
        'Daftar frame',
        { x: 160, y: 200, width: 1600, height: 620 },
        {
          layout: 'grid',
          columns: 4,
          gap: 32,
          itemStyle: { fill: C.panel, borderRadius: 16 },
          selectedStyle: { borderColor: C.accent, borderWidth: 6, borderRadius: 16 },
          showPrice: true,
          showName: true,
          labelStyle: textStyle(28),
        },
      ),
      button('Kembali', { kind: 'back' }, { x: 160, y: 880, width: 320, height: 110 }, secondary),
      make(
        'price-label',
        'Harga',
        { x: 760, y: 890, width: 400, height: 90 },
        { format: 'idr', ...textStyle(56, { fontWeight: 700 }) },
      ),
      button('Lanjut', { kind: 'next' }, { x: 1440, y: 880, width: 320, height: 110 }),
    ]),
    payment: page('payment', [
      title('Pembayaran'),
      make(
        'qris',
        'QRIS',
        { x: 260, y: 220, width: 560, height: 560 },
        { padding: 24, background: '#ffffff', showLogo: true },
      ),
      make(
        'payment-timer',
        'Sisa waktu',
        { x: 260, y: 800, width: 560, height: 60 },
        { variant: 'text', textStyle: textStyle(36, { color: C.muted }) },
      ),
      make(
        'price-label',
        'Total',
        { x: 960, y: 220, width: 700, height: 100 },
        { format: 'idr', ...textStyle(72, { fontWeight: 800, align: 'left' }) },
      ),
      text(
        'Scan QRIS dengan e-wallet atau m-banking, atau masukkan kode voucher.',
        { x: 960, y: 340, width: 700, height: 120 },
        34,
        { align: 'left', color: C.muted },
      ),
      make(
        'voucher-input',
        'Voucher',
        { x: 960, y: 480, width: 700, height: 280 },
        {
          variant: 'field',
          textStyle: textStyle(40, { color: C.dark }),
          keyStyle: { fill: '#ffffff', borderRadius: 16 },
        },
      ),
      button(
        'QRIS',
        { kind: 'selectPayment', method: 'qris' },
        { x: 960, y: 800, width: 220, height: 90 },
        secondary,
      ),
      button(
        'Voucher',
        { kind: 'selectPayment', method: 'voucher' },
        { x: 1200, y: 800, width: 220, height: 90 },
        secondary,
      ),
      button(
        'Tunai',
        { kind: 'selectPayment', method: 'cash' },
        { x: 1440, y: 800, width: 220, height: 90 },
        secondary,
      ),
      button('Kembali', { kind: 'back' }, { x: 160, y: 940, width: 320, height: 100 }, secondary),
    ]),
    capture: page('capture', [
      make(
        'camera-view',
        'Kamera',
        { x: 80, y: 80, width: 1280, height: 720 },
        {
          mirror: true,
          fit: 'cover',
          cropAspect: true,
          overlayFrame: false,
          style: { borderRadius: 24 },
        },
      ),
      make(
        'countdown',
        'Hitung mundur',
        { x: 520, y: 240, width: 400, height: 400 },
        {
          fontFamily: FONT,
          fontSize: 280,
          color: C.text,
          variant: 'number',
        },
      ),
      ...DEFAULT_STRIP_SLOTS.map((_, i) => photoSlot(i + 1, 80 + i * 240)),
      button(
        'Ulang semua',
        { kind: 'retakeAll' },
        { x: 80, y: 860, width: 400, height: 120 },
        secondary,
      ),
      button('Selesai', { kind: 'next' }, { x: 960, y: 860, width: 400, height: 120 }),
    ]),
    review: page('review', [
      title('Pilih Filter'),
      make(
        'frame-preview',
        'Pratinjau',
        { x: 160, y: 200, width: 260, height: 780 },
        { fit: 'contain' },
      ),
      make(
        'filter-picker',
        'Filter',
        { x: 560, y: 220, width: 1200, height: 300 },
        {
          layout: 'row',
          itemSize: 220,
          showLabel: true,
          selectedStyle: { borderColor: C.accent, borderWidth: 6, borderRadius: 16 },
          labelStyle: textStyle(28),
        },
      ),
      text('Cetak tambahan', { x: 560, y: 580, width: 500, height: 60 }, 36, { align: 'left' }),
      make(
        'print-copies',
        'Jumlah cetak',
        { x: 560, y: 650, width: 500, height: 110 },
        {
          textStyle: textStyle(48, { fontWeight: 700 }),
          buttonStyle: { fill: C.panel, borderRadius: 999 },
        },
      ),
      make(
        'price-label',
        'Total',
        { x: 1160, y: 660, width: 600, height: 90 },
        { format: 'idr', ...textStyle(56, { fontWeight: 700, align: 'right' }) },
      ),
      button('Cetak', { kind: 'confirm' }, { x: 1360, y: 880, width: 400, height: 110 }),
    ]),
    processing: page('processing', [
      text('Sedang mencetak...', { x: 360, y: 380, width: 1200, height: 120 }, 72, {
        fontWeight: 700,
      }),
      make(
        'progress',
        'Progres',
        { x: 560, y: 560, width: 800, height: 24 },
        { variant: 'bar', color: C.accent, trackColor: C.panel },
      ),
    ]),
    result: page('result', [
      text('Terima kasih!', { x: 160, y: 120, width: 1600, height: 140 }, 96, { fontWeight: 800 }),
      make(
        'download-qr',
        'QR unduh',
        { x: 760, y: 320, width: 400, height: 400 },
        { padding: 24, foreground: '#000000', background: '#ffffff' },
      ),
      text(
        'Scan untuk mengunduh foto, GIF, dan video',
        { x: 360, y: 760, width: 1200, height: 80 },
        40,
        { color: C.muted },
      ),
      button('Selesai', { kind: 'finish' }, { x: 760, y: 900, width: 400, height: 110 }),
    ]),
    error: page('error', [
      text('Ups, ada kendala', { x: 360, y: 340, width: 1200, height: 140 }, 88, {
        fontWeight: 800,
      }),
      text('Silakan hubungi petugas booth.', { x: 360, y: 500, width: 1200, height: 80 }, 44, {
        color: C.muted,
      }),
      button('Kembali ke awal', { kind: 'start' }, { x: 710, y: 700, width: 500, height: 120 }),
    ]),
  };

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    configVersion: 0,
    boothId: opts.boothId,
    locale: 'id',
    timezone: opts.timezone ?? 'Asia/Jakarta',
    artboard: {
      width: 1920,
      height: 1080,
      orientation: 'landscape',
      scaleMode: 'fit',
      letterboxColor: '#000000',
    },
    flow: {
      tutorialEnabled: true,
      reviewEnabled: true,
      eventMode: false,
      paymentMethods: ['qris', 'voucher', 'cash'],
      shotCountdownSec: 3,
      autoAdvanceBetweenShots: true,
      maxRetakesPerShot: null,
      idleTimeoutSec: {
        tutorial: 60,
        framePick: 90,
        payment: 360,
        capture: 120,
        review: 120,
        error: 30,
      },
      resultAutoReturnSec: 60,
      qrisExpirySec: 300,
    },
    pricing: {
      currency: 'IDR',
      basePrice: 35000,
      includedPrints: 1,
      extraPrintPrice: 15000,
      maxExtraPrints: 4,
    },
    pages,
    frames,
    filters,
    printProfile: { ...STRIP_2X6_PROFILE },
    output: {
      gif: { enabled: true, frameDelayMs: 500, width: 600 },
      video: {
        enabled: true,
        photoPick: 'random',
        photoCount: 3,
        secondsPerPhoto: 2,
        resolution: { width: 1080, height: 1920 },
      },
      driveRootFolderName: boothName,
      watermark: true,
    },
    assets: [defaultStripOverlayAsset()],
    admin: { pinHash: '' },
  };
}
