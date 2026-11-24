import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTabletSource, type AgentLink } from './tablet';
import type { AgentToKiosk, CameraInfo, KioskToAgent } from './tablet-protocol';
import type { CaptureStatus } from './types';

class FakePeer {
  static last: FakePeer | null = null;
  ontrack: ((e: unknown) => void) | null = null;
  onicecandidate: ((e: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState = 'new';
  closed = false;
  remote: unknown = null;
  constructor() {
    FakePeer.last = this;
  }
  addTransceiver() {
    return { receiver: {} };
  }
  async createOffer() {
    return { type: 'offer', sdp: 'v=0 fake' };
  }
  async setLocalDescription() {}
  async setRemoteDescription(d: unknown) {
    this.remote = d;
  }
  async addIceCandidate() {}
  close() {
    this.closed = true;
  }
  async getStats() {
    return new Map();
  }
}

class FakeLink implements AgentLink {
  baseUrl = 'http://127.0.0.1:47810';
  sent: KioskToAgent[] = [];
  private listeners = new Set<(m: AgentToKiosk) => void>();
  send(msg: KioskToAgent) {
    this.sent.push(msg);
  }
  subscribe(l: (m: AgentToKiosk) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  emit(m: AgentToKiosk) {
    for (const l of this.listeners) l(m);
  }
}

const info: CameraInfo = {
  cameraId: 'c1',
  name: 'iPad',
  platform: 'ios',
  appVersion: '1',
  facing: 'back',
};

beforeEach(() => {
  vi.stubGlobal('RTCPeerConnection', FakePeer);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('tablet capture source', () => {
  it('connects when the agent reports the tablet and offers a receive-only peer', async () => {
    const link = new FakeLink();
    const source = createTabletSource({ agent: link });
    const pending = source.connect();
    expect(source.status()).toBe('connecting');
    link.emit({
      type: 'camera',
      camera: { status: 'connected', connectionId: 'k1', info, since: Date.now() },
    });
    await pending;
    expect(source.status()).toBe('connected');
    await vi.waitFor(() => expect(link.sent.find((m) => m.type === 'signal')).toBeTruthy());
    const offer = link.sent.find((m) => m.type === 'signal')!;
    expect(offer).toMatchObject({ data: { kind: 'offer' } });
    link.emit({
      type: 'signal',
      peerId: (offer as { peerId: string }).peerId,
      data: { kind: 'answer', sdp: 'v=0 answer' },
    });
    await vi.waitFor(() => expect(FakePeer.last!.remote).toMatchObject({ type: 'answer' }));
  });

  it('a short drop is "reconnecting"; it only becomes an error after the grace period', async () => {
    const link = new FakeLink();
    const source = createTabletSource({ agent: link, reconnectGraceMs: 10_000 });
    const seen: CaptureStatus[] = [];
    source.onStatusChange((s) => seen.push(s));
    const p = source.connect();
    link.emit({
      type: 'camera',
      camera: { status: 'connected', connectionId: 'k1', info, since: Date.now() },
    });
    await p;
    link.emit({ type: 'camera', camera: { status: 'disconnected', info, since: Date.now() } });
    expect(source.status()).toBe('reconnecting');
    vi.advanceTimersByTime(5_000);
    link.emit({
      type: 'camera',
      camera: { status: 'connected', connectionId: 'k2', info, since: Date.now() },
    });
    expect(source.status()).toBe('connected');
    link.emit({ type: 'camera', camera: { status: 'disconnected', info, since: Date.now() } });
    vi.advanceTimersByTime(10_001);
    expect(source.status()).toBe('error');
    expect(source.lastError()?.code).toBe('disconnected');
    expect(seen).toEqual([
      'connecting',
      'connected',
      'reconnecting',
      'connected',
      'reconnecting',
      'error',
    ]);
  });

  it('capture goes through the agent and returns the stored full-resolution file', async () => {
    const link = new FakeLink();
    const source = createTabletSource({ agent: link });
    const p = source.connect();
    link.emit({
      type: 'camera',
      camera: { status: 'connected', connectionId: 'k1', info, since: Date.now() },
    });
    await p;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            photoId: 'f1',
            url: 'http://127.0.0.1:47810/files/f1',
            width: 4032,
            height: 3024,
          }),
          {
            status: 201,
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const shot = await source.capture({
      shotIndex: 2,
      session: {
        id: 's1',
        code: 'ABCDEFGH',
        boothId: 'b1',
        configVersion: 3,
        startedAt: '2026-11-24T00:00:00Z',
        takeNumber: 1,
      },
    });
    expect(shot).toMatchObject({
      blob: null,
      stored: { photoId: 'f1' },
      width: 4032,
      height: 3024,
      sourceId: 'tablet',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:47810/sessions/s1/capture',
      expect.anything(),
    );
  });
});
