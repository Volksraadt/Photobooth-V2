/**
 * Wire protocol between the local agent, the kiosk and the tablet Camera App (F3).
 *
 *   Camera App ──LAN (http + ws, port 47811)──▶ Agent ◀──127.0.0.1 (http + ws, port 47810)── Kiosk
 *
 * - Pairing: the kiosk shows a QR with {@link CameraPairingPayload}; the tablet exchanges the
 *   one-time code for a long-lived camera token (`POST /camera/pair`).
 * - Control + WebRTC signaling over WebSockets; the agent relays signaling between the kiosk
 *   (receiver) and the tablet (sender). Media flows peer-to-peer on the LAN.
 * - Full-resolution stills: `POST /camera/shots?requestId=…` (raw image body). The agent answers
 *   only after the file is stored on disk; that answer is the "confirmation".
 * Pure types/constants: imported by the agent (Node), the kiosk and the camera app (browser).
 */

export const AGENT_LOCAL_PORT = 47810;
export const AGENT_LAN_PORT = 47811;
export const CAMERA_PROTOCOL_VERSION = 1;

/** How long a tablet may be gone before the kiosk treats the camera as failed. */
export const CAMERA_RECONNECT_GRACE_MS = 60_000;

/** Preview encoding targets (low latency on a local Wi-Fi). */
export const PREVIEW_ENCODING = {
  maxWidth: 1280,
  maxHeight: 720,
  maxFramerate: 30,
  maxBitrate: 2_500_000,
} as const;

/** QR shown by the kiosk (JSON). `hosts` = every LAN IPv4 of the agent machine. */
export type CameraPairingPayload = {
  t: 'pb-camera';
  v: typeof CAMERA_PROTOCOL_VERSION;
  hosts: string[];
  port: number;
  /** One-time pairing code (expires after 10 minutes). */
  code: string;
  agentId: string;
};

export type CameraPairRequest = { code: string; name: string; platform: string };
export type CameraPairResponse = { cameraId: string; token: string; agentId: string };

export type CameraFacing = 'front' | 'back';

/** Tablet-side state reported to the agent. */
export type CameraInfo = {
  cameraId: string;
  name: string;
  platform: string;
  appVersion: string;
  facing: CameraFacing;
  /** Native still size the tablet will deliver, when known. */
  photoWidth?: number;
  photoHeight?: number;
};

// --- Camera App ⇄ Agent (ws /camera/ws) ---

export type CameraToAgent =
  | { type: 'hello'; token: string; info: CameraInfo; pendingRequestIds: string[] }
  | { type: 'info'; info: CameraInfo }
  | { type: 'signal'; peerId: string; data: SignalData }
  | { type: 'capture-error'; requestId: string; message: string }
  | { type: 'pong'; t: number };

export type AgentToCamera =
  | { type: 'welcome'; agentId: string; serverTime: number }
  | { type: 'capture'; requestId: string; shotIndex: number }
  | { type: 'signal'; peerId: string; data: SignalData }
  /** The kiosk stopped watching (peer closed). */
  | { type: 'peer-closed'; peerId: string }
  | { type: 'ping'; t: number };

export type SignalData =
  | { kind: 'offer' | 'answer'; sdp: string }
  | { kind: 'candidate'; candidate: RTCIceCandidateInitLike | null };

/** Structural copy of RTCIceCandidateInit (no DOM types in Node). */
export type RTCIceCandidateInitLike = {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

// --- Kiosk ⇄ Agent (ws /ws) ---

export type TabletCameraState =
  /** No tablet has connected since the agent started. */
  | { status: 'absent'; pairedCount: number }
  | { status: 'connected'; connectionId: string; info: CameraInfo; since: number }
  /** Was connected; the agent waits for it to come back. */
  | { status: 'disconnected'; info: CameraInfo; since: number };

export type KioskToAgent =
  | { type: 'signal'; peerId: string; data: SignalData }
  | { type: 'peer-closed'; peerId: string }
  | {
      type: 'kiosk-status';
      cameraSource: 'webcam' | 'tablet' | 'mock';
      cameraStatus: string;
      configVersion: number | null;
    };

export type AgentToKiosk =
  | { type: 'camera'; camera: TabletCameraState }
  | { type: 'signal'; peerId: string; data: SignalData }
  | { type: 'config'; version: number | null }
  | { type: 'printer'; status: PrinterStatusSummary }
  | { type: 'processing'; sessionId: string; step: ProcessingStep; progress: number };

export type ProcessingStep = 'saving' | 'composing' | 'printing' | 'done';

export type PrinterStatusSummary = {
  name: string | null;
  status: 'ok' | 'warning' | 'error' | 'disconnected' | 'unknown';
  message: string | null;
};
