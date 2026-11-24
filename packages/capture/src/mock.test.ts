import { describe, expect, it } from 'vitest';
import { createMockSource } from './mock';
import { CaptureError, type CaptureStatus } from './types';

describe('mock capture source', () => {
  it('connects, captures unmirrored stills and reports status changes', async () => {
    const source = createMockSource({ width: 640, height: 480 });
    const seen: CaptureStatus[] = [];
    source.onStatusChange((s) => seen.push(s));

    expect(source.status()).toBe('idle');
    await source.connect();
    expect(source.status()).toBe('connected');

    const shot = await source.capture({ shotIndex: 2 });
    expect(shot).toMatchObject({ width: 640, height: 480, shotIndex: 2, sourceId: 'mock' });
    expect(shot.blob!.size).toBeGreaterThan(0);
    expect(new Date(shot.capturedAt).toISOString()).toBe(shot.capturedAt);
    expect(seen).toEqual(['connecting', 'connected']);
  });

  it('goes to error on disconnect and rejects captures until reconnected', async () => {
    const source = createMockSource();
    await source.connect();
    source.simulateDisconnect();
    expect(source.status()).toBe('error');
    expect(source.lastError()?.code).toBe('disconnected');
    await expect(source.capture({ shotIndex: 1 })).rejects.toBeInstanceOf(CaptureError);

    await source.connect();
    expect(source.status()).toBe('connected');
    expect(source.lastError()).toBeNull();
    await expect(source.capture({ shotIndex: 1 })).resolves.toBeTruthy();
  });

  it('can fail a single capture', async () => {
    const source = createMockSource();
    await source.connect();
    source.failNextCapture();
    await expect(source.capture({ shotIndex: 1 })).rejects.toMatchObject({
      code: 'capture-failed',
    });
    await expect(source.capture({ shotIndex: 1 })).resolves.toBeTruthy();
  });

  it('refuses preview before connect', async () => {
    const source = createMockSource();
    await expect(source.getPreviewStream()).rejects.toMatchObject({ code: 'not-connected' });
  });
});
