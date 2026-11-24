import { StatusEmitter } from './status';
import {
  CAMERA_RECONNECT_GRACE_MS,
  type AgentToKiosk,
  type KioskToAgent,
  type SignalData,
  type TabletCameraState,
} from './tablet-protocol';
import { CaptureError, type CaptureSource, type CapturedImage } from './types';

/** The kiosk's connection to the local agent (WebSocket + HTTP base), provided by the host. */
export interface AgentLink {
  readonly baseUrl: string;
  send(msg: KioskToAgent): void;
  subscribe(listener: (msg: AgentToKiosk) => void): () => void;
}

export type PreviewStats = {
  /** Rough glass-to-glass estimate: jitter buffer + decode + half the round trip. */
  estimatedLatencyMs: number | null;
  jitterBufferMs: number | null;
  rttMs: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
};

export type TabletCaptureSource = CaptureSource & {
  /** Latest camera state reported by the agent. */
  tabletState(): TabletCameraState | null;
  previewStats(): Promise<PreviewStats | null>;
};

export type TabletSourceOptions = {
  agent: AgentLink;
  reconnectGraceMs?: number;
  /** Max wait in connect() for a tablet that is not there yet. */
  connectTimeoutMs?: number;
};

const peerId = () => `kiosk-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Tablet camera through the local agent (F3). Preview = WebRTC from the tablet (this side only
 * receives); stills = full-resolution photos taken natively on the tablet and stored by the agent
 * before capture() resolves. Short Wi-Fi drops show as `reconnecting`; only after the grace period
 * does the source report `error`.
 */
export function createTabletSource(opts: TabletSourceOptions): TabletCaptureSource {
  const emitter = new StatusEmitter();
  const grace = opts.reconnectGraceMs ?? CAMERA_RECONNECT_GRACE_MS;
  let tablet: TabletCameraState | null = null;
  let pc: RTCPeerConnection | null = null;
  let pcId: string | null = null;
  let pcConnection: string | null = null;
  let stream: MediaStream | null = null;
  let streamWaiters: ((s: MediaStream) => void)[] = [];
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  let active = false;
  const previewListeners = new Set<(s: MediaStream | null) => void>();

  const closePeer = () => {
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();
      if (pcId) opts.agent.send({ type: 'peer-closed', peerId: pcId });
    }
    pc = null;
    pcId = null;
    pcConnection = null;
    stream = null;
  };

  const startPeer = async (connectionId: string) => {
    closePeer();
    const id = peerId();
    const conn = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    pc = conn;
    pcId = id;
    pcConnection = connectionId;
    const transceiver = conn.addTransceiver('video', { direction: 'recvonly' });
    // Lowest latency: render frames as soon as they are decodable.
    const receiver = transceiver.receiver as RTCRtpReceiver & {
      jitterBufferTarget?: number | null;
      playoutDelayHint?: number;
    };
    try {
      receiver.jitterBufferTarget = 0;
    } catch {
      /* unsupported */
    }
    try {
      receiver.playoutDelayHint = 0;
    } catch {
      /* unsupported */
    }
    conn.ontrack = (e) => {
      if (pc !== conn) return;
      stream = e.streams[0] ?? new MediaStream([e.track]);
      const waiters = streamWaiters;
      streamWaiters = [];
      waiters.forEach((w) => w(stream!));
      for (const l of [...previewListeners]) l(stream);
    };
    conn.onicecandidate = (e) => {
      if (pc !== conn) return;
      opts.agent.send({
        type: 'signal',
        peerId: id,
        data: { kind: 'candidate', candidate: e.candidate ? e.candidate.toJSON() : null },
      });
    };
    conn.onconnectionstatechange = () => {
      if (pc !== conn) return;
      if (conn.connectionState === 'failed') {
        // ICE failed while the control channel is still up: renegotiate.
        setTimeout(() => {
          if (pc === conn && tablet?.status === 'connected') void startPeer(tablet.connectionId);
        }, 1000);
      }
    };
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    if (pc !== conn) return;
    opts.agent.send({ type: 'signal', peerId: id, data: { kind: 'offer', sdp: offer.sdp ?? '' } });
  };

  const onSignal = async (id: string, data: SignalData) => {
    const conn = pc;
    if (!conn || id !== pcId) return;
    try {
      if (data.kind === 'answer')
        await conn.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      else if (data.kind === 'candidate' && data.candidate)
        await conn.addIceCandidate(data.candidate);
    } catch (err) {
      console.warn('[tablet] signaling failed', err);
    }
  };

  const clearGrace = () => {
    if (graceTimer) clearTimeout(graceTimer);
    graceTimer = null;
  };

  const onCamera = (next: TabletCameraState) => {
    tablet = next;
    if (!active) return;
    if (next.status === 'connected') {
      clearGrace();
      if (pcConnection !== next.connectionId) void startPeer(next.connectionId);
      emitter.set('connected');
    } else if (next.status === 'disconnected') {
      closePeer();
      const left = grace - (Date.now() - next.since);
      if (left <= 0) {
        emitter.set('error', new CaptureError('disconnected', 'Kamera tablet terputus.'));
      } else {
        emitter.set('reconnecting');
        clearGrace();
        graceTimer = setTimeout(() => {
          if (tablet?.status !== 'connected') {
            emitter.set('error', new CaptureError('disconnected', 'Kamera tablet terputus.'));
          }
        }, left);
      }
    } else {
      closePeer();
      if (emitter.status !== 'error') emitter.set('connecting');
    }
  };

  const waitConnected = (timeoutMs: number) =>
    new Promise<void>((resolve, reject) => {
      if (emitter.status === 'connected') return resolve();
      const t = setTimeout(() => {
        off();
        reject(
          emitter.lastError ??
            new CaptureError(
              'not-connected',
              'Kamera tablet belum tersambung. Buka aplikasi kamera di tablet.',
            ),
        );
      }, timeoutMs);
      const off = emitter.subscribe((s, err) => {
        if (s === 'connected') {
          clearTimeout(t);
          off();
          resolve();
        } else if (s === 'error') {
          clearTimeout(t);
          off();
          reject(err ?? new CaptureError('disconnected', 'Kamera tablet terputus.'));
        }
      });
    });

  const source: TabletCaptureSource = {
    id: 'tablet',
    async connect() {
      if (!active) {
        active = true;
        emitter.set('connecting');
        unsubscribe = opts.agent.subscribe((msg) => {
          if (msg.type === 'camera') onCamera(msg.camera);
          else if (msg.type === 'signal') void onSignal(msg.peerId, msg.data);
        });
        if (tablet) onCamera(tablet);
      }
      // A briefly-away tablet counts as "still coming": wait through the grace period.
      const wait = emitter.status === 'reconnecting' ? grace : (opts.connectTimeoutMs ?? 15_000);
      await waitConnected(wait);
    },
    async getPreviewStream() {
      if (emitter.status !== 'connected') {
        throw new CaptureError('not-connected', 'Kamera tablet belum tersambung.');
      }
      if (stream) return stream;
      return new Promise<MediaStream>((resolve, reject) => {
        const t = setTimeout(
          () => reject(new CaptureError('not-connected', 'Preview tablet belum tersedia.')),
          10_000,
        );
        streamWaiters.push((s) => {
          clearTimeout(t);
          resolve(s);
        });
      });
    },
    async capture({ shotIndex, session }): Promise<CapturedImage> {
      if (!session) {
        throw new CaptureError('capture-failed', 'Tablet butuh data sesi untuk menyimpan foto.');
      }
      if (emitter.status === 'error' || emitter.status === 'idle') {
        throw emitter.lastError ?? new CaptureError('disconnected', 'Kamera tablet terputus.');
      }
      let res: Response;
      try {
        res = await fetch(
          `${opts.agent.baseUrl}/sessions/${encodeURIComponent(session.id)}/capture`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              code: session.code,
              boothId: session.boothId,
              configVersion: session.configVersion,
              startedAt: session.startedAt,
              slotIndex: shotIndex,
              takeNumber: session.takeNumber,
            }),
          },
        );
      } catch (err) {
        throw new CaptureError('disconnected', 'Agent tidak dapat dihubungi.', { cause: err });
      }
      const body = (await res.json().catch(() => ({}))) as {
        photoId?: string;
        url?: string;
        width?: number;
        height?: number;
        mimeType?: string;
        capturedAt?: string;
        message?: string;
      };
      if (!res.ok || !body.photoId || !body.url) {
        throw new CaptureError(
          res.status === 503 ? 'disconnected' : 'capture-failed',
          body.message ?? `Gagal mengambil foto dari tablet (HTTP ${res.status}).`,
        );
      }
      return {
        blob: null,
        stored: { photoId: body.photoId, url: body.url },
        width: body.width ?? 0,
        height: body.height ?? 0,
        mimeType: body.mimeType ?? 'image/jpeg',
        shotIndex,
        capturedAt: body.capturedAt ?? new Date().toISOString(),
        sourceId: 'tablet',
      };
    },
    status: () => emitter.status,
    lastError: () => emitter.lastError,
    onStatusChange: (listener) => emitter.subscribe(listener),
    async disconnect() {
      active = false;
      clearGrace();
      unsubscribe?.();
      unsubscribe = null;
      closePeer();
      emitter.set('idle');
    },
    onPreviewChange(listener) {
      previewListeners.add(listener);
      return () => previewListeners.delete(listener);
    },
    tabletState: () => tablet,
    async previewStats() {
      const conn = pc;
      if (!conn) return null;
      const report = await conn.getStats();
      let inbound: Record<string, number | string> | null = null;
      let pair: Record<string, number | string> | null = null;
      const codecs = new Map<string, string>();
      report.forEach((s: Record<string, number | string>) => {
        if (s.type === 'inbound-rtp' && s.kind === 'video') inbound = s;
        if (s.type === 'candidate-pair' && (s.nominated || s.state === 'succeeded')) pair = s;
        if (s.type === 'codec') codecs.set(String(s.id), String(s.mimeType));
      });
      const ib = inbound as Record<string, number | string> | null;
      const cp = pair as Record<string, number | string> | null;
      const num = (v: unknown) => (typeof v === 'number' ? v : null);
      const emitted = num(ib?.jitterBufferEmittedCount);
      const jitter =
        emitted && num(ib?.jitterBufferDelay) !== null
          ? (num(ib?.jitterBufferDelay)! / emitted) * 1000
          : null;
      const decoded = num(ib?.framesDecoded);
      const decode =
        decoded && num(ib?.totalDecodeTime) !== null
          ? (num(ib?.totalDecodeTime)! / decoded) * 1000
          : null;
      const rtt =
        num(cp?.currentRoundTripTime) !== null ? num(cp?.currentRoundTripTime)! * 1000 : null;
      return {
        jitterBufferMs: jitter,
        rttMs: rtt,
        fps: num(ib?.framesPerSecond),
        width: num(ib?.frameWidth),
        height: num(ib?.frameHeight),
        codec: ib?.codecId ? (codecs.get(String(ib.codecId)) ?? null) : null,
        estimatedLatencyMs:
          jitter !== null
            ? Math.round(
                jitter + (decode ?? 0) + (rtt ?? 0) / 2 + 33 /* capture + encode, ~1 frame */,
              )
            : null,
      };
    },
  };
  return source;
}
