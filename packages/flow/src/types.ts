import type { BoothConfig, PageType, PaymentMethod } from '@pb/schema';

/** A stored still, referenced by id. Binary data lives outside the machine (kiosk photo store). */
export type ShotPhoto = {
  id: string;
  /** Displayable URL (object URL, agent URL, ...). */
  url: string;
  width: number;
  height: number;
};

export type Shot = {
  slotIndex: number;
  /** 1 = first take; increments on every retake of the slot. */
  takeNumber: number;
  photo: ShotPhoto;
  /** ISO 8601, UTC. */
  capturedAt: string;
};

export type SessionPaymentMethod = PaymentMethod | 'free';

export type FlowSession = {
  id: string;
  /** 8 chars, see generateSessionCode(). */
  code: string;
  /** ISO 8601, UTC. */
  startedAt: string;
  frameId: string | null;
  /** Free session (event mode or admin): payment is skipped. */
  free: boolean;
  paid: boolean;
  paymentMethod: SessionPaymentMethod | null;
  paymentId: string | null;
  qrString: string | null;
  /** ISO 8601, UTC. */
  paymentExpiresAt: string | null;
  /** Selected take per slot; index = slotIndex - 1. */
  shots: (Shot | null)[];
  /** Every take, including replaced ones (session_shots.take_number). */
  takes: Shot[];
  filterId: string;
  extraPrints: number;
  downloadUrl: string | null;
  completedAt: string | null;
};

export type FlowErrorKind = 'camera' | 'payment' | 'processing' | 'unknown';

export type FlowError = {
  kind: FlowErrorKind;
  message: string;
  /** Where a paid session resumes when the buyer leaves the error page. */
  resumeTo: 'capture' | 'processing' | null;
};

export type FlowTimings = {
  /** Interval between countdown numbers. */
  countdownTickMs: number;
  /** How long a fresh shot stays highlighted before the next countdown. */
  shotPreviewMs: number;
  /** Capture page without a next/confirm button: auto-continue after the last shot. */
  captureAutoFinishMs: number;
};

export const DEFAULT_FLOW_TIMINGS: FlowTimings = {
  countdownTickMs: 1000,
  shotPreviewMs: 1200,
  captureAutoFinishMs: 3000,
};

export type FlowContext = {
  config: BoothConfig;
  /** Applied when the flow next returns to Cover (never mid-session). */
  pendingConfig: BoothConfig | null;
  timings: FlowTimings;
  page: PageType | null;
  session: FlowSession | null;
  slideIndex: number;
  /** Slot currently being captured / highlighted. */
  activeSlot: number | null;
  /** True while re-shooting a single slot. */
  retaking: boolean;
  countdown: number | null;
  /** 0..1 while processing. */
  progress: number | null;
  error: FlowError | null;
  /** Increments on every shot; drives the flash effect. */
  shotCounter: number;
};

export type FlowInput = {
  config: BoothConfig;
  timings?: Partial<FlowTimings>;
};

export type FlowEvent =
  | { type: 'START' }
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'CONFIRM' }
  | { type: 'FINISH' }
  | { type: 'SELECT_FRAME'; frameId: string }
  | { type: 'SELECT_FILTER'; filterId: string }
  | { type: 'SELECT_PAYMENT'; method: PaymentMethod }
  | { type: 'RETAKE'; shotIndex?: number }
  | { type: 'RETAKE_ALL' }
  | { type: 'ADD_PRINT' }
  | { type: 'REMOVE_PRINT' }
  | { type: 'PAYMENT.PAID'; paymentId?: string }
  | { type: 'PAYMENT.FAILED'; message?: string }
  | { type: 'CAMERA.ERROR'; message?: string }
  | { type: 'PROCESSING.PROGRESS'; progress: number }
  | { type: 'PROCESSING.DONE'; downloadUrl: string }
  | { type: 'PROCESSING.FAILED'; message?: string }
  /** Any buyer touch: restarts the idle timer. */
  | { type: 'ACTIVITY' }
  | { type: 'IDLE.TIMEOUT' }
  /** Unexpected failure reported by the host (render crash, ...). */
  | { type: 'FAIL'; kind?: FlowErrorKind; message: string }
  | { type: 'CONFIG.UPDATE'; config: BoothConfig }
  | { type: 'ADMIN.OPEN' }
  | { type: 'ADMIN.CLOSE' }
  | { type: 'ADMIN.FREE_SESSION' };

// --- Actor contracts (implemented by the host: kiosk, Studio preview, tests) ---

export type CreatePaymentInput = {
  sessionId: string;
  sessionCode: string;
  amount: number;
  expirySec: number;
};
export type CreatePaymentOutput = {
  paymentId: string;
  qrString: string;
  /** ISO 8601, UTC. */
  expiresAt: string;
};

export type CaptureShotInput = {
  sessionId: string;
  sessionCode: string;
  /** ISO 8601, UTC. */
  startedAt: string;
  boothId: string;
  configVersion: number;
  slotIndex: number;
  takeNumber: number;
};

export type ProcessSessionInput = { config: BoothConfig; session: FlowSession };
