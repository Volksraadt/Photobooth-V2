import { homedir } from 'node:os';
import { join } from 'node:path';
import { AGENT_LAN_PORT, AGENT_LOCAL_PORT } from '@pb/capture/protocol';

export const AGENT_VERSION = '0.3.0';

export type AgentOptions = {
  /** SQLite, device token, session files, asset cache. */
  dataDir: string;
  apiBase: string;
  /** Base of the download short link (`<base>/s/<code>`). */
  shortLinkBase: string;
  /** Kiosk API, bound to 127.0.0.1 only. 0 = random (tests). */
  localPort: number;
  /** Camera App server on every interface. 0 = random (tests). */
  lanPort: number;
  lanHost: string;
  /** Hosts put in the camera pairing QR. Empty = every LAN IPv4 of this machine. */
  advertiseHosts: string[];
  /** Browser origins allowed to call the local API (Tauri webview, kiosk dev server). */
  allowedOrigins: string[];
  /** Print through the OS ('system') or always to files in dataDir/prints ('virtual'). */
  printMode: 'system' | 'virtual';
  /** Disable timers that talk to the API (tests drive sync manually). */
  telemetry: boolean;
  configPollMs: number;
  heartbeatMs: number;
  outboxFlushMs: number;
  /** F5: how often the upload queue looks for work (it also runs right after processing). */
  uploadMs?: number;
  /** F5: keep the local copy this many days after a confirmed upload (0 = delete at once). */
  localRetentionDays?: number;
};

/** Per-user application data folder (Windows %APPDATA%, macOS Application Support, XDG). */
export function defaultDataDir(): string {
  const name = 'photobooth-agent';
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), name);
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', name);
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), name);
}

export const DEFAULT_ORIGINS = [
  // Tauri 2 webview (Windows/Android use http(s)://tauri.localhost, macOS/Linux tauri://localhost).
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  // Kiosk dev server + its e2e port.
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
];

/** Running from the repo with tsx (dev): data in <repo>/.data/agent, printing to files. */
const FROM_SOURCE = /[\\/]apps[\\/]agent[\\/]src[\\/]/.test(import.meta.filename ?? '');
const REPO_DATA = join(import.meta.dirname ?? '.', '..', '..', '..', '.data', 'agent');

export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): AgentOptions {
  const list = (v: string | undefined) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const num = (v: string | undefined, fallback: number) =>
    v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback;
  const apiBase = (env.PB_API_URL ?? 'http://localhost:8787').replace(/\/$/, '');
  return {
    dataDir: env.PB_AGENT_DATA ?? (FROM_SOURCE ? REPO_DATA : defaultDataDir()),
    apiBase,
    shortLinkBase: (env.PB_SHORT_LINK_BASE ?? apiBase).replace(/\/$/, ''),
    localPort: num(env.PB_AGENT_PORT, AGENT_LOCAL_PORT),
    lanPort: num(env.PB_AGENT_LAN_PORT, AGENT_LAN_PORT),
    lanHost: env.PB_AGENT_LAN_HOST ?? '0.0.0.0',
    advertiseHosts: list(env.PB_AGENT_ADVERTISE_HOSTS),
    allowedOrigins: [...DEFAULT_ORIGINS, ...list(env.PB_AGENT_ORIGINS)],
    // Dev never sends jobs to a real printer unless asked (PB_PRINT_MODE=system).
    printMode:
      (env.PB_PRINT_MODE ?? (FROM_SOURCE ? 'virtual' : 'system')) === 'virtual'
        ? 'virtual'
        : 'system',
    telemetry: env.PB_AGENT_TELEMETRY !== '0',
    configPollMs: num(env.PB_AGENT_CONFIG_POLL_MS, 5000),
    heartbeatMs: num(env.PB_AGENT_HEARTBEAT_MS, 30_000),
    outboxFlushMs: num(env.PB_AGENT_OUTBOX_MS, 10_000),
    uploadMs: num(env.PB_AGENT_UPLOAD_MS, 15_000),
    localRetentionDays: num(env.PB_LOCAL_RETENTION_DAYS, 0),
  };
}
