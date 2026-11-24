export type KioskSettings = {
  /** Camera source: real webcam or the deterministic mock (dev/test without a camera). */
  capture: 'webcam' | 'mock';
  /** Dev helpers: payment simulation, state readout, test hooks. */
  dev: boolean;
  /** Kiosk hardening: fullscreen on first touch, hidden cursor, no context menu. */
  kiosk: boolean;
  /** file = local JSON (dev, F1); api = paired device, active config from apps/api (F2). */
  source: 'file' | 'api';
  configUrl: string;
  apiBase: string;
  /** Base of the download short link (`<base>/s/<code>`), served by apps/api. */
  shortLinkBase: string;
};

function flag(value: string | null | undefined, fallback: boolean): boolean {
  if (value === null || value === undefined || value === '') return fallback;
  return value === '1' || value === 'true';
}

/** URL query overrides env: ?capture=mock&dev=1&kiosk=0&config=/other.json */
export function readSettings(search = window.location.search): KioskSettings {
  const q = new URLSearchParams(search);
  const env = import.meta.env;
  const capture = q.get('capture') ?? env.VITE_CAPTURE ?? 'webcam';
  return {
    capture: capture === 'mock' ? 'mock' : 'webcam',
    dev: flag(q.get('dev'), env.DEV),
    kiosk: flag(q.get('kiosk'), !env.DEV),
    source:
      (q.get('source') ?? env.VITE_CONFIG_SOURCE ?? (env.DEV ? 'file' : 'api')) === 'api'
        ? 'api'
        : 'file',
    configUrl: q.get('config') ?? env.VITE_CONFIG_URL ?? '/booth-config.json',
    apiBase: (q.get('api') ?? env.VITE_API_URL ?? 'http://localhost:8787').replace(/\/$/, ''),
    shortLinkBase: (env.VITE_SHORT_LINK_BASE ?? 'http://localhost:8787').replace(/\/$/, ''),
  };
}
