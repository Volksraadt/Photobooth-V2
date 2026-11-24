import { hashAdminPin } from '@pb/schema';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ConfigSync } from './config-sync';
import { MoneyService } from './money';
import type { AgentStore } from './store';
import type { Telemetry } from './telemetry';

let pinHash = '';
beforeAll(async () => {
  pinHash = await hashAdminPin('246813', { iterations: 1000 });
});

/** Only what approveCash touches; `meta` is the part that must survive a restart. */
function fakeStore(meta: Map<string, string>) {
  return {
    getMeta: (k: string) => meta.get(k) ?? null,
    setMeta: (k: string, v: string | null) => (v === null ? meta.delete(k) : meta.set(k, v)),
    ensureSession: () => undefined,
    addCashApproval: () => undefined,
    setSessionPayment: () => undefined,
    enqueue: () => undefined,
  } as unknown as AgentStore;
}

function service(meta: Map<string, string>) {
  const config = {
    current: { status: 'ready', config: { boothId: 'b1', admin: { pinHash } } },
    subscribe: () => () => undefined,
    onPaymentSignal: null,
  } as unknown as ConfigSync;
  const telemetry = {
    isOnline: true,
    subscribe: () => () => undefined,
    flush: async () => undefined,
    onDelivered: null,
  } as unknown as Telemetry;
  return new MoneyService(
    fakeStore(meta),
    config,
    telemetry,
    () => {},
    () => {},
  );
}

const session = {
  id: 's1',
  code: 'ABCD2345',
  startedAt: new Date().toISOString(),
  boothId: 'b1',
  configVersion: 1,
};

describe('cash PIN lockout (audit R2)', () => {
  it('locks after 5 wrong PINs, and an agent restart does not unlock it', async () => {
    const meta = new Map<string, string>();
    const first = service(meta);
    for (let i = 0; i < 5; i++) {
      await expect(first.approveCash({ pin: '000000', session, amount: 1 })).rejects.toMatchObject({
        code: 'wrong_pin',
      });
    }
    await expect(first.approveCash({ pin: '246813', session, amount: 1 })).rejects.toMatchObject({
      code: 'pin_locked',
    });
    // "Restart": a new service on the same SQLite meta.
    const restarted = service(meta);
    await expect(
      restarted.approveCash({ pin: '246813', session, amount: 1 }),
    ).rejects.toMatchObject({ code: 'pin_locked' });
  });

  it('a correct PIN resets the counter', async () => {
    const meta = new Map<string, string>();
    const s = service(meta);
    for (let i = 0; i < 4; i++) {
      await expect(s.approveCash({ pin: '000000', session, amount: 1 })).rejects.toMatchObject({
        code: 'wrong_pin',
      });
    }
    await expect(s.approveCash({ pin: '246813', session, amount: 1 })).resolves.toMatchObject({
      offline: false,
    });
    await expect(s.approveCash({ pin: '000000', session, amount: 1 })).rejects.toMatchObject({
      code: 'wrong_pin',
    });
    await expect(s.approveCash({ pin: '246813', session, amount: 1 })).resolves.toBeTruthy();
  });
});
