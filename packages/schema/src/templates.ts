import type { BoothConfig } from './booth-config';
import { createDefaultBoothConfig, type CreateDefaultBoothConfigOptions } from './default-config';
import type { Element } from './elements';

export type BuiltinTemplate = {
  key: string;
  name: string;
  description: string;
  build: (opts: CreateDefaultBoothConfigOptions) => BoothConfig;
};

/** Default palette used by createDefaultBoothConfig(). */
const BASE = {
  bg: '#0f172a',
  panel: '#1e293b',
  accent: '#ec4899',
  text: '#ffffff',
  muted: '#cbd5e1',
  pressed: '#be185d',
  gradient: 'linear-gradient(135deg, #1e1b4b 0%, #831843 100%)',
};

type Palette = typeof BASE;

/**
 * Element types whose colors must stay readable/scannable: QR codes on white, and elements drawn
 * over the live camera image (dark whatever the theme), such as the countdown.
 */
const KEEP_COLORS = new Set<Element['type']>([
  'qris',
  'download-qr',
  'voucher-input',
  'countdown',
  'camera-view',
]);

function recolor(config: BoothConfig, to: Palette): BoothConfig {
  const map = new Map<string, string>(
    (Object.keys(BASE) as (keyof Palette)[]).map((k) => [BASE[k].toLowerCase(), to[k]]),
  );
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return map.get(v.toLowerCase()) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      if (typeof obj.type === 'string' && KEEP_COLORS.has(obj.type as Element['type'])) return obj;
      return Object.fromEntries(Object.entries(obj).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  // Pages only: frames are printed on white strips and keep their colors.
  return { ...config, pages: walk(config.pages) as BoothConfig['pages'] };
}

function neon(opts: CreateDefaultBoothConfigOptions): BoothConfig {
  const config = recolor(createDefaultBoothConfig(opts), {
    bg: '#05010d',
    panel: '#1a0b2e',
    accent: '#00b8d4',
    text: '#ffffff',
    muted: '#c4b5fd',
    pressed: '#00838f',
    gradient: 'linear-gradient(135deg, #12002b 0%, #3a0057 60%, #00363d 100%)',
  });
  // Mirror the capture layout: slots on the left, camera on the right.
  for (const el of config.pages.capture.elements) {
    if (el.type === 'photo-slot') el.x = 80;
    else el.x += 480;
  }
  return config;
}

function terang(opts: CreateDefaultBoothConfigOptions): BoothConfig {
  return recolor(createDefaultBoothConfig(opts), {
    bg: '#fdf6ec',
    panel: '#efe4d6',
    accent: '#e76f51',
    text: '#2b2d42',
    muted: '#6b705c',
    pressed: '#c4553a',
    gradient: 'linear-gradient(135deg, #fff1e6 0%, #fde2e4 100%)',
  });
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    key: 'klasik',
    name: 'Klasik',
    description: 'Gelap dengan aksen pink, kamera di kiri.',
    build: createDefaultBoothConfig,
  },
  {
    key: 'neon',
    name: 'Neon Malam',
    description: 'Hitam-ungu dengan aksen cyan, kamera di kanan.',
    build: neon,
  },
  {
    key: 'terang',
    name: 'Terang',
    description: 'Krem hangat dengan aksen oranye.',
    build: terang,
  },
];

/** Template config stored in the DB: generic booth name token, no booth id. */
export function buildTemplateConfig(template: BuiltinTemplate): BoothConfig {
  return template.build({ boothId: 'template', boothName: '{{boothName}}' });
}

/** Fill a stored template config for a new booth. */
export function instantiateTemplate(
  template: BoothConfig,
  booth: { boothId: string; boothName: string; timezone: string },
): BoothConfig {
  const config = JSON.parse(JSON.stringify(template)) as BoothConfig;
  config.boothId = booth.boothId;
  config.configVersion = 0;
  config.timezone = booth.timezone;
  config.output.driveRootFolderName = booth.boothName;
  config.admin = { pinHash: '' };
  return config;
}
