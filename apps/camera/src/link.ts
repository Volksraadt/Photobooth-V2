import {
  CAMERA_PROTOCOL_VERSION,
  PREVIEW_ENCODING,
  type AgentToCamera,
  type CameraInfo,
  type CameraPairingPayload,
  type CameraPairResponse,
  type CameraToAgent,
  type SignalData,
} from '@pb/capture/protocol';
import type { CameraMedia, StillResult } from './media';
import { UploadQueue } from './upload-queue';

export const APP_VERSION = '0.3.0';

export type Pairing = {
  hosts: string[];
  port: number;
  token: string;
  cameraId: string;
  agentId: string;
};

export type LinkStatus =
  | { state: 'connecting'; attempt: number; host: string | null }
  | { state: 'connected'; host: string }
  | { state: 'unpaired'; message: string };

export type LinkEvent =
  | { type: 'status'; status: LinkStatus }
  | { type: 'shot'; requestId: string; result: StillResult; confirmed: boolean }
  | { type: 'error'; message: string }
  | { type: 'peer'; state: RTCPeerConnectionState | 'closed' };

/** Parses the kiosk's pairing QR (JSON). Exported for tests. */
export function parsePairingPayload(text: string): CameraPairingPayload | null {
  try {
    const p = JSON.parse(text) as Partial<CameraPairingPayload>;
    if (
      p.t !== 'pb-camera' ||
      p.v !== CAMERA_PROTOCOL_VERSION ||
      !Array.isArray(p.hosts) ||
      typeof p.port !== 'number' ||
      typeof p.code !== 'string' ||
      typeof p.agentId !== 'string'
    ) {
      return null;
    }
    return p as CameraPairingPayload;
  } catch {
    return null;
  }
}

/** Exchanges the one-time code for a camera token; tries every host of the QR. */
export async function pairWithAgent(
  payload: CameraPairingPayload,
  device: { name: string; platform: string },
): Promise<Pairing> {
  let lastError = 'Agent tidak dapat dihubungi';
  for (const host of payload.hosts) {
    try {
      const res = await fetch(`http://${host}:${payload.port}/camera/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: payload.code, name: device.name, platform: device.platform }),
        signal: AbortSignal.timeout(5000),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<CameraPairResponse> & {
        message?: string;
      };
      if (!res.ok || !body.token) {
        lastError = body.message ?? `Pairing ditolak (HTTP ${res.status})`;
        if (res.status === 403) break;
        continue;
      }
      // The reachable host first for later connections.
      const hosts = [host, ...payload.hosts.filter((h) => h !== host)];
      return {
        hosts,
        port: payload.port,
        token: body.token,
        cameraId: body.cameraId!,
        agentId: body.agentId!,
      };
    } catch (err) {
      lastError = `${host}: ${String(err)}`;
    }
  }
  throw new Error(lastError);
}

/** Agent sends a ping every 2 s; silence for this long means the link is dead. */
const SILENCE_MS = 6000;

/**
 * Tablet ↔ agent: control socket with automatic reconnect, WebRTC sender (one peer per kiosk
 * viewer), capture handling with a persisted upload queue. A photo is deleted from the tablet
 * only after the agent confirmed it is stored.
 */
export class CameraLink {
  private ws: WebSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private hostIndex = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private peers = new Map<string, RTCPeerConnection>();
  private readonly listeners = new Set<(e: LinkEvent) => void>();
  private handled = new Set<string>();
  private uploading = new Set<string>();
  readonly queue = new UploadQueue();
  private offTrack: (() => void) | null = null;
  /** Test hook: blocks reconnection until this time (simulated Wi-Fi outage). */
  blockedUntil = 0;
  /** Test hook: go offline right after the next still is taken, before its upload. */
  private outageAfterShotMs = 0;

  constructor(
    private pairing: Pairing,
    private readonly media: CameraMedia,
    private readonly device: { name: string; platform: string },
  ) {}

  on(listener: (e: LinkEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: LinkEvent) {
    for (const l of [...this.listeners]) l(e);
  }

  get hosts() {
    return this.pairing.hosts;
  }

  async start() {
    this.stopped = false;
    await this.queue.load();
    this.offTrack = this.media.onTrack((track) => this.replaceTrack(track));
    this.open();
  }

  stop() {
    this.stopped = true;
    this.offTrack?.();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.ws?.close();
    this.ws = null;
    for (const pc of this.peers.values()) pc.close();
    this.peers.clear();
  }

  /** Next capture: the photo is taken, then the network drops for `ms` before the upload. */
  simulateOutageAfterNextShot(ms: number) {
    this.outageAfterShotMs = ms;
  }

  /** Simulates a Wi-Fi outage of `ms` (dev/test): drops everything and stays away. */
  simulateOutage(ms: number) {
    this.blockedUntil = Date.now() + ms;
    this.ws?.close();
  }

  private host(): string {
    return this.pairing.hosts[this.hostIndex % this.pairing.hosts.length]!;
  }

  private info(): CameraInfo {
    return {
      cameraId: this.pairing.cameraId,
      name: this.device.name,
      platform: this.device.platform,
      appVersion: APP_VERSION,
      facing: this.media.currentFacing,
      photoWidth: this.media.photoSize?.width,
      photoHeight: this.media.photoSize?.height,
    };
  }

  private open() {
    if (this.stopped) return;
    const wait = this.blockedUntil - Date.now();
    if (wait > 0) {
      this.retryTimer = setTimeout(() => this.open(), wait);
      return;
    }
    const host = this.host();
    this.emit({ type: 'status', status: { state: 'connecting', attempt: this.attempt, host } });
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://${host}:${this.pairing.port}/camera/ws`);
    } catch {
      return this.scheduleReconnect();
    }
    this.ws = ws;
    ws.onopen = () => {
      const hello: CameraToAgent = {
        type: 'hello',
        token: this.pairing.token,
        info: this.info(),
        pendingRequestIds: this.queue.ids(),
      };
      ws.send(JSON.stringify(hello));
      this.armSilence();
    };
    ws.onmessage = (e) => {
      this.armSilence();
      let msg: AgentToCamera;
      try {
        msg = JSON.parse(String(e.data)) as AgentToCamera;
      } catch {
        return;
      }
      void this.onMessage(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
      // The kiosk renegotiates after we are back; old peers are useless.
      for (const pc of this.peers.values()) pc.close();
      this.peers.clear();
      if (e.code === 4401) {
        this.emit({
          type: 'status',
          status: { state: 'unpaired', message: 'Tablet tidak dikenal agent; pasangkan ulang.' },
        });
        this.stopped = true;
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    this.attempt++;
    this.hostIndex++;
    this.emit({
      type: 'status',
      status: { state: 'connecting', attempt: this.attempt, host: this.host() },
    });
    // Fast first retries: short Wi-Fi blips should be invisible.
    const delay = Math.min(3000, 300 * 2 ** Math.min(this.attempt - 1, 4));
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private armSilence() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => this.ws?.close(), SILENCE_MS);
  }

  private send(msg: CameraToAgent) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Re-announces device info (facing switch, photo size). */
  announce() {
    this.send({ type: 'info', info: this.info() });
  }

  private async onMessage(msg: AgentToCamera) {
    switch (msg.type) {
      case 'welcome':
        this.attempt = 0;
        this.emit({ type: 'status', status: { state: 'connected', host: this.host() } });
        void this.flushUploads();
        break;
      case 'ping':
        this.send({ type: 'pong', t: msg.t });
        break;
      case 'capture':
        await this.onCapture(msg.requestId);
        break;
      case 'signal':
        await this.onSignal(msg.peerId, msg.data);
        break;
      case 'peer-closed':
        this.peers.get(msg.peerId)?.close();
        this.peers.delete(msg.peerId);
        this.emit({ type: 'peer', state: 'closed' });
        break;
    }
  }

  // --- capture + upload ---

  private async onCapture(requestId: string) {
    // Same request again (re-sent after a reconnect): only (re)upload, never shoot twice.
    if (this.handled.has(requestId)) {
      const pending = this.queue.get(requestId);
      if (pending) void this.upload(pending);
      return;
    }
    this.handled.add(requestId);
    let result: StillResult;
    try {
      result = await this.media.still();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.send({ type: 'capture-error', requestId, message: `Kamera tablet gagal: ${message}` });
      this.emit({ type: 'error', message });
      return;
    }
    const item = { requestId, blob: result.blob, capturedAt: new Date().toISOString() };
    await this.queue.add(item);
    this.emit({ type: 'shot', requestId, result, confirmed: false });
    if (this.outageAfterShotMs > 0) {
      const ms = this.outageAfterShotMs;
      this.outageAfterShotMs = 0;
      this.simulateOutage(ms);
      return; // uploaded from the queue after the reconnect
    }
    const ok = await this.upload(item);
    if (ok) this.emit({ type: 'shot', requestId, result, confirmed: true });
  }

  private async flushUploads() {
    for (const item of this.queue.all()) await this.upload(item);
  }

  /** POST until the agent confirms (200) or says it does not know the request (409). */
  private async upload(item: {
    requestId: string;
    blob: Blob;
    capturedAt: string;
  }): Promise<boolean> {
    if (this.uploading.has(item.requestId)) return false;
    this.uploading.add(item.requestId);
    try {
      for (let attempt = 0; !this.stopped; attempt++) {
        if (Date.now() < this.blockedUntil || this.ws?.readyState !== WebSocket.OPEN) {
          // Offline: the next `welcome` flushes the queue.
          return false;
        }
        try {
          const res = await fetch(
            `http://${this.host()}:${this.pairing.port}/camera/shots?requestId=${encodeURIComponent(item.requestId)}`,
            {
              method: 'POST',
              headers: {
                authorization: `Bearer ${this.pairing.token}`,
                'content-type': item.blob.type || 'image/jpeg',
                'x-pb-captured-at': item.capturedAt,
              },
              body: item.blob,
              signal: AbortSignal.timeout(30_000),
            },
          );
          if (res.ok || res.status === 409) {
            await this.queue.remove(item.requestId);
            return res.ok;
          }
          if (res.status === 401) return false;
        } catch {
          // network hiccup: retry
        }
        await new Promise((r) => setTimeout(r, Math.min(3000, 400 * (attempt + 1))));
      }
      return false;
    } finally {
      this.uploading.delete(item.requestId);
    }
  }

  // --- WebRTC (sender) ---

  private replaceTrack(track: MediaStreamTrack | null) {
    for (const pc of this.peers.values()) {
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind === 'video' || sender.track === null)
          void sender.replaceTrack(track);
      }
    }
  }

  private async onSignal(peerId: string, data: SignalData) {
    if (data.kind === 'offer') {
      this.peers.get(peerId)?.close();
      const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
      this.peers.set(peerId, pc);
      pc.onicecandidate = (e) =>
        this.send({
          type: 'signal',
          peerId,
          data: { kind: 'candidate', candidate: e.candidate ? e.candidate.toJSON() : null },
        });
      pc.onconnectionstatechange = () => this.emit({ type: 'peer', state: pc.connectionState });
      await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      const transceiver =
        pc.getTransceivers().find((t) => t.receiver.track.kind === 'video') ??
        pc.addTransceiver('video');
      transceiver.direction = 'sendonly';
      preferHardwareCodec(transceiver);
      const track = this.media.track;
      if (track) await transceiver.sender.replaceTrack(track);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.send({ type: 'signal', peerId, data: { kind: 'answer', sdp: answer.sdp ?? '' } });
      await tuneSender(transceiver.sender);
    } else if (data.kind === 'candidate' && data.candidate) {
      await this.peers
        .get(peerId)
        ?.addIceCandidate(data.candidate)
        .catch(() => undefined);
    }
  }
}

/** H.264 first (hardware encoder on iPad/Android = lower latency), VP8 as fallback. */
function preferHardwareCodec(transceiver: RTCRtpTransceiver) {
  const caps = typeof RTCRtpSender !== 'undefined' ? RTCRtpSender.getCapabilities?.('video') : null;
  if (!caps || !transceiver.setCodecPreferences) return;
  const rank = (mime: string) => (mime === 'video/H264' ? 0 : mime === 'video/VP8' ? 1 : 2);
  const codecs = [...caps.codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType));
  try {
    transceiver.setCodecPreferences(codecs);
  } catch {
    // keep defaults
  }
}

/** Preview encoding for low latency on a local Wi-Fi (see PREVIEW_ENCODING). */
async function tuneSender(sender: RTCRtpSender) {
  const params = sender.getParameters();
  const track = sender.track;
  const settings = track?.getSettings();
  const scale =
    settings?.width && settings.width > PREVIEW_ENCODING.maxWidth
      ? settings.width / PREVIEW_ENCODING.maxWidth
      : 1;
  params.encodings = (params.encodings?.length ? params.encodings : [{}]).map((e) => ({
    ...e,
    maxBitrate: PREVIEW_ENCODING.maxBitrate,
    maxFramerate: PREVIEW_ENCODING.maxFramerate,
    scaleResolutionDownBy: scale,
  }));
  (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference =
    'maintain-framerate';
  try {
    await sender.setParameters(params);
  } catch (err) {
    console.warn('[camera] setParameters failed', err);
  }
}
