import { StatusEmitter } from './status';
import { CaptureError, type CaptureSource, type CapturedImage } from './types';
import { canvasToBlob } from './canvas';

export type WebcamSourceOptions = {
  deviceId?: string;
  /** Requested capture size; the browser picks the closest the camera supports. */
  idealWidth?: number;
  idealHeight?: number;
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
  quality?: number;
};

/** Laptop/USB webcam via getUserMedia. Stills are grabbed from the live track at its native size. */
export function createWebcamSource(opts: WebcamSourceOptions = {}): CaptureSource {
  const emitter = new StatusEmitter();
  const mimeType = opts.mimeType ?? 'image/jpeg';
  const quality = opts.quality ?? 0.92;
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  let connecting: Promise<void> | null = null;

  const fail = (err: CaptureError) => {
    emitter.set('error', err);
  };

  const onTrackEnded = () =>
    fail(new CaptureError('disconnected', 'Kamera terputus (perangkat dicabut atau dimatikan).'));

  const release = () => {
    if (stream) {
      for (const track of stream.getTracks()) {
        track.removeEventListener('ended', onTrackEnded);
        track.stop();
      }
    }
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    stream = null;
    video = null;
  };

  const onDeviceChange = () => {
    const track = stream?.getVideoTracks()[0];
    if (emitter.status === 'connected' && (!track || track.readyState === 'ended')) onTrackEnded();
  };

  const open = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CaptureError('unsupported', 'Browser tidak mendukung akses kamera.');
    }
    release();
    emitter.set(emitter.status === 'error' ? 'reconnecting' : 'connecting');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
          width: { ideal: opts.idealWidth ?? 1920 },
          height: { ideal: opts.idealHeight ?? 1080 },
        },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      const error =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? new CaptureError('permission-denied', 'Akses kamera ditolak.', { cause: err })
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? new CaptureError('not-found', 'Kamera tidak ditemukan.', { cause: err })
            : new CaptureError('disconnected', 'Kamera tidak dapat dibuka.', { cause: err });
      fail(error);
      throw error;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      release();
      const error = new CaptureError('not-found', 'Kamera tidak mengirim video.');
      fail(error);
      throw error;
    }
    track.addEventListener('ended', onTrackEnded);
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    navigator.mediaDevices.addEventListener?.('devicechange', onDeviceChange);
    emitter.set('connected');
  };

  return {
    id: 'webcam',
    connect() {
      if (emitter.status === 'connected') return Promise.resolve();
      connecting ??= open().finally(() => {
        connecting = null;
      });
      return connecting;
    },
    async getPreviewStream() {
      if (emitter.status !== 'connected' || !stream) {
        throw new CaptureError('not-connected', 'Kamera belum terhubung.');
      }
      return stream;
    },
    async capture({ shotIndex }): Promise<CapturedImage> {
      const track = stream?.getVideoTracks()[0];
      if (emitter.status !== 'connected' || !video || !track || track.readyState === 'ended') {
        const error = new CaptureError('disconnected', 'Kamera terputus.');
        if (emitter.status === 'connected') fail(error);
        throw error;
      }
      if (video.readyState < 2) {
        await new Promise<void>((resolve) =>
          video!.addEventListener('loadeddata', () => resolve(), { once: true }),
        );
      }
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) throw new CaptureError('capture-failed', 'Frame kamera kosong.');
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new CaptureError('unsupported', 'Canvas 2D tidak tersedia.');
      // Original orientation: no mirroring here.
      ctx.drawImage(video, 0, 0, width, height);
      const blob = await canvasToBlob(canvas, mimeType, quality);
      return {
        blob,
        width,
        height,
        mimeType,
        shotIndex,
        capturedAt: new Date().toISOString(),
        sourceId: 'webcam',
      };
    },
    status: () => emitter.status,
    lastError: () => emitter.lastError,
    onStatusChange: (listener) => emitter.subscribe(listener),
    async disconnect() {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
      release();
      emitter.set('idle');
    },
  };
}
