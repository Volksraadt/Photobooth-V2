import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentStore } from './store';

let dir = '';
let store: AgentStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pb-store-'));
  store = new AgentStore(dir);
});
afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

const session = (id: string) => ({
  id,
  code: id.toUpperCase().padEnd(8, 'X').slice(0, 8),
  boothId: 'b1',
  configVersion: 1,
  startedAt: '2026-11-25T09:00:00Z',
});
const status = (id: string) => store.sessions(50).find((s) => s.id === id)?.status;

describe('abandonSession', () => {
  it('marks an unpaid session abandoned', () => {
    store.ensureSession(session('s1'));
    expect(store.abandonSession('s1')).toBe(true);
    expect(status('s1')).toBe('abandoned');
  });

  it('never touches a paid session (refund or resume may be needed)', () => {
    store.ensureSession(session('s2'));
    store.setSessionPayment('s2', { method: 'cash', offline: false });
    expect(store.abandonSession('s2')).toBe(false);
    expect(status('s2')).toBe('capturing');
  });

  it('is a no-op for unknown sessions', () => {
    expect(store.abandonSession('nope')).toBe(false);
  });
});
