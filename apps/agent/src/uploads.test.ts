import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeviceApiError, type DeviceApi } from './device-api';
import { SessionFiles } from './sessions';
import { AgentStore } from './store';
import type { Telemetry } from './telemetry';
import { UploadQueue, uploadBackoffMs } from './uploads';

type Call = { kind: 'file' | 'complete'; id: string; filesExistOnDisk?: boolean };

class FakeApi {
  hasToken = true;
  calls: Call[] = [];
  /** Throw this from the next upload/complete calls. */
  failWith: Error | null = null;
  completeFailWith: DeviceApiError | null = null;
  manifests: Record<string, unknown>[] = [];
  paths: string[] = [];
  async uploadSessionFile(_s: string, f: { id: string; bytes: Uint8Array; sha256: string }) {
    if (this.failWith) throw this.failWith;
    this.calls.push({ kind: 'file', id: f.id });
  }
  async completeSession(_s: string, manifest: Record<string, unknown>) {
    if (this.completeFailWith) {
      const err = this.completeFailWith;
      this.completeFailWith = null;
      throw err;
    }
    // At the moment the API confirms, every local file must still exist.
    this.calls.push({
      kind: 'complete',
      id: _s,
      filesExistOnDisk: this.paths.every((p) => existsSync(p)),
    });
    this.manifests.push(manifest);
  }
}

const telemetry = { flush: async () => {}, report: () => {} } as unknown as Telemetry;

let dir: string;
let store: AgentStore;
let files: SessionFiles;
let api: FakeApi;
let nowMs: number;

async function makeSession(code = 'ABCD2345') {
  const ref = {
    id: `s${code.toLowerCase()}`,
    code,
    boothId: 'booth1',
    configVersion: 3,
    startedAt: '2026-11-25T01:00:00.000Z',
  };
  const jpeg = (c: string) =>
    sharp({ create: { width: 64, height: 48, channels: 3, background: c } })
      .jpeg()
      .toBuffer();
  const rows = [];
  for (let slot = 1; slot <= 2; slot++) {
    rows.push(
      await files.saveShot({
        session: ref,
        slotIndex: slot,
        takeNumber: 1,
        bytes: await jpeg('#336699'),
        source: 'mock',
      }),
    );
  }
  // A retake of slot 1 that the buyer did not keep.
  const retake = await files.saveShot({
    session: ref,
    slotIndex: 1,
    takeNumber: 2,
    bytes: await jpeg('#aa3333'),
    source: 'mock',
  });
  const session = store.session(ref.id)!;
  const strip = await files.saveOutput(
    session,
    'composite',
    `${code}-strip.jpg`,
    await jpeg('#eeeeee'),
    'image/jpeg',
    { width: 64, height: 48 },
  );
  const sheet = await files.saveOutput(
    session,
    'print',
    `${code}-sheet.jpg`,
    await jpeg('#dddddd'),
    'image/jpeg',
    { width: 64, height: 48 },
  );
  store.markSelected(
    ref.id,
    rows.map((r) => r.id),
  );
  store.completeSession(ref.id, {
    frameId: 'frame1',
    filterId: 'filter1',
    paymentMethod: 'free',
    amount: 0,
    extraPrints: 0,
    downloadUrl: `https://x.test/s/${code}`,
    data: {},
    status: 'completed',
  });
  api.paths = [...rows, strip].map((r) => r.path);
  return { ref, rows, retake, strip, sheet };
}

function queue(retentionDays = 0) {
  return new UploadQueue(
    store,
    files,
    api as unknown as DeviceApi,
    telemetry,
    { retentionDays, intervalMs: 60_000 },
    () => {},
    () => new Date(nowMs),
  );
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pb-upload-'));
  store = new AgentStore(dir);
  files = new SessionFiles(store);
  api = new FakeApi();
  nowMs = Date.parse('2026-11-25T02:00:00Z');
});
afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('UploadQueue', () => {
  it('uploads selected originals + composite, completes, and only then deletes the local copy', async () => {
    const s = await makeSession();
    await queue().kick();

    const uploaded = api.calls.filter((c) => c.kind === 'file').map((c) => c.id);
    expect(uploaded.sort()).toEqual([...s.rows.map((r) => r.id), s.strip.id].sort());
    expect(uploaded).not.toContain(s.retake.id); // the discarded retake is not uploaded
    const complete = api.calls.find((c) => c.kind === 'complete')!;
    expect(complete.filesExistOnDisk).toBe(true); // nothing deleted before the API confirmed

    const m = api.manifests[0] as {
      configVersion: number;
      downloadUrl: string;
      shots: { slotIndex: number; fileId: string }[];
      files: { kind: string; name: string; sha256: string }[];
    };
    expect(m.configVersion).toBe(3);
    expect(m.downloadUrl).toBe('https://x.test/s/ABCD2345');
    expect(m.shots.map((x) => x.slotIndex)).toEqual([1, 2]);
    expect(m.files.map((f) => f.name)).toContain('ABCD2345-foto1.jpg');
    expect(m.files.find((f) => f.kind === 'composite')!.name).toBe('ABCD2345-strip.jpg');

    // Confirmed → local copy (including retake and print sheet) is gone.
    for (const f of [...s.rows, s.retake, s.strip, s.sheet]) expect(existsSync(f.path)).toBe(false);
    expect(store.session(s.ref.id)!.sync_status).toBe('purged');
    expect(store.uploadSummary().pending).toBe(0);
  });

  it('a corrupt file in one session does not hold up the others, and is never deleted (audit R4)', async () => {
    const bad = await makeSession('BADD2345');
    await writeFile(bad.rows[0]!.path, 'not the photo any more');
    const good = await makeSession('GOOD2345');
    const events: string[] = [];
    const q = new UploadQueue(
      store,
      files,
      api as unknown as DeviceApi,
      telemetry,
      { retentionDays: 0, intervalMs: 60_000 },
      (kind) => events.push(kind),
      () => new Date(nowMs),
    );
    await q.kick();

    expect(api.calls.filter((c) => c.kind === 'complete').map((c) => c.id)).toEqual([good.ref.id]);
    expect(store.session(good.ref.id)!.sync_status).toBe('purged');
    expect(store.session(bad.ref.id)!.sync_status).toBe('pending');
    expect(existsSync(bad.rows[1]!.path)).toBe(true);
    expect(events).toContain('upload_blocked');
  });

  it('offline: keeps every file, backs off, and uploads once the network is back', async () => {
    const s = await makeSession();
    api.failWith = new TypeError('fetch failed');
    const q = queue();
    await q.kick();
    const row = store.session(s.ref.id)!;
    expect(row.sync_status).toBe('pending');
    expect(row.upload_attempts).toBe(1);
    expect(row.upload_error).toContain('fetch failed');
    expect(Date.parse(row.upload_next_at!)).toBeGreaterThan(nowMs);
    for (const f of [...s.rows, s.strip]) expect(existsSync(f.path)).toBe(true);

    // Still inside the backoff: nothing is tried.
    api.failWith = null;
    await q.kick();
    expect(api.calls).toHaveLength(0);

    // Back online: backoff reset → uploaded.
    q.resetBackoff();
    await q.kick();
    expect(store.session(s.ref.id)!.sync_status).toBe('purged');
    expect(api.calls.some((c) => c.kind === 'complete')).toBe(true);
  });

  it('a failing `complete` never deletes files; missing_files makes the agent re-upload them', async () => {
    const s = await makeSession();
    const missing = new DeviceApiError(409, 'Ada file yang belum tersimpan', 'missing_files');
    missing.missing = [s.rows[0]!.id];
    api.completeFailWith = missing;
    const q = queue();
    await q.kick();
    for (const f of [...s.rows, s.strip]) expect(existsSync(f.path)).toBe(true);
    expect(store.session(s.ref.id)!.sync_status).toBe('pending');
    expect(store.file(s.rows[0]!.id)!.upload_status).toBe('pending');

    nowMs += 5_000;
    await q.kick();
    // Only the missing file was sent again.
    expect(api.calls.filter((c) => c.kind === 'file' && c.id === s.rows[0]!.id)).toHaveLength(2);
    expect(api.calls.filter((c) => c.kind === 'file' && c.id === s.rows[1]!.id)).toHaveLength(1);
    expect(store.session(s.ref.id)!.sync_status).toBe('purged');
  });

  it('waits (without giving up) while the API has not received the session record yet', async () => {
    await makeSession();
    api.failWith = new DeviceApiError(409, 'Sesi belum diterima', 'session_unknown');
    await queue().kick();
    const row = store.sessions()[0]!;
    expect(row.sync_status).toBe('pending');
    expect(Date.parse(row.upload_next_at!) - nowMs).toBeLessThanOrEqual(10_000);
  });

  it('retention: the local copy stays N days after a confirmed upload, then is deleted', async () => {
    const s = await makeSession();
    const q = queue(7);
    await q.kick();
    expect(store.session(s.ref.id)!.sync_status).toBe('uploaded');
    for (const f of [...s.rows, s.strip]) expect(existsSync(f.path)).toBe(true);

    nowMs += 6 * 86_400_000;
    await q.kick();
    expect(existsSync(s.strip.path)).toBe(true);

    nowMs += 2 * 86_400_000;
    await q.kick();
    for (const f of [...s.rows, s.strip]) expect(existsSync(f.path)).toBe(false);
    expect(store.session(s.ref.id)!.sync_status).toBe('purged');
  });

  it('backoff grows and is capped', () => {
    expect(uploadBackoffMs(0)).toBe(10_000);
    expect(uploadBackoffMs(3)).toBe(80_000);
    expect(uploadBackoffMs(30)).toBe(600_000);
  });
});
