import type { z } from 'zod';
import { BoothConfigSchema, type AssetRef, type BoothConfig } from './booth-config';
import type { ButtonActionKind, Element, ElementType } from './elements';
import { STATIC_ELEMENT_TYPES } from './elements';
import { PAGE_TYPES, type Background, type Page, type PageType } from './page';

export type ValidationIssue = {
  /** Stable machine code, e.g. `capture.camera-view.count`. */
  code: string;
  /** Dotted path into the config, e.g. `pages.capture.elements`. */
  path: string;
  /** Human-readable message (Indonesian, shown in Studio). */
  message: string;
};

export type ValidationResult =
  | { success: true; config: BoothConfig; issues: [] }
  | { success: false; issues: ValidationIssue[] };

/** Pages each flow-bound element may be placed on. Static elements + button may go anywhere. */
export const ELEMENT_ALLOWED_PAGES: Partial<Record<ElementType, readonly PageType[]>> = {
  'camera-view': ['capture'],
  'photo-slot': ['capture', 'review'],
  countdown: ['capture'],
  'frame-picker': ['framePick'],
  'frame-preview': ['framePick', 'review'],
  'filter-picker': ['review'],
  qris: ['payment'],
  'price-label': ['framePick', 'payment', 'review'],
  'payment-timer': ['payment'],
  'voucher-input': ['payment'],
  'download-qr': ['result'],
  progress: ['processing'],
  'print-copies': ['review'],
};

const FRAME_DYNAMIC_TYPES: readonly ElementType[] = ['text', 'image', 'shape', 'download-qr'];

const EXIT_ACTIONS: Partial<Record<PageType, readonly ButtonActionKind[]>> = {
  cover: ['start', 'next'],
  tutorial: ['next', 'start', 'confirm'],
  framePick: ['next', 'confirm'],
  payment: ['back', 'confirm', 'selectPayment'],
  capture: ['next', 'confirm'],
  review: ['confirm', 'next', 'finish'],
  error: ['start', 'finish', 'back', 'next'],
};

const PAGE_LABEL: Record<PageType, string> = {
  cover: 'Cover',
  tutorial: 'Tutorial',
  framePick: 'Pilih Frame',
  payment: 'Payment',
  capture: 'Capture',
  review: 'Review',
  processing: 'Processing',
  result: 'Result',
  error: 'Error',
};

export function validateBoothConfig(input: unknown): ValidationResult {
  const parsed = BoothConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, issues: parsed.error.issues.map(fromZodIssue) };
  }
  const issues = checkSemantics(parsed.data);
  if (issues.length > 0) return { success: false, issues };
  return { success: true, config: parsed.data, issues: [] };
}

/** Throws with all issue messages joined; for code paths where an invalid config is a bug. */
export function assertValidBoothConfig(input: unknown): BoothConfig {
  const result = validateBoothConfig(input);
  if (!result.success) {
    const detail = result.issues.map((i) => `- ${i.path}: ${i.message}`).join('\n');
    throw new Error(`Config booth tidak valid:\n${detail}`);
  }
  return result.config;
}

function fromZodIssue(issue: z.core.$ZodIssue): ValidationIssue {
  return {
    code: `schema.${issue.code}`,
    path: issue.path.map(String).join('.'),
    message: issue.message,
  };
}

function checkSemantics(config: BoothConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });

  const assets = new Map<string, AssetRef>();
  config.assets.forEach((asset, i) => {
    if (assets.has(asset.id)) {
      add(
        'asset.duplicate-id',
        `assets.${i}.id`,
        `ID aset "${asset.id}" dipakai lebih dari sekali.`,
      );
    }
    assets.set(asset.id, asset);
  });
  const checkAsset = (
    assetId: string | undefined,
    kinds: readonly AssetRef['kind'][],
    path: string,
  ) => {
    if (assetId === undefined) return;
    const asset = assets.get(assetId);
    if (!asset) {
      add('asset.missing', path, `Aset "${assetId}" tidak ada di daftar assets.`);
    } else if (!kinds.includes(asset.kind)) {
      add(
        'asset.wrong-kind',
        path,
        `Aset "${assetId}" bertipe ${asset.kind}, seharusnya ${kinds.join(' atau ')}.`,
      );
    }
  };
  const checkBackground = (bg: Background | undefined, path: string) => {
    if (bg?.kind === 'image') checkAsset(bg.assetId, ['image'], `${path}.assetId`);
    if (bg?.kind === 'video') checkAsset(bg.assetId, ['video'], `${path}.assetId`);
  };
  const checkElementAssets = (el: Element, path: string) => {
    if (el.type === 'image') checkAsset(el.assetId, ['image'], `${path}.assetId`);
    if (el.type === 'video') checkAsset(el.assetId, ['video'], `${path}.assetId`);
    if (el.type === 'button') checkAsset(el.assetId, ['image'], `${path}.assetId`);
  };

  // --- Filters ---
  const filterIds = new Set<string>();
  config.filters.forEach((f, i) => {
    if (filterIds.has(f.id)) {
      add(
        'filter.duplicate-id',
        `filters.${i}.id`,
        `ID filter "${f.id}" dipakai lebih dari sekali.`,
      );
    }
    filterIds.add(f.id);
    checkAsset(f.thumbnailAssetId, ['image'], `filters.${i}.thumbnailAssetId`);
  });
  const enabledFilters = config.filters.filter((f) => f.enabled);
  if (enabledFilters.length === 0) {
    add('filter.none-enabled', 'filters', 'Minimal satu filter harus aktif.');
  }
  const defaults = config.filters.filter((f) => f.isDefault);
  if (defaults.length !== 1) {
    add(
      'filter.default-count',
      'filters',
      `Harus ada tepat satu filter default (ditemukan ${defaults.length}).`,
    );
  } else if (!defaults[0]!.enabled) {
    add('filter.default-disabled', 'filters', 'Filter default harus dalam keadaan aktif.');
  }

  // --- Frames ---
  const { width: stripW, height: stripH } = config.printProfile.stripPx;
  const frameIds = new Set<string>();
  config.frames.forEach((frame, fi) => {
    const base = `frames.${fi}`;
    if (frameIds.has(frame.id)) {
      add('frame.duplicate-id', `${base}.id`, `ID frame "${frame.id}" dipakai lebih dari sekali.`);
    }
    frameIds.add(frame.id);
    checkAsset(frame.thumbnailAssetId, ['image'], `${base}.thumbnailAssetId`);
    checkAsset(frame.overlayAssetId, ['image'], `${base}.overlayAssetId`);
    checkAsset(frame.underlayAssetId, ['image'], `${base}.underlayAssetId`);

    const indices = frame.slots.map((s) => s.index).sort((a, b) => a - b);
    const contiguous = indices.every((idx, i) => idx === i + 1);
    if (!contiguous) {
      add(
        'frame.slot-index',
        `${base}.slots`,
        `Slot frame "${frame.name}" harus bernomor urut 1..${frame.slots.length} tanpa duplikat.`,
      );
    }
    frame.slots.forEach((slot, si) => {
      if (
        slot.x < 0 ||
        slot.y < 0 ||
        slot.x + slot.width > stripW ||
        slot.y + slot.height > stripH
      ) {
        add(
          'frame.slot-out-of-bounds',
          `${base}.slots.${si}`,
          `Slot ${slot.index} frame "${frame.name}" keluar dari area strip ${stripW}×${stripH}px.`,
        );
      }
    });
    frame.dynamicElements.forEach((el, ei) => {
      const path = `${base}.dynamicElements.${ei}`;
      if (!FRAME_DYNAMIC_TYPES.includes(el.type)) {
        add(
          'frame.dynamic-type',
          path,
          `Elemen "${el.type}" tidak boleh dipakai di frame (hanya ${FRAME_DYNAMIC_TYPES.join(', ')}).`,
        );
      }
      checkElementAssets(el, path);
    });
  });
  const enabledFrames = config.frames.filter((f) => f.enabled);
  if (enabledFrames.length === 0) {
    add('frame.none-enabled', 'frames', 'Minimal satu frame harus aktif.');
  }
  const maxSlots = Math.max(0, ...enabledFrames.map((f) => f.slots.length));

  // --- Flow ---
  const { flow } = config;
  const methods = new Set(flow.paymentMethods);
  if (methods.size !== flow.paymentMethods.length) {
    add(
      'flow.payment-methods-duplicate',
      'flow.paymentMethods',
      'Metode pembayaran tidak boleh ganda.',
    );
  }
  if (!flow.eventMode && methods.size === 0) {
    add(
      'flow.payment-methods-empty',
      'flow.paymentMethods',
      'Pilih minimal satu metode pembayaran, atau aktifkan mode event (gratis).',
    );
  }
  checkAsset(
    config.output.video.backgroundAssetId,
    ['image', 'video'],
    'output.video.backgroundAssetId',
  );
  checkAsset(config.output.video.musicAssetId, ['audio'], 'output.video.musicAssetId');

  const pageActive: Record<PageType, boolean> = {
    cover: true,
    tutorial: flow.tutorialEnabled,
    framePick: true,
    payment: !flow.eventMode,
    capture: true,
    review: flow.reviewEnabled,
    processing: true,
    result: true,
    error: true,
  };

  // --- Pages ---
  for (const type of PAGE_TYPES) {
    const page: Page = config.pages[type];
    const base = `pages.${type}`;
    const label = PAGE_LABEL[type];

    if (page.type !== type) {
      add(
        'page.type-mismatch',
        `${base}.type`,
        `Halaman di kunci "${type}" bertipe "${page.type}".`,
      );
    }
    checkBackground(page.background, `${base}.background`);

    const ids = new Set<string>();
    const checkId = (id: string, path: string) => {
      if (ids.has(id))
        add(
          'element.duplicate-id',
          path,
          `ID elemen "${id}" dipakai lebih dari sekali di halaman ${label}.`,
        );
      ids.add(id);
    };

    page.elements.forEach((el, ei) => {
      const path = `${base}.elements.${ei}`;
      checkId(el.id, `${path}.id`);
      checkElementAssets(el, path);
      const allowed = ELEMENT_ALLOWED_PAGES[el.type];
      if (allowed && !allowed.includes(type)) {
        add(
          'element.wrong-page',
          path,
          `Elemen "${el.type}" tidak boleh ada di halaman ${label} (hanya di ${allowed.map((p) => PAGE_LABEL[p]).join(', ')}).`,
        );
      }
      if (
        el.type === 'button' &&
        el.action.kind === 'selectFilter' &&
        !filterIds.has(el.action.filterId)
      ) {
        add(
          'button.unknown-filter',
          `${path}.action.filterId`,
          `Tombol "${el.name}" memilih filter yang tidak ada.`,
        );
      }
      if (
        el.type === 'button' &&
        el.action.kind === 'selectPayment' &&
        !methods.has(el.action.method)
      ) {
        add(
          'button.payment-method-disabled',
          `${path}.action.method`,
          `Tombol "${el.name}" memilih metode ${el.action.method} yang tidak aktif.`,
        );
      }
      if (
        el.type === 'button' &&
        el.action.kind === 'retake' &&
        el.action.shotIndex !== undefined &&
        el.action.shotIndex > maxSlots
      ) {
        add(
          'button.retake-index',
          `${path}.action.shotIndex`,
          `Tombol "${el.name}" mengulang foto ke-${el.action.shotIndex}, padahal frame hanya punya ${maxSlots} slot.`,
        );
      }
      if (el.type === 'photo-slot' && el.slotIndex > maxSlots) {
        add(
          'photo-slot.index',
          `${path}.slotIndex`,
          `Slot foto ${el.slotIndex} melebihi jumlah slot frame (${maxSlots}).`,
        );
      }
    });

    if (page.slides && type !== 'tutorial') {
      add('page.slides-not-allowed', `${base}.slides`, `Slide hanya boleh di halaman Tutorial.`);
    }
    page.slides?.forEach((slide, si) => {
      const sbase = `${base}.slides.${si}`;
      checkBackground(slide.background, `${sbase}.background`);
      slide.elements.forEach((el, ei) => {
        const path = `${sbase}.elements.${ei}`;
        checkId(el.id, `${path}.id`);
        checkElementAssets(el, path);
        if (!(STATIC_ELEMENT_TYPES as readonly string[]).includes(el.type)) {
          add(
            'slide.element-type',
            path,
            `Slide hanya boleh berisi elemen statis (image, text, shape, video), bukan "${el.type}".`,
          );
        }
      });
    });

    if (!pageActive[type]) continue;

    const count = (t: ElementType) => page.elements.filter((e) => e.type === t).length;
    const requireExactlyOne = (t: ElementType, reason = '') => {
      const n = count(t);
      if (n !== 1) {
        add(
          `${type}.${t}.count`,
          `${base}.elements`,
          `Halaman ${label} harus punya tepat satu elemen ${t}${reason} (ditemukan ${n}).`,
        );
      }
    };

    switch (type) {
      case 'capture': {
        requireExactlyOne('camera-view');
        requireExactlyOne('countdown');
        const slots = page.elements.filter((e) => e.type === 'photo-slot');
        if (slots.length !== maxSlots) {
          add(
            'capture.photo-slot.count',
            `${base}.elements`,
            `Halaman ${label} harus punya ${maxSlots} elemen photo-slot sesuai slot terbanyak di frame aktif (ditemukan ${slots.length}).`,
          );
        } else {
          const covered = new Set(slots.map((s) => s.slotIndex));
          if (covered.size !== maxSlots) {
            add(
              'capture.photo-slot.indices',
              `${base}.elements`,
              `Elemen photo-slot di halaman ${label} harus memakai slotIndex 1..${maxSlots} masing-masing satu kali.`,
            );
          }
        }
        break;
      }
      case 'payment':
        if (methods.has('qris')) requireExactlyOne('qris', ' karena QRIS aktif');
        if (methods.has('voucher')) requireExactlyOne('voucher-input', ' karena voucher aktif');
        break;
      case 'framePick':
        requireExactlyOne('frame-picker');
        break;
      case 'review':
        if (enabledFilters.length > 1)
          requireExactlyOne('filter-picker', ' karena ada lebih dari satu filter aktif');
        break;
      case 'result':
        requireExactlyOne('download-qr');
        break;
    }

    const exits = EXIT_ACTIONS[type];
    if (exits && !hasExit(config, page, type, exits)) {
      add(
        `${type}.no-exit`,
        `${base}.elements`,
        `Halaman ${label} tidak punya jalan keluar: tambahkan tombol (${exits.join('/')})${autoAdvanceHint(type)}.`,
      );
    }
  }

  return issues;
}

function hasExit(
  config: BoothConfig,
  page: Page,
  type: PageType,
  exits: readonly ButtonActionKind[],
): boolean {
  const visibleButton = page.elements.some(
    (e) => e.type === 'button' && e.visible && exits.includes(e.action.kind),
  );
  if (visibleButton) return true;
  switch (type) {
    case 'tutorial':
      return (
        (page.slides?.length ?? 0) > 0 && page.slides!.every((s) => s.durationSec !== undefined)
      );
    case 'payment':
      return page.elements.some((e) => e.type === 'qris' || e.type === 'voucher-input');
    case 'capture':
      return config.flow.autoAdvanceBetweenShots;
    case 'error':
      return config.flow.idleTimeoutSec.error !== undefined;
    default:
      return false;
  }
}

function autoAdvanceHint(type: PageType): string {
  switch (type) {
    case 'tutorial':
      return ' atau isi durasi di setiap slide';
    case 'payment':
      return ' atau elemen qris/voucher-input';
    case 'capture':
      return ' atau aktifkan lanjut otomatis antar foto';
    case 'error':
      return ' atau atur idle timeout halaman Error';
    default:
      return '';
  }
}
