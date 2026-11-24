import { migrateBoothConfig, type BoothConfig } from '@pb/schema';
import { prepareAssets } from './asset-cache';
import { DeviceApi, DeviceApiError, loadToken, newToken, saveToken, sha256Hex } from './device-api';

export type RemoteState =
  | { status: 'connecting' }
  | { status: 'pairing'; code: string; expiresAt: string }
  | { status: 'waiting' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      config: BoothConfig;
      version: number;
      /** assetId → local object URL (verified, cached). */
      assetUrls: Map<string, string>;
      source: 'api' | 'cache';
    };

const CONFIG_CACHE_KEY = 'pb.lastConfig';
export const POLL_MS = 5000;
const PAIR_POLL_MS = 2000;

type Cached = { etag: string | null; version: number; config: unknown };

function readCached(): Cached | null {
  try {
    const raw = localStorage.getItem(CONFIG_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch {
    return null;
  }
}

function writeCached(c: Cached | null) {
  try {
    if (c) localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(c));
    else localStorage.removeItem(CONFIG_CACHE_KEY);
  } catch {
    // storage full / blocked: offline start just won't have a cached copy
  }
}

/**
 * Active booth config from apps/api: pairing → fetch → download + verify all assets → activate.
 * Updates arrive via SSE (instant) with polling every 5 s as fallback. A new version is
 * activated only when every asset downloaded and verified; otherwise the old one stays.
 */
export class RemoteConfigClient {
  private state: RemoteState = { status: 'connecting' };
  private readonly listeners = new Set<(s: RemoteState) => void>();
  private readonly api: DeviceApi;
  private etag: string | null = null;
  private refreshing: Promise<void> | null = null;
  private again = false;
  private stopped = false;
  private abort = new AbortController();
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(apiBase: string) {
    this.api = new DeviceApi(apiBase, loadToken());
  }

  get current(): RemoteState {
    return this.state;
  }

  subscribe(listener: (s: RemoteState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: RemoteState) {
    this.state = next;
    for (const l of [...this.listeners]) l(next);
  }

  private later(fn: () => void, ms: number) {
    if (this.stopped) return;
    this.timers.push(setTimeout(fn, ms));
  }

  async start(): Promise<void> {
    // Offline start: show the last good config right away; the API refresh replaces it.
    const cached = readCached();
    if (cached && loadToken()) await this.activate(cached, 'cache').catch(() => undefined);
    if (!loadToken()) return this.pair();
    this.startLoops();
  }

  stop() {
    this.stopped = true;
    this.abort.abort();
    for (const t of this.timers) clearTimeout(t);
  }

  heartbeat(info: { configVersion: number | null; cameraStatus: string }) {
    if (!loadToken()) return;
    void this.api.heartbeat({
      ...info,
      appVersion: 'kiosk-web',
      platform: navigator.platform || 'web',
    });
  }

  private startLoops() {
    void this.refresh();
    const poll = () => {
      void this.refresh();
      this.later(poll, POLL_MS);
    };
    this.later(poll, POLL_MS);
    void this.streamLoop(1);
  }

  private async streamLoop(attempt: number): Promise<void> {
    if (this.stopped) return;
    try {
      await this.api.stream(() => void this.refresh(), this.abort.signal);
      attempt = 1;
    } catch (err) {
      if (this.stopped) return;
      if (err instanceof DeviceApiError && err.status === 401) return; // refresh() re-pairs
    }
    this.later(() => void this.streamLoop(attempt + 1), Math.min(30_000, 1000 * attempt));
  }

  /** Fetches the active config; coalesces concurrent calls. */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.again = true;
      return this.refreshing;
    }
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = null;
      if (this.again) {
        this.again = false;
        void this.refresh();
      }
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    try {
      const res = await this.api.config(this.etag);
      if (res.status === 'none') {
        if (this.state.status !== 'ready') this.set({ status: 'waiting' });
        return;
      }
      if (res.status === 'unchanged') return;
      await this.activate({ etag: res.etag, version: res.version, config: res.config }, 'api');
    } catch (err) {
      if (err instanceof DeviceApiError && err.status === 401) {
        // Revoked or unknown token: forget everything and pair again.
        saveToken(null);
        writeCached(null);
        this.api.setToken(null);
        this.abort.abort();
        this.abort = new AbortController();
        return this.pair();
      }
      if (this.state.status !== 'ready') {
        this.set({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
      console.warn('[kiosk] config refresh failed; keeping the current version', err);
    }
  }

  private async activate(c: Cached, source: 'api' | 'cache'): Promise<void> {
    const parsed = migrateBoothConfig(c.config);
    if (!parsed.success) {
      console.error('[kiosk] invalid config from API; keeping the current version', parsed.issues);
      return;
    }
    // All-or-nothing: throws (and keeps the old version) if any asset fails.
    const assetUrls = await prepareAssets(parsed.config);
    this.etag = c.etag;
    if (source === 'api') writeCached(c);
    this.set({ status: 'ready', config: parsed.config, version: c.version, assetUrls, source });
  }

  private async pair(): Promise<void> {
    if (this.stopped) return;
    const token = newToken();
    let code: string;
    try {
      const res = await this.api.startPairing(await sha256Hex(token));
      code = res.code;
      this.set({ status: 'pairing', code: res.code, expiresAt: res.expiresAt });
    } catch (err) {
      this.set({ status: 'error', message: `API tidak dapat dihubungi (${String(err)})` });
      this.later(() => void this.pair(), 5000);
      return;
    }
    const check = async () => {
      if (this.stopped) return;
      try {
        const status = await this.api.pairingStatus(code, token);
        if (status.status === 'claimed') {
          saveToken(token);
          this.api.setToken(token);
          this.set({ status: 'connecting' });
          this.startLoops();
          return;
        }
        if (status.status === 'expired' || status.status === 'unknown') return void this.pair();
      } catch {
        // transient; keep polling
      }
      this.later(() => void check(), PAIR_POLL_MS);
    };
    this.later(() => void check(), PAIR_POLL_MS);
  }
}
