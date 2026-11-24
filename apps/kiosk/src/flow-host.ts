import type { CaptureSource } from '@pb/capture';
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
import { mockPayments } from './mock-payment';
import type { PhotoStore } from './photo-store';
import { saveSession, type StoredSession } from './session-store';

export type KioskFlowDeps = {
  camera: CaptureSource;
  photos: PhotoStore;
  shortLinkBase: string;
};

/** Simulated print time in F1 (the agent prints in F3). */
const PRINT_SIMULATION_MS = 1500;

/** The shared flow machine wired to kiosk implementations (camera, mock payment, local save). */
export function createKioskMachine({ camera, photos, shortLinkBase }: KioskFlowDeps) {
  return flowMachine.provide({
    actors: {
      connectCamera: fromPromise(async () => {
        await camera.connect();
      }),
      captureShot: fromPromise<ShotPhoto, CaptureShotInput>(async ({ input }) => {
        const image = await camera.capture({ shotIndex: input.slotIndex });
        return photos.add(input.sessionId, input.slotIndex, input.takeNumber, image);
      }),
      createPayment: fromPromise(({ input }: { input: CreatePaymentInput }) =>
        mockPayments.create(input),
      ),
      processSession: fromCallback<FlowEvent, ProcessSessionInput>(({ input, sendBack }) => {
        let cancelled = false;
        const send = (e: FlowEvent) => {
          if (!cancelled) sendBack(e);
        };
        void (async () => {
          const { config, session } = input;
          send({ type: 'PROCESSING.PROGRESS', progress: 0.1 });
          const stored = photos.forSession(session.id);
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
            downloadUrl: `${shortLinkBase}/s/${session.code}`,
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
            stored.map((p) => ({ id: p.id, blob: p.blob })),
          );
          send({ type: 'PROCESSING.PROGRESS', progress: 0.5 });
          await new Promise((r) => setTimeout(r, PRINT_SIMULATION_MS));
          send({ type: 'PROCESSING.PROGRESS', progress: 1 });
          send({ type: 'PROCESSING.DONE', downloadUrl: record.downloadUrl });
        })().catch((err: unknown) => {
          console.error('[kiosk] processing failed', err);
          send({
            type: 'PROCESSING.FAILED',
            message: err instanceof Error ? err.message : 'Gagal menyimpan sesi.',
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
