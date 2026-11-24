import { randomBytes } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import type {
  AgentToCamera,
  AgentToKiosk,
  CameraInfo,
  CameraPairResponse,
  CameraToAgent,
  TabletCameraState,
} from '@pb/capture/protocol';
import type { WebSocket } from 'ws';
import { sha256Hex } from './device-api';
import type { SessionFiles, SessionRef } from './sessions';
import type { AgentStore, LocalFileRow } from './store';

const PAIRING_TTL_MS = 10 * 60 * 1000;
/** Ping cadence for the tablet socket; a Wi-Fi drop is noticed within ~2 intervals. */
export const CAMERA_PING_MS = 2000;
const CAMERA_PONG_TIMEOUT_MS = 5000;
const CAPTURE_TIMEOUT_MS = 60_000;

export class CaptureFailedError extends Error {
  constructor(
    readonly code: 'no-camera' | 'timeout' | 'camera-error',
    message: string,
  ) {
    super(message);
    this.name = 'CaptureFailedError';
  }
}

type PendingCapture = {
  requestId: string;
  session: SessionRef;
  slotIndex: number;
  takeNumber: number;
  resolve: (file: LocalFileRow) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  sentTo: string | null;
};

type CameraConnection = {
  connectionId: string;
  cameraId: string;
  socket: WebSocket;
  info: CameraInfo;
  lastPong: number;
};

/**
 * Tablet cameras: one-time pairing codes → camera tokens (hashed in SQLite), the live control
 * socket, capture requests that survive short disconnects, and WebRTC signaling relay between
 * the kiosk (receiver) and the tablet (sender).
 */
export class CameraHub {
  private pairingCodes = new Map<string, number>();
  private active: CameraConnection | null = null;
  private lastInfo: CameraInfo | null = null;
  private disconnectedSince: number | null = null;
  private pending = new Map<string, PendingCapture>();
  /** requestId → stored file, so repeated uploads (retry after a drop) are idempotent. */
  private fulfilled = new Map<string, { file: LocalFileRow; at: number }>();
  /** Timed-out requests: a late upload is still stored (no photo is ever thrown away). */
  private expired = new Map<string, Omit<PendingCapture, 'resolve' | 'reject' | 'timer'>>();
  private kioskSockets = new Set<WebSocket>();
  private pingTimer: ReturnType<typeof setInterval>;
  private readonly listeners = new Set<(s: TabletCameraState) => void>();

  constructor(
    private readonly store: AgentStore,
    private readonly files: SessionFiles,
    readonly agentId: string,
    private readonly onEvent: (
      kind: string,
      message: string,
      level: 'info' | 'warn' | 'error',
    ) => void,
  ) {
    this.pingTimer = setInterval(() => this.pingCamera(), CAMERA_PING_MS);
    this.pingTimer.unref?.();
  }

  stop() {
    clearInterval(this.pingTimer);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new CaptureFailedError('no-camera', 'Agent berhenti'));
    }
    this.pending.clear();
    const conn = this.active;
    this.active = null;
    conn?.socket.terminate();
  }

  // --- state ---

  state(): TabletCameraState {
    if (this.active) {
      return {
        status: 'connected',
        connectionId: this.active.connectionId,
        info: this.active.info,
        since: this.active.lastPong,
      };
    }
    if (this.lastInfo && this.disconnectedSince !== null) {
      return { status: 'disconnected', info: this.lastInfo, since: this.disconnectedSince };
    }
    return { status: 'absent', pairedCount: this.store.cameraPairings().length };
  }

  subscribe(listener: (s: TabletCameraState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitState() {
    const s = this.state();
    for (const l of [...this.listeners]) l(s);
    this.broadcastKiosk({ type: 'camera', camera: s });
  }

  // --- pairing ---

  createPairingCode(): { code: string; expiresAt: string } {
    const now = Date.now();
    for (const [code, exp] of this.pairingCodes) if (exp < now) this.pairingCodes.delete(code);
    const code = randomBytes(16).toString('hex');
    this.pairingCodes.set(code, now + PAIRING_TTL_MS);
    return { code, expiresAt: new Date(now + PAIRING_TTL_MS).toISOString() };
  }

  /** One-time code → long-lived camera token (only its hash is stored). */
  pair(code: string, name: string, platform: string): CameraPairResponse | null {
    const exp = this.pairingCodes.get(code);
    this.pairingCodes.delete(code);
    if (!exp || exp < Date.now()) return null;
    const token = randomBytes(32).toString('hex');
    const row = this.store.addCameraPairing({
      name: name.slice(0, 80) || 'Tablet',
      platform: platform.slice(0, 40) || 'unknown',
      tokenHash: sha256Hex(token),
    });
    this.onEvent('camera_paired', `Kamera "${row.name}" dipasangkan`, 'info');
    this.emitState();
    return { cameraId: row.id, token, agentId: this.agentId };
  }

  authenticate(token: string | null | undefined) {
    return token ? this.store.cameraByTokenHash(sha256Hex(token)) : undefined;
  }

  forget(cameraId: string) {
    this.store.revokeCamera(cameraId);
    if (this.active?.cameraId === cameraId) this.active.socket.close(4401, 'revoked');
    this.emitState();
  }

  // --- camera socket ---

  /** Handles a new /camera/ws connection: the first message must be a valid `hello`. */
  attachCamera(socket: WebSocket) {
    let conn: CameraConnection | null = null;
    const helloTimer = setTimeout(() => socket.close(4401, 'hello timeout'), 5000);

    socket.on('pong', () => {
      if (conn) conn.lastPong = Date.now();
    });
    socket.on('message', (raw) => {
      let msg: CameraToAgent;
      try {
        msg = JSON.parse(String(raw)) as CameraToAgent;
      } catch {
        return;
      }
      if (!conn) {
        if (msg.type !== 'hello') return socket.close(4400, 'expected hello');
        const camera = this.authenticate(msg.token);
        if (!camera) return socket.close(4401, 'unknown camera');
        clearTimeout(helloTimer);
        conn = {
          connectionId: createId(),
          cameraId: camera.id,
          socket,
          info: { ...msg.info, cameraId: camera.id, name: camera.name },
          lastPong: Date.now(),
        };
        this.onCameraConnected(conn, msg.pendingRequestIds);
        return;
      }
      if (this.active !== conn) return;
      switch (msg.type) {
        case 'info':
          conn.info = { ...msg.info, cameraId: conn.cameraId, name: conn.info.name };
          this.emitState();
          break;
        case 'signal':
          this.broadcastKiosk({ type: 'signal', peerId: msg.peerId, data: msg.data });
          break;
        case 'capture-error': {
          const p = this.pending.get(msg.requestId);
          if (p)
            this.settle(
              p,
              new CaptureFailedError('camera-error', msg.message || 'Kamera gagal mengambil foto'),
            );
          break;
        }
        case 'pong':
          conn.lastPong = Date.now();
          break;
      }
    });
    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (conn && this.active === conn) this.onCameraGone(conn);
    });
    socket.on('error', () => socket.terminate());
  }

  private onCameraConnected(conn: CameraConnection, cameraPending: string[]) {
    const previous = this.active;
    this.active = conn;
    if (previous) previous.socket.close(4000, 'replaced');
    const wasDown = this.disconnectedSince;
    this.disconnectedSince = null;
    this.lastInfo = conn.info;
    this.store.touchCamera(conn.cameraId);
    this.sendCamera({ type: 'welcome', agentId: this.agentId, serverTime: Date.now() });
    if (wasDown !== null) {
      this.onEvent(
        'camera_reconnected',
        `Kamera tersambung kembali setelah ${Math.round((Date.now() - wasDown) / 1000)} dtk`,
        'info',
      );
    } else {
      this.onEvent('camera_connected', `Kamera "${conn.info.name}" tersambung`, 'info');
    }
    // Re-send captures the tablet never got (it reports those it still has to upload).
    for (const p of this.pending.values()) {
      if (!cameraPending.includes(p.requestId)) {
        p.sentTo = conn.connectionId;
        this.sendCamera({ type: 'capture', requestId: p.requestId, shotIndex: p.slotIndex });
      }
    }
    this.emitState();
  }

  private onCameraGone(conn: CameraConnection) {
    this.active = null;
    this.lastInfo = conn.info;
    this.disconnectedSince = Date.now();
    this.onEvent('camera_disconnected', `Kamera "${conn.info.name}" terputus`, 'warn');
    this.emitState();
  }

  private pingCamera() {
    const conn = this.active;
    if (!conn) return;
    if (Date.now() - conn.lastPong > CAMERA_PONG_TIMEOUT_MS) {
      // Wi-Fi gone: TCP would take minutes to notice. Drop it now; the tablet reconnects.
      conn.socket.terminate();
      if (this.active === conn) this.onCameraGone(conn);
      return;
    }
    try {
      conn.socket.ping();
      this.sendCamera({ type: 'ping', t: Date.now() });
    } catch {
      // closed in between
    }
  }

  private sendCamera(msg: AgentToCamera): boolean {
    const s = this.active?.socket;
    if (!s || s.readyState !== s.OPEN) return false;
    s.send(JSON.stringify(msg));
    return true;
  }

  // --- capture ---

  /**
   * Asks the tablet for a full-resolution still and resolves once it is stored on disk.
   * If the tablet is briefly away, the request waits (up to 60 s) and is re-sent on reconnect.
   */
  capture(input: {
    session: SessionRef;
    slotIndex: number;
    takeNumber: number;
    timeoutMs?: number;
  }): Promise<LocalFileRow> {
    const neverPaired = !this.active && this.disconnectedSince === null;
    if (neverPaired) {
      return Promise.reject(new CaptureFailedError('no-camera', 'Kamera tablet belum tersambung.'));
    }
    const requestId = createId();
    return new Promise<LocalFileRow>((resolve, reject) => {
      const timer = setTimeout(() => {
        const p = this.pending.get(requestId);
        if (!p) return;
        this.pending.delete(requestId);
        this.expired.set(requestId, {
          requestId,
          session: p.session,
          slotIndex: p.slotIndex,
          takeNumber: p.takeNumber,
          sentTo: p.sentTo,
        });
        reject(new CaptureFailedError('timeout', 'Kamera tablet tidak merespons.'));
      }, input.timeoutMs ?? CAPTURE_TIMEOUT_MS);
      const p: PendingCapture = {
        requestId,
        session: input.session,
        slotIndex: input.slotIndex,
        takeNumber: input.takeNumber,
        resolve,
        reject,
        timer,
        sentTo: null,
      };
      this.pending.set(requestId, p);
      if (this.sendCamera({ type: 'capture', requestId, shotIndex: input.slotIndex })) {
        p.sentTo = this.active!.connectionId;
      }
    });
  }

  private settle(p: PendingCapture, result: LocalFileRow | Error) {
    clearTimeout(p.timer);
    this.pending.delete(p.requestId);
    if (result instanceof Error) p.reject(result);
    else p.resolve(result);
  }

  /** `POST /camera/shots?requestId=…`. Returns the stored file (idempotent per requestId). */
  async receiveShot(
    requestId: string,
    bytes: Uint8Array,
    capturedAt: string | undefined,
  ): Promise<{ status: 'stored' | 'duplicate' | 'unknown'; file?: LocalFileRow }> {
    const done = this.fulfilled.get(requestId);
    if (done) return { status: 'duplicate', file: done.file };
    const p = this.pending.get(requestId);
    const target = p ?? this.expired.get(requestId);
    if (!target) return { status: 'unknown' };
    const file = await this.files.saveShot({
      session: target.session,
      slotIndex: target.slotIndex,
      takeNumber: target.takeNumber,
      bytes,
      source: 'tablet',
      capturedAt,
    });
    this.fulfilled.set(requestId, { file, at: Date.now() });
    this.expired.delete(requestId);
    for (const [id, f] of this.fulfilled)
      if (Date.now() - f.at > 3_600_000) this.fulfilled.delete(id);
    if (p) this.settle(p, file);
    return { status: 'stored', file };
  }

  // --- kiosk sockets + signaling relay ---

  attachKiosk(socket: WebSocket) {
    this.kioskSockets.add(socket);
    socket.send(JSON.stringify({ type: 'camera', camera: this.state() } satisfies AgentToKiosk));
    socket.on('close', () => this.kioskSockets.delete(socket));
  }

  relayFromKiosk(peerId: string, data: Extract<AgentToCamera, { type: 'signal' }>['data']) {
    this.sendCamera({ type: 'signal', peerId, data });
  }

  peerClosed(peerId: string) {
    this.sendCamera({ type: 'peer-closed', peerId });
  }

  broadcastKiosk(msg: AgentToKiosk) {
    const raw = JSON.stringify(msg);
    for (const s of this.kioskSockets) if (s.readyState === s.OPEN) s.send(raw);
  }
}
