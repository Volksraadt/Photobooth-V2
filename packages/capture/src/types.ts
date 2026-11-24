export type CaptureSourceId = 'webcam' | 'tablet' | 'dslr' | 'mock';

/** `idle` = not connected yet / disconnected on purpose. */
export type CaptureStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/** Full-resolution still. Never mirrored: mirroring is a display concern (camera-view, `mirrored/`). */
export type CapturedImage = {
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
  shotIndex: number;
  /** ISO 8601, UTC. */
  capturedAt: string;
  sourceId: CaptureSourceId;
};

export type CaptureStatusListener = (status: CaptureStatus, error: CaptureError | null) => void;

export interface CaptureSource {
  readonly id: CaptureSourceId;
  connect(): Promise<void>;
  /** Live preview for `camera-view`. Rejects when not connected. */
  getPreviewStream(): Promise<MediaStream>;
  capture(opts: { shotIndex: number }): Promise<CapturedImage>;
  /** F7 live clip. */
  startClip?(maxMs: number): Promise<void>;
  stopClip?(): Promise<Blob>;
  status(): CaptureStatus;
  /** Last error, when status() is `error`. */
  lastError(): CaptureError | null;
  /** Fires on every status change (e.g. webcam unplugged → `error`). Returns unsubscribe. */
  onStatusChange(listener: CaptureStatusListener): () => void;
  disconnect(): Promise<void>;
}

export type CaptureErrorCode =
  | 'permission-denied'
  | 'not-found'
  | 'disconnected'
  | 'not-connected'
  | 'capture-failed'
  | 'unsupported';

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;
  constructor(code: CaptureErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CaptureError';
    this.code = code;
  }
}
