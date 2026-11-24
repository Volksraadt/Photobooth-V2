import { createId } from '@paralleldrive/cuid2';
import { generateSessionCode, type PageType } from '@pb/schema';
import {
  and,
  assign,
  enqueueActions,
  fromCallback,
  fromPromise,
  setup,
  type ActorRefFrom,
  type AnyEventObject,
  type SnapshotFrom,
} from 'xstate';
import {
  defaultFilterId,
  findFrame,
  idleTimeoutMs,
  pageHasButton,
  paymentAmount,
  slotCount,
} from './helpers';
import {
  DEFAULT_FLOW_TIMINGS,
  type CaptureShotInput,
  type CreatePaymentInput,
  type CreatePaymentOutput,
  type FlowContext,
  type FlowError,
  type FlowErrorKind,
  type FlowEvent,
  type FlowInput,
  type FlowSession,
  type ProcessSessionInput,
  type Shot,
  type ShotPhoto,
} from './types';

const notProvided = (name: string) => () => {
  throw new Error(`[flow] actor "${name}" is not provided; use machine.provide()`);
};

function errorMessage(event: AnyEventObject, fallback: string): string {
  if (typeof event.message === 'string' && event.message) return event.message;
  const err: unknown = event.error;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

const lastShotSlot = (session: FlowSession): number | null => {
  const last = session.takes.at(-1);
  return last && session.shots[last.slotIndex - 1] ? last.slotIndex : null;
};

const retakesUsed = (session: FlowSession, slotIndex: number) =>
  Math.max(0, session.takes.filter((t) => t.slotIndex === slotIndex).length - 1);

const retakeAllowed = (ctx: FlowContext, slotIndex: number): boolean => {
  const session = ctx.session;
  if (!session?.shots[slotIndex - 1]) return false;
  const max = ctx.config.flow.maxRetakesPerShot;
  return max === null || retakesUsed(session, slotIndex) < max;
};

const firstEmptySlot = (session: FlowSession | null): number | null => {
  if (!session) return null;
  const i = session.shots.findIndex((s) => s === null);
  return i === -1 ? null : i + 1;
};

const allFilled = (session: FlowSession | null) =>
  !!session && session.shots.length > 0 && session.shots.every((s) => s !== null);

const updateSession = (ctx: FlowContext, patch: Partial<FlowSession>): FlowSession | null =>
  ctx.session ? { ...ctx.session, ...patch } : null;

function newSession(context: FlowContext, free: boolean): Partial<FlowContext> {
  const session: FlowSession = {
    id: createId(),
    code: generateSessionCode(),
    startedAt: new Date().toISOString(),
    frameId: null,
    free: free || context.config.flow.eventMode,
    paid: false,
    paymentMethod: null,
    paymentId: null,
    qrString: null,
    paymentExpiresAt: null,
    shots: [],
    takes: [],
    filterId: defaultFilterId(context.config),
    extraPrints: 0,
    downloadUrl: null,
    completedAt: null,
  };
  return {
    session,
    slideIndex: 0,
    activeSlot: null,
    retaking: false,
    countdown: null,
    progress: null,
    error: null,
  };
}

const ERROR_FALLBACK: Record<FlowErrorKind, string> = {
  camera: 'Kamera bermasalah.',
  payment: 'Pembayaran gagal.',
  processing: 'Gagal memproses foto.',
  unknown: 'Terjadi kesalahan.',
};

function errorPatch(
  context: FlowContext,
  event: AnyEventObject,
  defaultKind: FlowErrorKind,
): Partial<FlowContext> {
  const kind: FlowErrorKind =
    event.type === 'FAIL' && typeof event.kind === 'string'
      ? (event.kind as FlowErrorKind)
      : defaultKind;
  // A paid session is never dropped: leaving the error page resumes it.
  const resumeTo: FlowError['resumeTo'] = !context.session?.paid
    ? null
    : kind === 'processing'
      ? 'processing'
      : 'capture';
  return {
    error: { kind, message: errorMessage(event, ERROR_FALLBACK[kind]), resumeTo },
    countdown: null,
  };
}

/**
 * Buyer flow: cover → tutorial → framePick → payment → capture → review → processing → result → cover,
 * plus error and admin. See docs/architecture.md §3.3.
 *
 * Host-provided actors: connectCamera, captureShot, createPayment, processSession.
 * Host-provided actions (optional): cancelPayment, onSessionEnd.
 */
export const flowMachine = setup({
  types: {
    context: {} as FlowContext,
    events: {} as FlowEvent,
    input: {} as FlowInput,
  },
  actors: {
    connectCamera: fromPromise<void, { sessionId: string }>(notProvided('connectCamera')),
    captureShot: fromPromise<ShotPhoto, CaptureShotInput>(notProvided('captureShot')),
    createPayment: fromPromise<CreatePaymentOutput, CreatePaymentInput>(
      notProvided('createPayment'),
    ),
    processSession: fromCallback<FlowEvent, ProcessSessionInput>(({ sendBack }) => {
      sendBack({ type: 'PROCESSING.FAILED', message: 'processSession is not provided' });
    }),
  },
  delays: {
    countdownTick: ({ context }) => context.timings.countdownTickMs,
    shotPreview: ({ context }) => context.timings.shotPreviewMs,
    captureAutoFinish: ({ context }) => context.timings.captureAutoFinishMs,
    slideDuration: ({ context }) => {
      const slide = context.config.pages.tutorial.slides?.[context.slideIndex];
      return (slide?.durationSec ?? 0) * 1000;
    },
    paymentExpiry: ({ context }) => {
      const at = context.session?.paymentExpiresAt;
      return at
        ? Math.max(0, Date.parse(at) - Date.now())
        : context.config.flow.qrisExpirySec * 1000;
    },
    resultReturn: ({ context }) => context.config.flow.resultAutoReturnSec * 1000,
  },
  guards: {
    tutorialEnabled: ({ context }) => context.config.flow.tutorialEnabled,
    reviewEnabled: ({ context }) => context.config.flow.reviewEnabled,
    qrisEnabled: ({ context }) => context.config.flow.paymentMethods.includes('qris'),
    slideTimed: ({ context }) =>
      context.config.pages.tutorial.slides?.[context.slideIndex]?.durationSec !== undefined,
    hasNextSlide: ({ context }) =>
      context.slideIndex + 1 < (context.config.pages.tutorial.slides?.length ?? 0),
    hasFrame: ({ context }) => !!findFrame(context.config, context.session?.frameId ?? null),
    skipPayment: ({ context }) => context.config.flow.eventMode || !!context.session?.free,
    validFrame: ({ context, event }) =>
      event.type === 'SELECT_FRAME' && !!findFrame(context.config, event.frameId),
    validFilter: ({ context, event }) =>
      event.type === 'SELECT_FILTER' &&
      context.config.filters.some((f) => f.id === event.filterId && f.enabled),
    paymentMethodEnabled: ({ context, event }) =>
      event.type === 'SELECT_PAYMENT' && context.config.flow.paymentMethods.includes(event.method),
    paymentMatches: ({ context, event }) =>
      event.type === 'PAYMENT.PAID' &&
      (!event.paymentId || event.paymentId === context.session?.paymentId),
    hasQr: ({ context }) => !!context.session?.qrString,
    allFilled: ({ context }) => allFilled(context.session),
    retaking: ({ context }) => context.retaking,
    continueAuto: ({ context }) =>
      !context.retaking &&
      context.config.flow.autoAdvanceBetweenShots &&
      !allFilled(context.session),
    captureWithoutExitButton: ({ context }) =>
      !pageHasButton(context.config, 'capture', ['next', 'confirm']),
    canRetake: ({ context, event }) => {
      if (event.type !== 'RETAKE' || !context.session) return false;
      const slot = event.shotIndex ?? lastShotSlot(context.session);
      return slot !== null && retakeAllowed(context, slot);
    },
    canRetakeAll: ({ context }) =>
      !!context.session &&
      context.session.shots.some((s) => s !== null) &&
      context.session.shots.every((s, i) => s === null || retakeAllowed(context, i + 1)),
    canAddPrint: ({ context }) =>
      context.config.pricing.extraPrintPrice !== null &&
      (context.session?.extraPrints ?? 0) < context.config.pricing.maxExtraPrints,
    canRemovePrint: ({ context }) => (context.session?.extraPrints ?? 0) > 0,
    unpaid: ({ context }) => !context.session?.paid,
    resumeCapture: ({ context }) =>
      !!context.session?.paid && context.error?.resumeTo === 'capture',
    resumeProcessing: ({ context }) =>
      !!context.session?.paid && context.error?.resumeTo === 'processing',
  },
  actions: {
    /** Host hook: cancel a pending QRIS at the provider. Reads context.session.paymentId. */
    cancelPayment: () => {},
    /** Host hook: called with the session that is about to be discarded (completed or abandoned). */
    onSessionEnd: () => {},

    restartIdle: enqueueActions(({ context, enqueue }) => {
      enqueue.cancel('idle');
      const ms = idleTimeoutMs(context.config, context.page);
      if (ms !== null) enqueue.raise({ type: 'IDLE.TIMEOUT' }, { id: 'idle', delay: ms });
    }),
    startSession: assign(({ context }) => newSession(context, false)),
    startFreeSession: assign(({ context }) => newSession(context, true)),
    endSession: enqueueActions(({ context, enqueue }) => {
      if (!context.session) return;
      if (context.session.paymentId && !context.session.paid) enqueue('cancelPayment');
      enqueue('onSessionEnd');
      enqueue.assign({
        session: null,
        activeSlot: null,
        retaking: false,
        countdown: null,
        progress: null,
        error: null,
      });
    }),
    applyPendingConfig: assign(({ context }) =>
      context.pendingConfig ? { config: context.pendingConfig, pendingConfig: null } : {},
    ),
    preselectSingleFrame: assign(({ context }) => {
      const frames = context.config.frames.filter((f) => f.enabled);
      if (context.session && !context.session.frameId && frames.length === 1) {
        return { session: updateSession(context, { frameId: frames[0]!.id }) };
      }
      return {};
    }),
    prepareShots: assign(({ context }) => {
      const n = slotCount(context.config, context.session);
      const shots = context.session?.shots ?? [];
      if (shots.length === n) return {};
      return { session: updateSession(context, { shots: Array.from({ length: n }, () => null) }) };
    }),
    markFree: assign(({ context }) => ({
      session: updateSession(context, { paid: true, paymentMethod: 'free' }),
    })),
    releasePayment: enqueueActions(({ context, enqueue }) => {
      if (context.session?.paymentId && !context.session.paid) enqueue('cancelPayment');
      enqueue.assign({
        session: updateSession(context, {
          paymentId: null,
          qrString: null,
          paymentExpiresAt: null,
        }),
      });
    }),
    activateNextSlot: assign(({ context }) => ({
      activeSlot: firstEmptySlot(context.session),
      retaking: false,
    })),
    highlightNext: assign(({ context }) => ({
      activeSlot: firstEmptySlot(context.session),
      retaking: false,
      countdown: null,
    })),
    startCountdown: assign(({ context }) => ({ countdown: context.config.flow.shotCountdownSec })),
    tickCountdown: assign(({ context }) => ({ countdown: (context.countdown ?? 1) - 1 })),
    beginRetake: assign(({ context, event }) => {
      if (event.type !== 'RETAKE' || !context.session) return {};
      return { activeSlot: event.shotIndex ?? lastShotSlot(context.session), retaking: true };
    }),
    beginRetakeAll: assign(({ context }) => ({
      session: updateSession(context, {
        shots: (context.session?.shots ?? []).map(() => null),
      }),
      activeSlot: 1,
      retaking: false,
    })),
    setCameraError: assign(({ context, event }) => errorPatch(context, event, 'camera')),
    setPaymentError: assign(({ context, event }) => errorPatch(context, event, 'payment')),
    setProcessingError: assign(({ context, event }) => errorPatch(context, event, 'processing')),
    setUnknownError: assign(({ context, event }) => errorPatch(context, event, 'unknown')),
  },
}).createMachine({
  id: 'flow',
  context: ({ input }) => ({
    config: input.config,
    pendingConfig: null,
    timings: { ...DEFAULT_FLOW_TIMINGS, ...input.timings },
    page: null,
    session: null,
    slideIndex: 0,
    activeSlot: null,
    retaking: false,
    countdown: null,
    progress: null,
    error: null,
    shotCounter: 0,
  }),
  initial: 'cover',
  on: {
    ACTIVITY: { actions: 'restartIdle' },
    // Before payment, idle returns to Cover. After payment, states handle it themselves (continue).
    'IDLE.TIMEOUT': { guard: 'unpaid', target: '.cover' },
    FAIL: { target: '.error', actions: 'setUnknownError' },
    'CONFIG.UPDATE': { actions: assign(({ event }) => ({ pendingConfig: event.config })) },
    'ADMIN.OPEN': { guard: 'unpaid', target: '.admin' },
  },
  states: {
    cover: {
      entry: [
        'endSession',
        'applyPendingConfig',
        assign({ page: 'cover' as PageType | null }),
        'restartIdle',
      ],
      on: {
        START: [
          {
            guard: 'tutorialEnabled',
            target: 'tutorial',
            actions: 'startSession',
          },
          { target: 'framePick', actions: 'startSession' },
        ],
        NEXT: [
          {
            guard: 'tutorialEnabled',
            target: 'tutorial',
            actions: 'startSession',
          },
          { target: 'framePick', actions: 'startSession' },
        ],
        'CONFIG.UPDATE': {
          actions: [
            assign(({ event }) => ({ config: event.config, pendingConfig: null })),
            'restartIdle',
          ],
        },
      },
    },

    tutorial: {
      entry: [
        assign({ slideIndex: 0 }),
        assign({ page: 'tutorial' as PageType | null }),
        'restartIdle',
      ],
      initial: 'route',
      states: {
        route: { always: [{ guard: 'slideTimed', target: 'timed' }, { target: 'untimed' }] },
        timed: { after: { slideDuration: { target: 'advance' } } },
        untimed: {},
        advance: {
          always: [
            {
              guard: 'hasNextSlide',
              target: 'route',
              actions: assign(({ context }) => ({ slideIndex: context.slideIndex + 1 })),
            },
            { target: '#flow.framePick' },
          ],
        },
      },
      on: {
        NEXT: '.advance',
        START: 'framePick',
        CONFIRM: 'framePick',
        BACK: 'cover',
      },
    },

    framePick: {
      entry: [
        assign({ page: 'framePick' as PageType | null }),
        'restartIdle',
        'preselectSingleFrame',
      ],
      on: {
        SELECT_FRAME: {
          guard: 'validFrame',
          actions: assign(({ context, event }) => ({
            session: updateSession(context, { frameId: event.frameId }),
          })),
        },
        NEXT: [
          {
            guard: and(['hasFrame', 'skipPayment']),
            target: 'capture',
            actions: ['prepareShots', 'markFree'],
          },
          { guard: 'hasFrame', target: 'payment', actions: 'prepareShots' },
        ],
        CONFIRM: [
          {
            guard: and(['hasFrame', 'skipPayment']),
            target: 'capture',
            actions: ['prepareShots', 'markFree'],
          },
          { guard: 'hasFrame', target: 'payment', actions: 'prepareShots' },
        ],
        BACK: [{ guard: 'tutorialEnabled', target: 'tutorial' }, { target: 'cover' }],
      },
    },

    payment: {
      entry: [assign({ page: 'payment' as PageType | null }), 'restartIdle'],
      initial: 'route',
      states: {
        route: { always: [{ guard: 'qrisEnabled', target: 'creating' }, { target: 'awaiting' }] },
        creating: {
          invoke: {
            src: 'createPayment',
            input: ({ context }) => ({
              sessionId: context.session!.id,
              sessionCode: context.session!.code,
              amount: paymentAmount(context.config, context.session),
              expirySec: context.config.flow.qrisExpirySec,
            }),
            onDone: {
              target: 'awaiting',
              actions: assign(({ context, event }) => ({
                session: updateSession(context, {
                  paymentId: event.output.paymentId,
                  qrString: event.output.qrString,
                  paymentExpiresAt: event.output.expiresAt,
                  paymentMethod: 'qris',
                }),
              })),
            },
            onError: {
              target: '#flow.error',
              actions: 'setPaymentError',
            },
          },
        },
        awaiting: {
          after: {
            // QRIS expired without payment: cancel and let the buyer start the payment again.
            paymentExpiry: { guard: 'hasQr', target: '#flow.framePick', actions: 'releasePayment' },
          },
        },
      },
      on: {
        'PAYMENT.PAID': {
          guard: 'paymentMatches',
          target: 'capture',
          actions: assign(({ context }) => ({
            session: updateSession(context, {
              paid: true,
              paymentMethod: context.session?.paymentMethod ?? 'qris',
            }),
          })),
        },
        'PAYMENT.FAILED': {
          target: 'error',
          actions: ['releasePayment', 'setPaymentError'],
        },
        SELECT_PAYMENT: {
          guard: 'paymentMethodEnabled',
          actions: assign(({ context, event }) => ({
            session: updateSession(context, { paymentMethod: event.method }),
          })),
        },
        BACK: { target: 'framePick', actions: 'releasePayment' },
      },
    },

    capture: {
      entry: [assign({ page: 'capture' as PageType | null }), 'restartIdle'],
      initial: 'connecting',
      states: {
        connecting: {
          invoke: {
            src: 'connectCamera',
            input: ({ context }) => ({ sessionId: context.session!.id }),
            onDone: 'route',
            onError: {
              target: '#flow.error',
              actions: 'setCameraError',
            },
          },
        },
        route: {
          always: [
            { guard: 'retaking', target: 'countdown' },
            { guard: 'allFilled', target: 'waiting' },
            { target: 'countdown', actions: 'activateNextSlot' },
          ],
        },
        countdown: {
          entry: 'startCountdown',
          initial: 'tick',
          states: {
            tick: {
              always: {
                guard: ({ context }) => (context.countdown ?? 0) <= 0,
                target: '#flow.capture.shooting',
              },
              after: { countdownTick: { target: 'tick', reenter: true, actions: 'tickCountdown' } },
            },
          },
        },
        shooting: {
          entry: assign({ countdown: null }),
          invoke: {
            src: 'captureShot',
            input: ({ context }) => {
              const slotIndex = context.activeSlot ?? 1;
              const takes = context.session!.takes.filter((t) => t.slotIndex === slotIndex);
              return {
                sessionId: context.session!.id,
                slotIndex,
                takeNumber: takes.length + 1,
              };
            },
            onDone: {
              target: 'shotPreview',
              actions: [
                assign(({ context, event }) => {
                  const session = context.session!;
                  const slotIndex = context.activeSlot ?? 1;
                  const shot: Shot = {
                    slotIndex,
                    takeNumber: session.takes.filter((t) => t.slotIndex === slotIndex).length + 1,
                    photo: event.output,
                    capturedAt: new Date().toISOString(),
                  };
                  const shots = session.shots.slice();
                  shots[slotIndex - 1] = shot;
                  return {
                    session: { ...session, shots, takes: [...session.takes, shot] },
                    shotCounter: context.shotCounter + 1,
                  };
                }),
                'restartIdle',
              ],
            },
            onError: {
              target: '#flow.error',
              actions: 'setCameraError',
            },
          },
        },
        shotPreview: {
          after: {
            shotPreview: [
              { guard: 'continueAuto', target: 'countdown', actions: 'activateNextSlot' },
              { target: 'waiting' },
            ],
          },
          on: {
            RETAKE: { guard: 'canRetake', target: 'countdown', actions: 'beginRetake' },
            RETAKE_ALL: { guard: 'canRetakeAll', target: 'countdown', actions: 'beginRetakeAll' },
          },
        },
        waiting: {
          entry: 'highlightNext',
          after: {
            captureAutoFinish: {
              guard: and(['allFilled', 'captureWithoutExitButton']),
              target: 'done',
            },
          },
          on: {
            NEXT: [
              { guard: 'allFilled', target: 'done' },
              { target: 'countdown', actions: 'activateNextSlot' },
            ],
            CONFIRM: [
              { guard: 'allFilled', target: 'done' },
              { target: 'countdown', actions: 'activateNextSlot' },
            ],
            // Paid: idle never drops the session; it keeps going.
            'IDLE.TIMEOUT': [
              { guard: 'allFilled', target: 'done' },
              { target: 'countdown', actions: 'activateNextSlot' },
            ],
            RETAKE: { guard: 'canRetake', target: 'countdown', actions: 'beginRetake' },
            RETAKE_ALL: { guard: 'canRetakeAll', target: 'countdown', actions: 'beginRetakeAll' },
          },
        },
        done: {
          entry: assign({ activeSlot: null }),
          always: [
            { guard: 'reviewEnabled', target: '#flow.review' },
            { target: '#flow.processing' },
          ],
        },
      },
      on: {
        'CAMERA.ERROR': {
          target: 'error',
          actions: 'setCameraError',
        },
      },
    },

    review: {
      entry: [assign({ page: 'review' as PageType | null }), 'restartIdle'],
      on: {
        SELECT_FILTER: {
          guard: 'validFilter',
          actions: assign(({ context, event }) => ({
            session: updateSession(context, { filterId: event.filterId }),
          })),
        },
        ADD_PRINT: {
          guard: 'canAddPrint',
          actions: assign(({ context }) => ({
            session: updateSession(context, {
              extraPrints: (context.session?.extraPrints ?? 0) + 1,
            }),
          })),
        },
        REMOVE_PRINT: {
          guard: 'canRemovePrint',
          actions: assign(({ context }) => ({
            session: updateSession(context, {
              extraPrints: (context.session?.extraPrints ?? 0) - 1,
            }),
          })),
        },
        CONFIRM: 'processing',
        NEXT: 'processing',
        FINISH: 'processing',
        'IDLE.TIMEOUT': 'processing',
        BACK: 'capture',
        RETAKE: { guard: 'canRetake', target: 'capture', actions: 'beginRetake' },
        RETAKE_ALL: { guard: 'canRetakeAll', target: 'capture', actions: 'beginRetakeAll' },
      },
    },

    processing: {
      entry: [
        assign({ page: 'processing' as PageType | null }),
        'restartIdle',
        assign({ progress: 0 }),
      ],
      invoke: {
        src: 'processSession',
        input: ({ context }) => ({ config: context.config, session: context.session! }),
      },
      on: {
        'PROCESSING.PROGRESS': {
          actions: assign(({ event }) => ({ progress: Math.min(1, Math.max(0, event.progress)) })),
        },
        'PROCESSING.DONE': {
          target: 'result',
          actions: assign(({ context, event }) => ({
            progress: 1,
            session: updateSession(context, {
              downloadUrl: event.downloadUrl,
              completedAt: new Date().toISOString(),
            }),
          })),
        },
        'PROCESSING.FAILED': {
          target: 'error',
          actions: 'setProcessingError',
        },
      },
    },

    result: {
      entry: [assign({ page: 'result' as PageType | null }), 'restartIdle'],
      after: { resultReturn: 'cover' },
      on: { FINISH: 'cover', START: 'cover', NEXT: 'cover', CONFIRM: 'cover' },
    },

    error: {
      entry: [assign({ page: 'error' as PageType | null }), 'restartIdle'],
      on: {
        START: [
          { guard: 'resumeCapture', target: 'capture' },
          { guard: 'resumeProcessing', target: 'processing' },
          { target: 'cover' },
        ],
        FINISH: [
          { guard: 'resumeCapture', target: 'capture' },
          { guard: 'resumeProcessing', target: 'processing' },
          { target: 'cover' },
        ],
        BACK: [
          { guard: 'resumeCapture', target: 'capture' },
          { guard: 'resumeProcessing', target: 'processing' },
          { target: 'cover' },
        ],
        NEXT: [
          { guard: 'resumeCapture', target: 'capture' },
          { guard: 'resumeProcessing', target: 'processing' },
          { target: 'cover' },
        ],
        'IDLE.TIMEOUT': [
          { guard: 'resumeCapture', target: 'capture' },
          { guard: 'resumeProcessing', target: 'processing' },
          { target: 'cover' },
        ],
      },
    },

    admin: {
      entry: ['endSession', assign({ page: null as PageType | null }), 'restartIdle'],
      on: {
        'ADMIN.CLOSE': 'cover',
        'ADMIN.FREE_SESSION': {
          target: 'framePick',
          actions: 'startFreeSession',
        },
      },
    },
  },
});

export type FlowMachine = typeof flowMachine;
export type FlowActorRef = ActorRefFrom<FlowMachine>;
export type FlowSnapshot = SnapshotFrom<FlowMachine>;
