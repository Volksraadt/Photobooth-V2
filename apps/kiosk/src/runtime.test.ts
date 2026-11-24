import { flowMachine } from '@pb/flow';
import { createDefaultBoothConfig } from '@pb/schema';
import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { buildRuntime } from './runtime';

describe('buildRuntime', () => {
  it('maps the flow snapshot to renderer data and gates actions by the machine', () => {
    const config = createDefaultBoothConfig({ boothId: 'b', boothName: 'Booth Uji' });
    const actor = createActor(flowMachine, { input: { config } }).start();
    actor.send({ type: 'START' });
    actor.send({ type: 'NEXT' });

    const runtime = buildRuntime(actor.getSnapshot(), { stream: null, status: 'idle' });
    expect(runtime.boothName).toBe('Booth Uji');
    expect(runtime.price).toBe(35000);
    expect(runtime.selectedFrameId).toBe(config.frames[0]!.id);
    // Filter is only applied from Review on.
    expect(runtime.selectedFilterId).toBeNull();
    expect(runtime.mirrorShots).toBe(true);
    expect(runtime.printSheets).toBe(1);

    expect(runtime.canAction!({ kind: 'next' })).toBe(true);
    expect(runtime.canAction!({ kind: 'back' })).toBe(true);
    expect(runtime.canAction!({ kind: 'retakeAll' })).toBe(false);
    actor.stop();
  });
});
