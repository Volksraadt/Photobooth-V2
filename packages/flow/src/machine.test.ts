import { createDefaultBoothConfig, type BoothConfig } from '@pb/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor, fromCallback, fromPromise } from 'xstate';
import { flowMachine } from './machine';
import type { CaptureShotInput, FlowEvent, ProcessSessionInput, ShotPhoto } from './types';

function makeConfig(patch: (c: BoothConfig) => void = () => {}): BoothConfig {
  let n = 0;
  const config = createDefaultBoothConfig({ boothId: 'booth-1', idFactory: () => `id-${++n}` });
  patch(config);
  return config;
}

type Harness = ReturnType<typeof start>;

function start(config: BoothConfig, opts: { cameraFails?: boolean } = {}) {
  const calls = { cancelled: [] as (string | null)[], ended: [] as string[], captures: 0 };
  const machine = flowMachine.provide({
    actors: {
      connectCamera: fromPromise(async () => {
        if (opts.cameraFails) throw new Error('Kamera tidak ditemukan.');
      }),
      captureShot: fromPromise<ShotPhoto, CaptureShotInput>(async ({ input }) => {
        calls.captures++;
        return {
          id: `photo-${input.slotIndex}-${input.takeNumber}`,
          url: `blob:${input.slotIndex}-${input.takeNumber}`,
          width: 1920,
          height: 1080,
        };
      }),
      createPayment: fromPromise(async ({ input }) => ({
        paymentId: `pay-${input.sessionCode}`,
        qrString: `QR-${input.amount}`,
        expiresAt: new Date(Date.now() + input.expirySec * 1000).toISOString(),
      })),
      processSession: fromCallback<FlowEvent, ProcessSessionInput>(({ sendBack, input }) => {
        const t = setTimeout(() => {
          sendBack({ type: 'PROCESSING.PROGRESS', progress: 0.5 });
          sendBack({
            type: 'PROCESSING.DONE',
            downloadUrl: `https://pb.test/s/${input.session.code}`,
          });
        }, 100);
        return () => clearTimeout(t);
      }),
    },
    actions: {
      cancelPayment: ({ context }) => {
        calls.cancelled.push(context.session?.paymentId ?? null);
      },
      onSessionEnd: ({ context }) => {
        calls.ended.push(context.session?.code ?? '');
      },
    },
  });
  const actor = createActor(machine, { input: { config } });
  actor.start();
  const state = () => actor.getSnapshot();
  const send = (e: FlowEvent) => actor.send(e);
  const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  return { actor, state, send, tick, calls };
}

/** Countdown (3 s) + capture + shot preview (1.2 s). */
const SHOT_MS = 3000 + 1200;

async function toCapture(h: Harness) {
  h.send({ type: 'START' });
  h.send({ type: 'NEXT' }); // tutorial → framePick
  h.send({ type: 'NEXT' }); // frame preselected → payment
  await h.tick(0);
  h.send({ type: 'PAYMENT.PAID' });
  await h.tick(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('flow machine', () => {
  it('runs the default config end to end, including retake of slot 2 and filter change', async () => {
    const config = makeConfig();
    const h = start(config);
    expect(h.state().value).toBe('cover');
    expect(h.state().context.page).toBe('cover');

    h.send({ type: 'START' });
    expect(h.state().context.page).toBe('tutorial');
    const code = h.state().context.session!.code;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

    h.send({ type: 'NEXT' });
    expect(h.state().value).toBe('framePick');
    // Single enabled frame is preselected.
    expect(h.state().context.session!.frameId).toBe(config.frames[0]!.id);

    h.send({ type: 'NEXT' });
    expect(h.state().matches({ payment: 'creating' })).toBe(true);
    await h.tick(0);
    expect(h.state().matches({ payment: 'awaiting' })).toBe(true);
    expect(h.state().context.session!.qrString).toBe('QR-35000');

    h.send({ type: 'PAYMENT.PAID' });
    await h.tick(0);
    expect(h.state().matches({ capture: 'countdown' })).toBe(true);
    expect(h.state().context.session!.paid).toBe(true);
    expect(h.state().context.activeSlot).toBe(1);
    expect(h.state().context.countdown).toBe(3);
    await h.tick(1000);
    expect(h.state().context.countdown).toBe(2);

    await h.tick(2000 + 1200 + SHOT_MS * 3);
    expect(h.state().matches({ capture: 'waiting' })).toBe(true);
    expect(h.state().context.session!.shots.map((s) => s?.photo.id)).toEqual([
      'photo-1-1',
      'photo-2-1',
      'photo-3-1',
      'photo-4-1',
    ]);

    h.send({ type: 'RETAKE', shotIndex: 2 });
    expect(h.state().matches({ capture: 'countdown' })).toBe(true);
    expect(h.state().context.activeSlot).toBe(2);
    await h.tick(SHOT_MS);
    // Retake returns to waiting instead of continuing with slot 3.
    expect(h.state().matches({ capture: 'waiting' })).toBe(true);
    const session = h.state().context.session!;
    expect(session.shots[1]!.photo.id).toBe('photo-2-2');
    expect(session.shots[1]!.takeNumber).toBe(2);
    expect(session.takes).toHaveLength(5);

    h.send({ type: 'NEXT' });
    expect(h.state().value).toBe('review');
    const filterId = config.filters[1]!.id;
    h.send({ type: 'SELECT_FILTER', filterId });
    expect(h.state().context.session!.filterId).toBe(filterId);
    h.send({ type: 'ADD_PRINT' });
    expect(h.state().context.session!.extraPrints).toBe(1);

    h.send({ type: 'CONFIRM' });
    expect(h.state().value).toBe('processing');
    await h.tick(100);
    expect(h.state().value).toBe('result');
    expect(h.state().context.session!.downloadUrl).toBe(`https://pb.test/s/${code}`);

    await h.tick(config.flow.resultAutoReturnSec * 1000);
    expect(h.state().value).toBe('cover');
    expect(h.state().context.session).toBeNull();
    expect(h.calls.ended).toEqual([code]);
    expect(h.calls.cancelled).toEqual([]);
  });

  it('advances tutorial slides by duration', async () => {
    const h = start(makeConfig());
    h.send({ type: 'START' });
    await h.tick(4999);
    expect(h.state().context.page).toBe('tutorial');
    await h.tick(1);
    expect(h.state().value).toBe('framePick');
  });

  it('skips tutorial, review and payment when disabled / event mode', async () => {
    const h = start(
      makeConfig((c) => {
        c.flow.tutorialEnabled = false;
        c.flow.reviewEnabled = false;
        c.flow.eventMode = true;
      }),
    );
    h.send({ type: 'START' });
    expect(h.state().value).toBe('framePick');
    h.send({ type: 'NEXT' });
    await h.tick(0);
    expect(h.state().matches('capture')).toBe(true);
    expect(h.state().context.session).toMatchObject({ paid: true, paymentMethod: 'free' });
    await h.tick(SHOT_MS * 4);
    h.send({ type: 'NEXT' });
    expect(h.state().value).toBe('processing');
  });

  describe('idle timeout', () => {
    it('returns to cover before payment and drops the session', async () => {
      const config = makeConfig();
      const h = start(config);
      h.send({ type: 'START' });
      h.send({ type: 'NEXT' });
      expect(h.state().value).toBe('framePick');
      await h.tick(config.flow.idleTimeoutSec.framePick! * 1000 - 1000);
      h.send({ type: 'ACTIVITY' }); // a touch restarts the timer
      await h.tick(config.flow.idleTimeoutSec.framePick! * 1000 - 1000);
      expect(h.state().value).toBe('framePick');
      await h.tick(1000);
      expect(h.state().value).toBe('cover');
      expect(h.calls.ended).toHaveLength(1);
    });

    it('cancels a pending QRIS when idling out of payment', async () => {
      const h = start(
        makeConfig((c) => {
          c.flow.idleTimeoutSec.payment = 60;
        }),
      );
      h.send({ type: 'START' });
      h.send({ type: 'NEXT' });
      h.send({ type: 'NEXT' });
      await h.tick(0);
      const paymentId = h.state().context.session!.paymentId;
      await h.tick(60_000);
      expect(h.state().value).toBe('cover');
      expect(h.calls.cancelled).toEqual([paymentId]);
    });

    it('keeps a paid session going instead of dropping it', async () => {
      const h = start(
        makeConfig((c) => {
          c.flow.autoAdvanceBetweenShots = false;
        }),
      );
      await toCapture(h);
      await h.tick(SHOT_MS);
      expect(h.state().matches({ capture: 'waiting' })).toBe(true);
      expect(h.state().context.activeSlot).toBe(2);
      await h.tick(120_000);
      // Idle on a paid capture page takes the next shot rather than returning to cover.
      expect(h.state().matches({ capture: 'countdown' })).toBe(true);
      expect(h.state().context.session).not.toBeNull();
    });
  });

  describe('payment', () => {
    it('cancels the QRIS when going back to frame pick', async () => {
      const h = start(makeConfig());
      h.send({ type: 'START' });
      h.send({ type: 'NEXT' });
      h.send({ type: 'NEXT' });
      await h.tick(0);
      const paymentId = h.state().context.session!.paymentId;
      h.send({ type: 'BACK' });
      expect(h.state().value).toBe('framePick');
      expect(h.calls.cancelled).toEqual([paymentId]);
      expect(h.state().context.session!.paymentId).toBeNull();
    });

    it('returns to frame pick when the QRIS expires', async () => {
      const config = makeConfig();
      const h = start(config);
      h.send({ type: 'START' });
      h.send({ type: 'NEXT' });
      h.send({ type: 'NEXT' });
      await h.tick(0);
      await h.tick(config.flow.qrisExpirySec * 1000);
      expect(h.state().value).toBe('framePick');
      expect(h.calls.cancelled).toHaveLength(1);
    });

    it('ignores a paid event for another payment', async () => {
      const h = start(makeConfig());
      h.send({ type: 'START' });
      h.send({ type: 'NEXT' });
      h.send({ type: 'NEXT' });
      await h.tick(0);
      h.send({ type: 'PAYMENT.PAID', paymentId: 'someone-else' });
      expect(h.state().matches('payment')).toBe(true);
    });
  });

  describe('retakes', () => {
    it('retake all clears every slot and starts again from slot 1', async () => {
      const h = start(makeConfig());
      await toCapture(h);
      await h.tick(SHOT_MS * 4);
      h.send({ type: 'RETAKE_ALL' });
      expect(h.state().context.session!.shots.every((s) => s === null)).toBe(true);
      expect(h.state().context.activeSlot).toBe(1);
      await h.tick(SHOT_MS * 4);
      expect(h.state().matches({ capture: 'waiting' })).toBe(true);
      expect(h.state().context.session!.shots.map((s) => s?.takeNumber)).toEqual([2, 2, 2, 2]);
    });

    it('enforces maxRetakesPerShot', async () => {
      const h = start(
        makeConfig((c) => {
          c.flow.maxRetakesPerShot = 1;
        }),
      );
      await toCapture(h);
      await h.tick(SHOT_MS * 4);
      h.send({ type: 'RETAKE', shotIndex: 3 });
      await h.tick(SHOT_MS);
      expect(h.state().context.session!.shots[2]!.takeNumber).toBe(2);
      h.send({ type: 'RETAKE', shotIndex: 3 });
      expect(h.state().matches({ capture: 'waiting' })).toBe(true);
      h.send({ type: 'RETAKE_ALL' });
      expect(h.state().matches({ capture: 'waiting' })).toBe(true);
    });

    it('can retake from review and comes back to the capture page', async () => {
      const h = start(makeConfig());
      await toCapture(h);
      await h.tick(SHOT_MS * 4);
      h.send({ type: 'NEXT' });
      h.send({ type: 'RETAKE', shotIndex: 4 });
      await h.tick(0);
      expect(h.state().matches({ capture: 'countdown' })).toBe(true);
      expect(h.state().context.activeSlot).toBe(4);
    });
  });

  describe('errors', () => {
    it('camera lost mid-capture shows the error page and resumes the paid session', async () => {
      const h = start(makeConfig());
      await toCapture(h);
      await h.tick(SHOT_MS * 2);
      h.send({ type: 'CAMERA.ERROR', message: 'Kamera terputus.' });
      expect(h.state().value).toBe('error');
      expect(h.state().context.page).toBe('error');
      expect(h.state().context.error).toMatchObject({ kind: 'camera', resumeTo: 'capture' });

      h.send({ type: 'START' });
      await h.tick(0);
      expect(h.state().matches({ capture: 'countdown' })).toBe(true);
      expect(h.state().context.activeSlot).toBe(3);
      expect(h.state().context.session!.shots.filter(Boolean)).toHaveLength(2);
    });

    it('goes to the error page when the camera cannot connect', async () => {
      const h = start(makeConfig(), { cameraFails: true });
      await toCapture(h);
      expect(h.state().value).toBe('error');
      expect(h.state().context.error?.message).toBe('Kamera tidak ditemukan.');
    });

    it('unpaid error returns to cover on idle', async () => {
      const config = makeConfig();
      const h = start(config);
      h.send({ type: 'START' });
      h.send({ type: 'FAIL', message: 'boom' });
      expect(h.state().value).toBe('error');
      await h.tick(config.flow.idleTimeoutSec.error! * 1000);
      expect(h.state().value).toBe('cover');
    });
  });

  describe('admin', () => {
    it('opens only without a paid session and can start a free session', async () => {
      const h = start(makeConfig());
      await toCapture(h);
      h.send({ type: 'ADMIN.OPEN' });
      expect(h.state().matches('capture')).toBe(true);

      const h2 = start(makeConfig());
      h2.send({ type: 'ADMIN.OPEN' });
      expect(h2.state().value).toBe('admin');
      expect(h2.state().context.page).toBeNull();
      h2.send({ type: 'ADMIN.FREE_SESSION' });
      expect(h2.state().value).toBe('framePick');
      h2.send({ type: 'NEXT' });
      expect(h2.state().matches('capture')).toBe(true);
      expect(h2.state().context.session!.paymentMethod).toBe('free');
    });
  });

  it('applies a config update only when back at cover', async () => {
    const h = start(makeConfig());
    h.send({ type: 'START' });
    const next = makeConfig((c) => {
      c.configVersion = 7;
    });
    h.send({ type: 'CONFIG.UPDATE', config: next });
    expect(h.state().context.config.configVersion).toBe(0);
    h.send({ type: 'BACK' });
    expect(h.state().value).toBe('cover');
    expect(h.state().context.config.configVersion).toBe(7);
  });
});
