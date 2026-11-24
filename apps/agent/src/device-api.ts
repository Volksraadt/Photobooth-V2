import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

export const sha256Hex = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

export function newDeviceToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Device token file in the agent data folder, readable by the current OS user only.
 * Only the agent holds it now (F2 kept it in the kiosk's localStorage).
 */
export class TokenFile {
  private readonly path: string;
  constructor(dataDir: string) {
    this.path = join(dataDir, 'device-token');
  }
  read(): string | null {
    try {
      const t = readFileSync(this.path, 'utf8').trim();
      return t || null;
    } catch {
      return null;
    }
  }
  write(token: string | null) {
    if (!token) {
      if (existsSync(this.path)) rmSync(this.path);
      return;
    }
    writeFileSync(this.path, token, { mode: 0o600 });
    try {
      chmodSync(this.path, 0o600);
    } catch {
      // Windows: ACLs of the per-user AppData folder apply.
    }
  }
}

export class DeviceApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DeviceApiError';
  }
}

export type HeartbeatBody = {
  configVersion: number | null;
  appVersion: string;
  platform: string;
  cameraStatus: 'ok' | 'error' | 'disconnected' | 'unknown';
  printerStatus: 'ok' | 'warning' | 'error' | 'disconnected' | 'unknown';
};

export type OutboxBatch = {
  events: {
    id: string;
    level: string;
    kind: string;
    message: string | null;
    data: unknown;
    occurredAt: string;
  }[];
  printJobs: {
    id: string;
    sessionId: string | null;
    sessionCode: string | null;
    sheets: number;
    status: string;
    occurredAt: string;
  }[];
};

/** Agent ↔ apps/api (`/pair/*`, `/device/*`). Node fetch, token as Bearer. */
export class DeviceApi {
  constructor(
    readonly base: string,
    private token: string | null,
  ) {}

  setToken(token: string | null) {
    this.token = token;
  }

  get hasToken() {
    return !!this.token;
  }

  private request(
    path: string,
    init: RequestInit & { timeoutMs?: number } = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.token) headers.set('authorization', `Bearer ${this.token}`);
    if (init.body) headers.set('content-type', 'application/json');
    const signal =
      init.signal ??
      (init.timeoutMs === 0 ? undefined : AbortSignal.timeout(init.timeoutMs ?? 15_000));
    return fetch(`${this.base}${path}`, { ...init, headers, signal });
  }

  async startPairing(tokenHash: string): Promise<{ code: string; expiresAt: string }> {
    const res = await this.request('/pair/start', {
      method: 'POST',
      body: JSON.stringify({ tokenHash, fingerprint: `agent:${hostname()}`.slice(0, 200) }),
    });
    if (!res.ok) throw new DeviceApiError(res.status, 'Gagal meminta kode pairing');
    return (await res.json()) as { code: string; expiresAt: string };
  }

  async pairingStatus(code: string, token: string): Promise<{ status: string; boothId?: string }> {
    const res = await this.request('/pair/status', {
      method: 'POST',
      body: JSON.stringify({ code, token }),
    });
    if (!res.ok) throw new DeviceApiError(res.status, 'Gagal mengecek pairing');
    return (await res.json()) as { status: string; boothId?: string };
  }

  async me(): Promise<{ id: string; name: string; orgId: string; boothId: string | null }> {
    const res = await this.request('/device/me');
    if (res.status === 401) throw new DeviceApiError(401, 'Perangkat tidak dikenal atau dicabut');
    if (!res.ok) throw new DeviceApiError(res.status, 'Gagal memuat info perangkat');
    return (await res.json()) as {
      id: string;
      name: string;
      orgId: string;
      boothId: string | null;
    };
  }

  async config(
    etag: string | null,
  ): Promise<
    | { status: 'ok'; etag: string | null; id: string; version: number; config: unknown }
    | { status: 'none' }
    | { status: 'unchanged' }
  > {
    const res = await this.request('/device/config', {
      headers: etag ? { 'if-none-match': etag } : {},
    });
    if (res.status === 401) throw new DeviceApiError(401, 'Perangkat tidak dikenal atau dicabut');
    if (res.status === 204) return { status: 'none' };
    if (res.status === 304) return { status: 'unchanged' };
    if (!res.ok) throw new DeviceApiError(res.status, `Gagal memuat config (HTTP ${res.status})`);
    const body = (await res.json()) as { id: string; version: number; config: unknown };
    return { status: 'ok', etag: res.headers.get('etag'), ...body };
  }

  async heartbeat(body: HeartbeatBody): Promise<void> {
    const res = await this.request('/device/heartbeat', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new DeviceApiError(res.status, `Heartbeat ditolak (HTTP ${res.status})`);
  }

  /** Delivers outbox items; returns the ids the API stored (idempotent by id). */
  async sendOutbox(batch: OutboxBatch): Promise<string[]> {
    const res = await this.request('/device/events', {
      method: 'POST',
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new DeviceApiError(res.status, `Outbox ditolak (HTTP ${res.status})`);
    const body = (await res.json()) as { accepted: string[] };
    return body.accepted;
  }

  /** Server-sent events: calls `onConfig` on every `config` event. Resolves when the stream ends. */
  async stream(onConfig: () => void, signal: AbortSignal): Promise<void> {
    const res = await this.request('/device/stream', {
      signal,
      timeoutMs: 0,
      headers: { accept: 'text/event-stream' },
    });
    if (res.status === 401) throw new DeviceApiError(401, 'Perangkat dicabut');
    if (!res.ok || !res.body) throw new DeviceApiError(res.status, 'Stream tidak tersedia');
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (/^event: config$/m.test(block)) onConfig();
      }
    }
  }
}
