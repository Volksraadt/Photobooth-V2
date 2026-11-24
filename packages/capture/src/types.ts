export type CaptureSourceId = 'webcam' | 'tablet' | 'dslr' | 'mock';

/** `idle` = not connected yet / disconnected on purpose. */
export type CaptureStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/** Where a capture belongs; sources that store stills themselves (tablet via agent) need it. */
export type CaptureSessionContext = {
  id: string;
  code: string;
  boothId: string;
  configVersion: number;
  /** ISO 8601, UTC. */
  startedAt: string;
  takeNumber: number;
};

/** Full-resolution still. Never mirrored: mirroring is a display concern (camera-view, `mirrored/`). */
export type CapturedImage = {
  /** Image bytes; null when the source already stored the file (see `stored`). */
  blob: Blob | null;
  /** Set by sources that persist stills themselves (tablet: saved by the local agent). */
  stored?: { photoId: string; url: string };
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
  capture(opts: { shotIndex: number; session?: CaptureSessionContext }): Promise<CapturedImage>;
  /** Fires when the preview stream object changes while connected (e.g. WebRTC renegotiated). */
  onPreviewChange?(listener: (stream: MediaStream | null) => void): () => void;
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
