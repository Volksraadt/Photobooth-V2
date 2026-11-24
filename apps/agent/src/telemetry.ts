import type { DeviceApi, HeartbeatBody, OutboxBatch } from './device-api';
import { DeviceApiError } from './device-api';
import type { AgentStore } from './store';

/**
 * Heartbeat (every 30 s) + outbox delivery. Online/offline is derived from the heartbeat;
 * transitions are recorded as device events. Events and print jobs wait in the SQLite outbox
 * until the API confirms them (idempotent by id), so nothing is lost while offline.
 */
export class Telemetry {
  private online: boolean | null = null;
  private offlineSince: number | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private flushing: Promise<void> | null = null;
  private readonly listeners = new Set<(online: boolean) => void>();

  constructor(
    private readonly store: AgentStore,
    private readonly api: DeviceApi,
    private readonly snapshot: () => HeartbeatBody,
  ) {}

  start(heartbeatMs: number, outboxMs: number) {
    void this.beat();
    this.timers.push(setInterval(() => void this.beat(), heartbeatMs));
    this.timers.push(setInterval(() => void this.flush(), outboxMs));
    for (const t of this.timers) t.unref?.();
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
  }

  get isOnline(): boolean | null {
    return this.online;
  }

  subscribe(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setOnline(next: boolean) {
    if (this.online === next) return;
    const prev = this.online;
    this.online = next;
    if (!next) {
      this.offlineSince = Date.now();
      if (prev !== null)
        this.store.event({
          level: 'warn',
          kind: 'went_offline',
          message: 'API tidak dapat dihubungi',
        });
    } else if (prev === false && this.offlineSince !== null) {
      const sec = Math.round((Date.now() - this.offlineSince) / 1000);
      this.store.event({
        level: 'info',
        kind: 'back_online',
        message: `Kembali online setelah ${sec} dtk`,
        data: { offlineSeconds: sec },
      });
      this.offlineSince = null;
    }
    for (const l of [...this.listeners]) l(next);
  }

  async beat(): Promise<void> {
    if (!this.api.hasToken) return;
    try {
      await this.api.heartbeat(this.snapshot());
      this.setOnline(true);
      void this.flush();
    } catch (err) {
      // 401 = revoked: ConfigSync handles re-pairing; not an "offline" state.
      if (!(err instanceof DeviceApiError && err.status === 401)) this.setOnline(false);
    }
  }

  /** Sends due outbox items in batches of 100. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    if (!this.api.hasToken) return;
    for (;;) {
      const rows = this.store.dueOutbox(100);
      if (rows.length === 0) return;
      const batch: OutboxBatch = { events: [], printJobs: [] };
      for (const row of rows) {
        const payload = JSON.parse(row.payload) as Record<string, unknown>;
        if (row.kind === 'device_event') {
          batch.events.push({
            id: row.id,
            ...(payload as Omit<OutboxBatch['events'][number], 'id'>),
          });
        } else {
          batch.printJobs.push({
            id: row.id,
            ...(payload as Omit<OutboxBatch['printJobs'][number], 'id'>),
          });
        }
      }
      try {
        const accepted = await this.api.sendOutbox(batch);
        this.store.ackOutbox(accepted);
        const rejected = rows.map((r) => r.id).filter((id) => !accepted.includes(id));
        if (rejected.length) this.store.failOutbox(rejected, 'ditolak API');
        this.setOnline(true);
        if (rows.length < 100) return;
      } catch (err) {
        this.store.failOutbox(
          rows.map((r) => r.id),
          err instanceof Error ? err.message : String(err),
        );
        if (!(err instanceof DeviceApiError)) this.setOnline(false);
        return;
      }
    }
  }
}
