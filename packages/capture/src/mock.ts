import { canvasToBlob } from './canvas';
import { StatusEmitter } from './status';
import { CaptureError, type CaptureSource, type CapturedImage } from './types';

export type MockSourceOptions = {
  width?: number;
  height?: number;
  /** Static image used for every still. When omitted, a generated test pattern is drawn. */
  imageUrl?: string;
  /** Simulated connect/capture latency. */
  latencyMs?: number;
};

export type MockCaptureSource = CaptureSource & {
  /** Simulates the camera being unplugged. */
  simulateDisconnect(): void;
  /** Makes the next capture() reject. */
  failNextCapture(): void;
};

const COLORS = ['#ec4899', '#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444'];

/**
 * Deterministic camera for tests and dev without a webcam.
 * Works in browsers (canvas preview + stills). Without a DOM, capture() returns a tiny placeholder blob.
 */
export function createMockSource(opts: MockSourceOptions = {}): MockCaptureSource {
  const emitter = new StatusEmitter();
  const width = opts.width ?? 1920;
  const height = opts.height ?? 1080;
  const latency = opts.latencyMs ?? 0;
  let previewCanvas: HTMLCanvasElement | null = null;
  let stream: MediaStream | null = null;
  let raf: ReturnType<typeof setInterval> | null = null;
  let image: HTMLImageElement | null = null;
  let failNext = false;

  const hasDom = typeof document !== 'undefined';
  const wait = () => (latency > 0 ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve());

  const draw = (ctx: CanvasRenderingContext2D, label: string, t: number) => {
    if (image?.complete && image.naturalWidth > 0) {
      ctx.drawImage(image, 0, 0, width, height);
    } else {
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, '#1e1b4b');
      g.addColorStop(1, '#831843');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      // Asymmetric marker so mirroring is visible.
      ctx.fillStyle = '#facc15';
      ctx.fillRect(width * 0.06, height * 0.08, width * 0.12, height * 0.12);
      const cx = width / 2 + Math.sin(t / 600) * width * 0.15;
      ctx.fillStyle = COLORS[Math.floor(t / 1000) % COLORS.length]!;
      ctx.beginPath();
      ctx.arc(cx, height / 2, height * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(height * 0.08)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(label, width * 0.06, height * 0.9);
  };

  const stopPreview = () => {
    if (raf) clearInterval(raf);
    raf = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };

  const source: MockCaptureSource = {
    id: 'mock',
    async connect() {
      if (emitter.status === 'connected') return;
      emitter.set(emitter.status === 'error' ? 'reconnecting' : 'connecting');
      await wait();
      if (hasDom && opts.imageUrl && !image) {
        image = new Image();
        image.crossOrigin = 'anonymous';
        image.src = opts.imageUrl;
        await image.decode().catch(() => undefined);
      }
      emitter.set('connected');
    },
    async getPreviewStream() {
      if (emitter.status !== 'connected') {
        throw new CaptureError('not-connected', 'Kamera belum terhubung.');
      }
      if (stream) return stream;
      if (!hasDom) throw new CaptureError('unsupported', 'Preview mock butuh DOM.');
      previewCanvas = document.createElement('canvas');
      previewCanvas.width = Math.round(width / 2);
      previewCanvas.height = Math.round(height / 2);
      const ctx = previewCanvas.getContext('2d');
      if (!ctx || typeof previewCanvas.captureStream !== 'function') {
        throw new CaptureError('unsupported', 'captureStream tidak tersedia.');
      }
      ctx.scale(0.5, 0.5);
      const tick = () => draw(ctx, 'MOCK', Date.now());
      tick();
      raf = setInterval(tick, 1000 / 30);
      stream = previewCanvas.captureStream(30);
      return stream;
    },
    async capture({ shotIndex }): Promise<CapturedImage> {
      await wait();
      if (emitter.status !== 'connected') {
        throw new CaptureError('disconnected', 'Kamera terputus.');
      }
      if (failNext) {
        failNext = false;
        throw new CaptureError('capture-failed', 'Gagal mengambil foto (simulasi).');
      }
      let blob: Blob;
      if (hasDom) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new CaptureError('unsupported', 'Canvas 2D tidak tersedia.');
        draw(ctx, `FOTO ${shotIndex}`, Date.now());
        blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
      } else {
        blob = new Blob([`mock-shot-${shotIndex}`], { type: 'image/jpeg' });
      }
      return {
        blob,
        width,
        height,
        mimeType: 'image/jpeg',
        shotIndex,
        capturedAt: new Date().toISOString(),
        sourceId: 'mock',
      };
    },
    status: () => emitter.status,
    lastError: () => emitter.lastError,
    onStatusChange: (listener) => emitter.subscribe(listener),
    async disconnect() {
      stopPreview();
      emitter.set('idle');
    },
    simulateDisconnect() {
      stopPreview();
      emitter.set('error', new CaptureError('disconnected', 'Kamera terputus (simulasi).'));
    },
    failNextCapture() {
      failNext = true;
    },
  };
  return source;
}
