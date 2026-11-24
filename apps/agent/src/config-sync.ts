import { migrateBoothConfig, type BoothConfig } from '@pb/schema';
import type { AssetStore } from './assets';
import { DeviceApi, DeviceApiError, newDeviceToken, sha256Hex, TokenFile } from './device-api';
import type { AgentStore } from './store';

export type ConfigState =
  | { status: 'connecting' }
  | { status: 'pairing'; code: string; expiresAt: string }
  | { status: 'waiting' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      config: BoothConfig;
      version: number;
      /** assetId → local file (non-data assets). */
      assetPaths: Record<string, string>;
      source: 'api' | 'cache';
    };

const PAIR_POLL_MS = 2000;

/**
 * Active booth config from apps/api, owned by the agent since F3 (pairing, device token,
 * download + verify assets, offline copy in SQLite). Updates: SSE `/device/stream` (instant)
 * plus polling as fallback. A version is activated only when every asset is verified on disk.
 */
export class ConfigSync {
  private state: ConfigState = { status: 'connecting' };
  private readonly listeners = new Set<(s: ConfigState) => void>();
  readonly api: DeviceApi;
  private readonly tokenFile: TokenFile;
  private etag: string | null = null;
  private refreshing: Promise<void> | null = null;
  private again = false;
  private stopped = false;
  private loopsStarted = false;
  private abort = new AbortController();
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly store: AgentStore,
    readonly assets: AssetStore,
    apiBase: string,
    private readonly pollMs: number,
    private readonly onEvent: (
      kind: string,
      message: string,
      level?: 'info' | 'warn' | 'error',
    ) => void = () => {},
  ) {
    this.tokenFile = new TokenFile(store.dataDir);
    this.api = new DeviceApi(apiBase, this.tokenFile.read());
  }

  get current(): ConfigState {
    return this.state;
  }

  get paired(): boolean {
    return this.api.hasToken;
  }

  subscribe(listener: (s: ConfigState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: ConfigState) {
    this.state = next;
    for (const l of [...this.listeners]) l(next);
  }

  private later(fn: () => void, ms: number) {
    if (this.stopped) return;
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  async start(): Promise<void> {
    // Offline start: the last good config is usable right away.
    const cached = this.store.latestConfig();
    if (cached && this.api.hasToken) {
      const parsed = migrateBoothConfig(cached.config);
      if (parsed.success) {
        this.etag = cached.etag;
        this.set({
          status: 'ready',
          config: parsed.config,
          version: cached.version,
          assetPaths: cached.assetPaths,
          source: 'cache',
        });
      }
    }
    if (!this.api.hasToken) return this.pair();
    this.startLoops();
  }

  stop() {
    this.stopped = true;
    this.abort.abort();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private startLoops() {
    if (this.loopsStarted) return;
    this.loopsStarted = true;
    void this.refresh();
    const poll = () => {
      void this.refresh();
      this.later(poll, this.pollMs);
    };
    this.later(poll, this.pollMs);
    void this.streamLoop(1);
  }

  private async streamLoop(attempt: number): Promise<void> {
    if (this.stopped || !this.api.hasToken) return;
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
    if (!this.api.hasToken) return;
    try {
      const res = await this.api.config(this.etag);
      if (res.status === 'none') {
        if (this.state.status !== 'ready') this.set({ status: 'waiting' });
        return;
      }
      if (res.status === 'unchanged') return;
      await this.activate(res);
    } catch (err) {
      if (err instanceof DeviceApiError && err.status === 401) {
        // Revoked or unknown token: forget it and pair again.
        this.onEvent('device_revoked', 'Token perangkat ditolak API; pairing ulang', 'warn');
        this.tokenFile.write(null);
        this.store.clearConfigs();
        this.api.setToken(null);
        this.etag = null;
        this.abort.abort();
        this.abort = new AbortController();
        this.loopsStarted = false;
        return this.pair();
      }
      const message = err instanceof Error ? err.message : String(err);
      if (this.state.status !== 'ready') this.set({ status: 'error', message });
      else if (!(err instanceof TypeError)) this.onEvent('sync_failed', message, 'warn');
    }
  }

  /**
   * Forgets the device token and the cached configs, then starts a new pairing (operator moves
   * the laptop to another booth). Local sessions and files are kept.
   */
  async reset(): Promise<void> {
    this.onEvent('device_reset', 'Pasangan perangkat dilepas dari mode admin', 'warn');
    this.tokenFile.write(null);
    this.store.clearConfigs();
    this.api.setToken(null);
    this.etag = null;
    this.abort.abort();
    this.abort = new AbortController();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.loopsStarted = false;
    this.set({ status: 'connecting' });
    await this.pair();
  }

  private async activate(res: {
    etag: string | null;
    id: string;
    version: number;
    config: unknown;
  }) {
    const parsed = migrateBoothConfig(res.config);
    if (!parsed.success) {
      this.onEvent(
        'sync_failed',
        `Config v${res.version} tidak valid; versi lama tetap dipakai`,
        'error',
      );
      return;
    }
    let assetPaths: Record<string, string>;
    try {
      assetPaths = await this.assets.prepare(parsed.config);
    } catch (err) {
      // All-or-nothing: keep the current version, retry on the next poll.
      this.onEvent('sync_failed', err instanceof Error ? err.message : String(err), 'warn');
      if (this.state.status !== 'ready') {
        this.set({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    this.etag = res.etag;
    this.store.saveConfig({
      version: res.version,
      configId: res.id,
      etag: res.etag,
      config: parsed.config,
      assetPaths,
    });
    this.set({
      status: 'ready',
      config: parsed.config,
      version: res.version,
      assetPaths,
      source: 'api',
    });
  }

  private async pair(): Promise<void> {
    if (this.stopped) return;
    const token = newDeviceToken();
    let code: string;
    try {
      const res = await this.api.startPairing(sha256Hex(token));
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
          this.tokenFile.write(token);
          this.api.setToken(token);
          this.onEvent('paired', `Perangkat terpasang ke booth ${status.boothId ?? ''}`, 'info');
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
