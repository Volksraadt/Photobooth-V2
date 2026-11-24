export type CaptureChoice = 'webcam' | 'mock' | 'tablet';

export type KioskSettings = {
  /**
   * Camera source override. `null` = use the operator's choice stored in the agent
   * (admin → Kamera: webcam / tablet), webcam without an agent.
   */
  capture: CaptureChoice | null;
  /** Dev helpers: payment simulation, state readout, test hooks. */
  dev: boolean;
  /** Kiosk hardening: fullscreen on first touch, hidden cursor, no context menu. */
  kiosk: boolean;
  /**
   * file = local JSON (dev, F1); agent = paired device, config synced by the local agent (F3;
   * `?source=api` is accepted as the F2 name).
   */
  source: 'file' | 'agent';
  configUrl: string;
  /** Local agent (print, storage, tablet camera, config sync). `null` = do not use an agent. */
  agentUrl: string | null;
  /** Base of the download short link (`<base>/s/<code>`), served by apps/api. */
  shortLinkBase: string;
};

function flag(value: string | null | undefined, fallback: boolean): boolean {
  if (value === null || value === undefined || value === '') return fallback;
  return value === '1' || value === 'true';
}

/** URL query overrides env: ?capture=mock&dev=1&kiosk=0&config=/other.json&agent=0 */
export function readSettings(search = window.location.search): KioskSettings {
  const q = new URLSearchParams(search);
  const env = import.meta.env;
  const capture = q.get('capture') ?? env.VITE_CAPTURE ?? '';
  const source = q.get('source') ?? env.VITE_CONFIG_SOURCE ?? (env.DEV ? 'file' : 'agent');
  const agent = q.get('agent') ?? env.VITE_AGENT_URL ?? 'http://127.0.0.1:47810';
  return {
    capture: capture === 'mock' || capture === 'webcam' || capture === 'tablet' ? capture : null,
    dev: flag(q.get('dev'), env.DEV),
    kiosk: flag(q.get('kiosk'), !env.DEV),
    source: source === 'agent' || source === 'api' ? 'agent' : 'file',
    configUrl: q.get('config') ?? env.VITE_CONFIG_URL ?? '/booth-config.json',
    agentUrl: agent === '0' || agent === 'off' ? null : agent.replace(/\/$/, ''),
    shortLinkBase: (env.VITE_SHORT_LINK_BASE ?? 'http://localhost:8787').replace(/\/$/, ''),
  };
}
