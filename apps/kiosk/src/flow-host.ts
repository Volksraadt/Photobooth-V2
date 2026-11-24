import type { CaptureSource, CapturedImage } from '@pb/capture';
import {
  flowMachine,
  sessionTotal,
  type CaptureShotInput,
  type CreatePaymentInput,
  type FlowEvent,
  type ProcessSessionInput,
  type ShotPhoto,
} from '@pb/flow';
import { fromCallback, fromPromise } from 'xstate';
import type { AgentClient } from './agent/agent-client';
import { mockPayments } from './mock-payment';
import type { PhotoStore } from './photo-store';
import { saveSession, type StoredSession } from './session-store';

export type KioskFlowDeps = {
  camera: CaptureSource;
  photos: PhotoStore;
  shortLinkBase: string;
  /** Local agent (F3): stores shots, composes, prints. Null = browser-only fallback (F1). */
  agent: AgentClient | null;
};

/** Simulated print time without an agent (browser-only mode). */
const PRINT_SIMULATION_MS = 1500;

async function storeShot(
  deps: KioskFlowDeps,
  input: CaptureShotInput,
  image: CapturedImage,
): Promise<ShotPhoto> {
  const { photos, agent } = deps;
  if (image.stored) {
    return photos.addStored(input.sessionId, input.slotIndex, input.takeNumber, {
      ...image.stored,
      width: image.width,
      height: image.height,
      mimeType: image.mimeType,
      capturedAt: image.capturedAt,
    });
  }
  if (!image.blob) throw new Error('Kamera tidak mengirim foto.');
  if (agent) {
    const shot = await agent.uploadShot({
      session: {
        id: input.sessionId,
        code: input.sessionCode,
        boothId: input.boothId,
        configVersion: input.configVersion,
        startedAt: input.startedAt,
      },
      slotIndex: input.slotIndex,
      takeNumber: input.takeNumber,
      blob: image.blob,
      source: image.sourceId === 'mock' ? 'mock' : 'webcam',
      capturedAt: image.capturedAt,
    });
    return photos.addStored(input.sessionId, input.slotIndex, input.takeNumber, {
      ...shot,
      capturedAt: shot.capturedAt ?? image.capturedAt,
    });
  }
  return photos.add(input.sessionId, input.slotIndex, input.takeNumber, {
    ...image,
    blob: image.blob,
  });
}

/** Browser-only processing (no agent): keep the session in IndexedDB, simulate printing. */
async function processInBrowser(
  deps: KioskFlowDeps,
  { config, session }: ProcessSessionInput,
  send: (e: FlowEvent) => void,
) {
  const downloadUrl = `${deps.shortLinkBase}/s/${session.code}`;
  send({ type: 'PROCESSING.PROGRESS', progress: 0.1 });
  const stored = deps.photos.forSession(session.id);
  const selected = new Set(session.shots.map((s) => s?.photo.id));
  const record: StoredSession = {
    id: session.id,
    code: session.code,
    boothId: config.boothId,
    configVersion: config.configVersion,
    frameId: session.frameId,
    filterId: session.filterId,
    paymentMethod: session.paymentMethod,
    amount: sessionTotal(config, session),
    extraPrints: session.extraPrints,
    downloadUrl,
    startedAt: session.startedAt,
    savedAt: new Date().toISOString(),
    shots: stored.map((p) => ({
      photoId: p.id,
      slotIndex: p.slotIndex,
      takeNumber: p.takeNumber,
      selected: selected.has(p.id),
      width: p.width,
      height: p.height,
      mimeType: p.mimeType,
      capturedAt: p.capturedAt,
    })),
  };
  await saveSession(
    record,
    stored.flatMap((p) => (p.blob ? [{ id: p.id, blob: p.blob }] : [])),
  );
  send({ type: 'PROCESSING.PROGRESS', progress: 0.5 });
  await new Promise((r) => setTimeout(r, PRINT_SIMULATION_MS));
  send({ type: 'PROCESSING.PROGRESS', progress: 1 });
  send({ type: 'PROCESSING.DONE', downloadUrl });
}

/** Agent processing: strip from the stored originals → sheet → print; all kept on disk. */
async function processWithAgent(
  agent: AgentClient,
  deps: KioskFlowDeps,
  { config, session }: ProcessSessionInput,
  send: (e: FlowEvent) => void,
) {
  const downloadUrl = `${deps.shortLinkBase}/s/${session.code}`;
  const off = agent.subscribe((msg) => {
    if (msg.type === 'processing' && msg.sessionId === session.id) {
      send({ type: 'PROCESSING.PROGRESS', progress: msg.progress });
    }
  });
  try {
    send({ type: 'PROCESSING.PROGRESS', progress: 0.05 });
    const res = await agent.process({
      config,
      session: {
        id: session.id,
        code: session.code,
        startedAt: session.startedAt,
        frameId: session.frameId ?? '',
        filterId: session.filterId,
        paymentMethod: session.paymentMethod,
        amount: sessionTotal(config, session),
        extraPrints: session.extraPrints,
        downloadUrl,
        shots: session.shots.flatMap((s) =>
          s ? [{ slotIndex: s.slotIndex, photoId: s.photo.id }] : [],
        ),
      },
    });
    if (res.printError) {
      // Session + strip are saved; leaving the Error page retries processing (= reprint).
      send({ type: 'PROCESSING.FAILED', message: `Printer bermasalah: ${res.printError}` });
      return;
    }
    send({ type: 'PROCESSING.PROGRESS', progress: 1 });
    send({ type: 'PROCESSING.DONE', downloadUrl });
  } finally {
    off();
  }
}

/** The shared flow machine wired to kiosk implementations (camera, mock payment, agent). */
export function createKioskMachine(deps: KioskFlowDeps) {
  const { camera, photos, agent } = deps;
  return flowMachine.provide({
    actors: {
      connectCamera: fromPromise(async () => {
        await camera.connect();
      }),
      captureShot: fromPromise<ShotPhoto, CaptureShotInput>(async ({ input }) => {
        const image = await camera.capture({
          shotIndex: input.slotIndex,
          session: {
            id: input.sessionId,
            code: input.sessionCode,
            boothId: input.boothId,
            configVersion: input.configVersion,
            startedAt: input.startedAt,
            takeNumber: input.takeNumber,
          },
        });
        return storeShot(deps, input, image);
      }),
      createPayment: fromPromise(({ input }: { input: CreatePaymentInput }) =>
        mockPayments.create(input),
      ),
      processSession: fromCallback<FlowEvent, ProcessSessionInput>(({ input, sendBack }) => {
        let cancelled = false;
        const send = (e: FlowEvent) => {
          if (!cancelled) sendBack(e);
        };
        const run = agent
          ? processWithAgent(agent, deps, input, send)
          : processInBrowser(deps, input, send);
        run.catch((err: unknown) => {
          console.error('[kiosk] processing failed', err);
          send({
            type: 'PROCESSING.FAILED',
            message: err instanceof Error ? err.message : 'Gagal memproses sesi.',
          });
        });
        return () => {
          cancelled = true;
        };
      }),
    },
    actions: {
      cancelPayment: ({ context }) => mockPayments.cancel(context.session?.paymentId),
      onSessionEnd: ({ context }) => {
        if (context.session) photos.release(context.session.id);
      },
    },
  });
}
