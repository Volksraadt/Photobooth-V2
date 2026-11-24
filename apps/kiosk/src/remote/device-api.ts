/**
 * Kiosk ↔ apps/api (F2). The device token is generated here and never leaves the device except
 * as `Authorization: Bearer` to the API; pairing only sends its sha256.
 * F3 moves this behind the local agent (token in the OS keychain via Tauri).
 */

const TOKEN_KEY = 'pb.deviceToken';

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode / blocked storage: pairing simply repeats after reload.
  }
}

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
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

export class DeviceApi {
  constructor(
    readonly base: string,
    private token: string | null,
  ) {}

  setToken(token: string | null) {
    this.token = token;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.token) headers.set('authorization', `Bearer ${this.token}`);
    if (init.body) headers.set('content-type', 'application/json');
    return fetch(`${this.base}${path}`, { ...init, headers, cache: 'no-store' });
  }

  async startPairing(tokenHash: string): Promise<{ code: string; expiresAt: string }> {
    const res = await this.request('/pair/start', {
      method: 'POST',
      body: JSON.stringify({ tokenHash, fingerprint: navigator.userAgent.slice(0, 200) }),
    });
    if (!res.ok) throw new DeviceApiError(res.status, 'Gagal meminta kode pairing');
    return res.json() as Promise<{ code: string; expiresAt: string }>;
  }

  async pairingStatus(code: string, token: string): Promise<{ status: string; boothId?: string }> {
    const res = await this.request('/pair/status', {
      method: 'POST',
      body: JSON.stringify({ code, token }),
    });
    if (!res.ok) throw new DeviceApiError(res.status, 'Gagal mengecek pairing');
    return res.json() as Promise<{ status: string; boothId?: string }>;
  }

  /** 200 with config, 204 = nothing published yet, 304 = unchanged, 401 = revoked/unknown. */
  async config(
    etag: string | null,
  ): Promise<
    | { status: 'ok'; etag: string | null; version: number; config: unknown }
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
    const body = (await res.json()) as { version: number; config: unknown };
    return {
      status: 'ok',
      etag: res.headers.get('etag'),
      version: body.version,
      config: body.config,
    };
  }

  async heartbeat(body: {
    configVersion: number | null;
    appVersion: string;
    platform: string;
    cameraStatus: string;
  }) {
    await this.request('/device/heartbeat', { method: 'POST', body: JSON.stringify(body) }).catch(
      () => undefined,
    );
  }

  /**
   * SSE over fetch (EventSource cannot send Authorization). Calls `onConfig` for each `config`
   * event; resolves when the stream ends (caller reconnects).
   */
  async stream(onConfig: () => void, signal: AbortSignal): Promise<void> {
    const res = await this.request('/device/stream', {
      signal,
      headers: { accept: 'text/event-stream' },
    });
    if (res.status === 401) throw new DeviceApiError(401, 'Perangkat dicabut');
    if (!res.ok || !res.body) throw new DeviceApiError(res.status, 'Stream tidak tersedia');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (/^event: config$/m.test(chunk)) onConfig();
      }
    }
  }
}
