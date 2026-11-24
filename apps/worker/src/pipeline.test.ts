import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSecretBox,
  devUserTokenVerifier,
  randomToken,
  sha256Hex,
  signDevUserToken,
} from '@pb/crypto';
import {
  BoothConfigEvents,
  boothConfigs,
  devices,
  getDriveConnection,
  orgMembers,
  plans,
  sessionOutputs,
  sessions,
  subscriptions,
  uploadJobs,
  type Db,
} from '@pb/db';
import { createTestDb, createTestUser, seed } from '@pb/db/testing';
import { AccessTokenCache, endpointsFromBase, GoogleOAuth } from '@pb/drive';
import { FakeGoogle } from '@pb/drive/testing';
import type { BoothConfig } from '@pb/schema';
import { MemoryStorage } from '@pb/storage';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../api/src/app';
import { DeviceApi } from '../../agent/src/device-api';
import { SessionFiles } from '../../agent/src/sessions';
import { AgentStore } from '../../agent/src/store';
import { UploadQueue } from '../../agent/src/uploads';
import { resolveFfmpeg } from './ffmpeg';
import { JobRunner } from './runner';
import { localDay } from './upload-drive';

/**
 * F5 acceptance, end to end with the real API app, compositor and ffmpeg; only Google is a local
 * fake (packages/drive/src/fake-google.ts) and the database is in-memory Postgres.
 */

const SECRET = 'test-secret-'.padEnd(48, 'x');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const KINDS = ['original', 'mirrored', 'filtered', 'composite', 'gif', 'video'] as const;

let db: Db;
let close: () => Promise<void>;
let fake: FakeGoogle;
let storage: MemoryStorage;
let app: ReturnType<typeof createApp>;
let runner: JobRunner;
let orgId: string;
let boothId: string;
let userToken: string;
let deviceToken: string;
let frameId = '';
let filterId = '';
let nowMs = Date.now();
let seq = 0;

const api = (path: string, init: RequestInit & { token?: string } = {}) =>
  app.request(`http://api.test${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${init.token ?? deviceToken}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });

async function photo(color: string) {
  // A red square in the top-left corner makes mirroring observable.
  return sharp({ create: { width: 1600, height: 1200, channels: 3, background: color } })
    .composite([
      {
        input: await sharp({
          create: { width: 200, height: 200, channels: 3, background: '#ff0000' },
        })
          .png()
          .toBuffer(),
        left: 0,
        top: 0,
      },
    ])
    .jpeg()
    .toBuffer();
}

/** Owner connects Google Drive through the real OAuth endpoints (consent is auto-approved). */
/** Full OAuth round trip; `as` = the user whose browser finishes it (default: the one who started). */
async function connectDrive(as?: string) {
  const res = await api(`/studio/orgs/${orgId}/integrations/google-drive/connect`, {
    method: 'POST',
    token: userToken,
  });
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as { url: string };
  const consent = await fetch(url, { redirect: 'manual' });
  const back = new URL(consent.headers.get('location')!);
  const cb = await app.request(`http://api.test${back.pathname}${back.search}`);
  expect(cb.status).toBe(302);
  // The API callback only forwards to Studio, which completes as the signed-in user (audit S5).
  const studio = new URL(cb.headers.get('location')!);
  expect(studio.origin + studio.pathname).toBe('http://studio.test/integrations/drive/callback');
  const done = await api('/studio/integrations/google-drive/complete', {
    method: 'POST',
    token: as ?? userToken,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: studio.searchParams.get('code'),
      state: studio.searchParams.get('state'),
    }),
  });
  const { result } = (await done.json()) as { result: string };
  return `http://studio.test/integrations?drive=${result}`;
}

type Agent = { id: string; code: string; composite?: boolean };

/** Plays the agent: session record (outbox), every file, then `complete`. */
async function agentUpload(a: Agent, startedAt = new Date('2026-11-24T17:30:00Z')) {
  const rec = await api('/device/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      events: [],
      printJobs: [],
      sessions: [
        {
          id: `ob${a.id}`,
          session: {
            id: a.id,
            code: a.code,
            startedAt: startedAt.toISOString(),
            completedAt: new Date(startedAt.getTime() + 60_000).toISOString(),
            status: 'completed',
            frameId,
            filterId,
            paymentMethod: 'free',
            amount: 0,
            extraPrints: 0,
            offline: false,
          },
        },
      ],
    }),
  });
  expect(((await rec.json()) as { accepted: string[] }).accepted).toContain(`ob${a.id}`);

  const colors = ['#3366cc', '#33aa55', '#cc8833', '#aa3366'];
  const files: {
    id: string;
    kind: 'original' | 'composite';
    name: string;
    bytes: Buffer;
    slot: number | null;
  }[] = [];
  for (let i = 1; i <= 4; i++)
    files.push({
      id: `${a.id}orig${i}`,
      kind: 'original',
      name: `slot${i}-take1.jpg`,
      bytes: await photo(colors[i - 1]!),
      slot: i,
    });
  if (a.composite !== false)
    files.push({
      id: `${a.id}strip`,
      kind: 'composite',
      name: `${a.code}-strip.jpg`,
      bytes: await sharp({
        create: { width: 600, height: 1800, channels: 3, background: '#eeeeee' },
      })
        .jpeg()
        .toBuffer(),
      slot: null,
    });
  const put = (f: (typeof files)[number], body: Buffer = f.bytes) =>
    api(`/device/sessions/${a.id}/files/${f.id}`, {
      method: 'PUT',
      headers: {
        'content-type': 'image/jpeg',
        'x-pb-kind': f.kind,
        'x-pb-name': f.name,
        'x-pb-sha256': sha(f.bytes),
        ...(f.slot ? { 'x-pb-slot': String(f.slot) } : {}),
      },
      body,
    });
  for (const f of files) expect((await put(f)).status).toBe(200);
  const manifest = {
    version: 1,
    configVersion: 1,
    frameId,
    filterId,
    downloadUrl: `http://api.test/s/${a.code}`,
    shots: files
      .filter((f) => f.kind === 'original')
      .map((f) => ({ slotIndex: f.slot!, takeNumber: 1, fileId: f.id })),
    files: files.map((f) => ({
      id: f.id,
      kind: f.kind,
      name: f.name,
      sha256: sha(f.bytes),
      bytes: f.bytes.byteLength,
      mimeType: 'image/jpeg',
      slotIndex: f.slot,
    })),
  };
  const complete = () =>
    api(`/device/sessions/${a.id}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(manifest),
    });
  return { files, manifest, put, complete };
}

const newSession = (): Agent => {
  seq++;
  const n = String(seq).padStart(2, '0');
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return { id: `sess${n}aaaaaa`, code: `TEST${A[seq % 24]}${A[Math.floor(seq / 24)]}AB` };
};

async function jobs(sessionId: string) {
  const rows = await db.select().from(uploadJobs).where(eq(uploadJobs.sessionId, sessionId));
  return Object.fromEntries(rows.map((r) => [r.target, r]));
}
async function sessionRow(id: string) {
  const [s] = await db.select().from(sessions).where(eq(sessions.id, id));
  return s!;
}
async function setPlan(code: 'starter' | 'pro') {
  const [p] = await db.select().from(plans).where(eq(plans.code, code));
  await db.update(subscriptions).set({ planId: p!.id }).where(eq(subscriptions.orgId, orgId));
}
async function sessionFolder(s: Agent) {
  const booth = (await db.select().from(sessions).where(eq(sessions.id, s.id)))[0]!;
  const day = localDay(booth.startedAt, 'Asia/Jakarta');
  return fake.find(['Photobooth', 'Booth Demo', day, s.code]);
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  fake = new FakeGoogle();
  const base = await fake.start();
  storage = new MemoryStorage();
  const box = createSecretBox(Buffer.alloc(32, 7));
  const google = new GoogleOAuth({
    clientId: 'cid',
    clientSecret: 'secret',
    redirectUri: 'http://api.test/oauth/google/callback',
    endpoints: endpointsFromBase(base),
  });
  const tokens = new AccessTokenCache();
  const userId = await createTestUser(db, 'owner-f5@example.com');
  ({ orgId, boothId } = await seed(db));
  await db.insert(orgMembers).values({ orgId, userId, role: 'owner' });
  userToken = await signDevUserToken(SECRET, { userId, email: 'owner-f5@example.com' });
  deviceToken = randomToken();
  await db
    .insert(devices)
    .values({ orgId, boothId, name: 'Laptop', tokenHash: sha256Hex(deviceToken) });
  const [cfg] = await db.select().from(boothConfigs).where(eq(boothConfigs.boothId, boothId));
  const config = cfg!.config as BoothConfig;
  frameId = config.frames[0]!.id;
  filterId = config.filters.find((f) => !f.isDefault)!.id;
  app = createApp({
    db,
    verifyUserToken: devUserTokenVerifier(SECRET),
    configEvents: new BoothConfigEvents(),
    secretBox: box,
    storage,
    google,
    driveTokens: tokens,
    studioUrl: 'http://studio.test',
  });
  runner = new JobRunner(
    {
      db,
      storage,
      secretBox: box,
      google,
      driveTokens: tokens,
      ffmpegPath: resolveFfmpeg(),
      now: () => new Date(nowMs),
    },
    2,
  );
}, 120_000);

afterAll(async () => {
  await fake.stop();
  await close();
});

describe('F5 pipeline', () => {
  it('connects Google Drive with drive.file only and stores the refresh token encrypted', async () => {
    // Another signed-in user cannot finish a consent that was started by the owner (audit S5).
    const stranger = await createTestUser(db, 'victim-f5@example.com');
    const strangerToken = await signDevUserToken(SECRET, {
      userId: stranger,
      email: 'victim-f5@example.com',
    });
    expect(await connectDrive(strangerToken)).toBe(
      'http://studio.test/integrations?drive=wrong_user',
    );
    expect(await getDriveConnection(db, orgId)).toBeNull();

    const back = await connectDrive();
    expect(back).toBe('http://studio.test/integrations?drive=connected');
    const conn = (await getDriveConnection(db, orgId))!;
    expect(conn.status).toBe('ok');
    expect(conn.googleEmail).toBe('owner@example.test');
    expect(conn.rootFolderName).toBe('Photobooth');
    expect(conn.encryptedRefreshToken.startsWith('v1.')).toBe(true);
    expect(conn.encryptedRefreshToken).not.toContain('fake-refresh-token');
    const authUrl = new URL(
      (
        (await (
          await api(`/studio/orgs/${orgId}/integrations/google-drive/connect`, {
            method: 'POST',
            token: userToken,
          })
        ).json()) as { url: string }
      ).url,
    );
    expect(authUrl.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
  });

  it('turns one finished session into six Drive subfolders in < 2 minutes; QR link goes processing → Drive', async () => {
    const s = newSession();
    const t0 = performance.now();
    const up = await agentUpload(s);

    // Before the worker has run: the short link shows "processing" with auto refresh.
    expect((await up.complete()).status).toBe(200);
    const early = await app.request(`http://api.test/s/${s.code.toLowerCase()}`);
    expect(early.status).toBe(200);
    const html = await early.text();
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain('sedang diproses');

    await runner.drain();
    const elapsedSec = (performance.now() - t0) / 1000;
    expect(elapsedSec).toBeLessThan(120);

    const j = await jobs(s.id);
    expect(j.storage?.status).toBe('done');
    expect(j.drive?.status).toBe('done');

    const folder = (await sessionFolder(s))!;
    expect(folder).toBeDefined();
    const sub = new Map(fake.children(folder.id).map((f) => [f.name, f]));
    expect([...sub.keys()].sort()).toEqual([...KINDS].sort());
    const count = (k: string) => fake.children(sub.get(k)!.id).length;
    expect(count('original')).toBe(4);
    expect(count('mirrored')).toBe(4);
    expect(count('filtered')).toBe(4);
    expect(count('composite')).toBe(1);
    expect(count('gif')).toBe(1);
    expect(count('video')).toBe(1);
    expect(folder.permissions).toEqual([
      { role: 'reader', type: 'anyone', allowFileDiscovery: false },
    ]);

    // original = untouched camera file; Pro plan = no watermark, so composite = the booth's file.
    const orig = fake.children(sub.get('original')!.id).find((f) => f.name.includes('slot1'))!;
    expect(sha(orig.bytes!)).toBe(sha(up.files[0]!.bytes));
    const strip = fake.children(sub.get('composite')!.id)[0]!;
    expect(sha(strip.bytes!)).toBe(sha(up.files[4]!.bytes));

    // mirrored: the red marker moves from the left edge to the right edge.
    const mirrored = fake.children(sub.get('mirrored')!.id).find((f) => f.name.includes('foto1'))!;
    const raw = await sharp(mirrored.bytes!).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const i = (y * raw.info.width + x) * raw.info.channels;
      return [raw.data[i]!, raw.data[i + 1]!, raw.data[i + 2]!];
    };
    expect(px(1500, 100)[0]).toBeGreaterThan(200); // red now at the right
    expect(px(1500, 100)[1]).toBeLessThan(80);
    expect(px(100, 100)[0]).toBeLessThan(120); // left is the blue background

    // gif has one frame per selected photo, mp4 is a real 1080×1920 file.
    const gif = fake.children(sub.get('gif')!.id)[0]!;
    expect((await sharp(gif.bytes!, { animated: true }).metadata()).pages).toBe(4);
    const mp4 = fake.children(sub.get('video')!.id)[0]!;
    expect(mp4.bytes!.subarray(4, 8).toString()).toBe('ftyp');
    expect(mp4.bytes!.byteLength).toBeGreaterThan(5_000);

    // Short link now redirects to the very same folder.
    const redirect = await app.request(`http://api.test/s/${s.code}`);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe(
      `https://drive.google.com/drive/folders/${folder.id}`,
    );
    expect((await sessionRow(s.id)).driveFolderUrl).toBe(redirect.headers.get('location'));
  }, 180_000);

  it('rebuilds the composite when the booth did not send one', async () => {
    const s = newSession();
    const up = await agentUpload({ ...s, composite: false });
    expect((await up.complete()).status).toBe(200);
    await runner.drain();
    const folder = (await sessionFolder(s))!;
    const composite = fake.children(
      fake.children(folder.id).find((f) => f.name === 'composite')!.id,
    );
    expect(composite).toHaveLength(1);
    const meta = await sharp(composite[0]!.bytes!).metadata();
    expect([meta.width, meta.height]).toEqual([600, 1800]);
  }, 180_000);

  it('offline session: the printed QR is valid before the server knows the code, then reaches Drive', async () => {
    const s = newSession();
    // Booth offline: nothing reached the server yet. The code is not known; the page says so politely.
    const before = await app.request(`http://api.test/s/${s.code}`);
    expect(before.status).toBe(404);
    expect(await before.text()).toContain('tanpa internet');
    // Booth back online: upload, process.
    const up = await agentUpload(s);
    expect((await up.complete()).status).toBe(200);
    expect((await app.request(`http://api.test/s/${s.code}`)).status).toBe(200);
    await runner.drain();
    const after = await app.request(`http://api.test/s/${s.code}`);
    expect(after.status).toBe(302);
    expect(after.headers.get('location')).toMatch(
      /^https:\/\/drive\.google\.com\/drive\/folders\//,
    );
    // Garbage codes never reveal anything.
    expect((await app.request('http://api.test/s/abc')).status).toBe(404);
    expect((await app.request('http://api.test/s/%3Cscript%3E')).status).toBe(404);
  }, 180_000);

  it('adds the platform watermark for plans that require it (not on original/)', async () => {
    await setPlan('starter');
    try {
      const s = newSession();
      const up = await agentUpload(s);
      expect((await up.complete()).status).toBe(200);
      await runner.drain();
      const folder = (await sessionFolder(s))!;
      const dir = (n: string) =>
        fake.children(fake.children(folder.id).find((f) => f.name === n)!.id);
      expect(sha(dir('original')[0]!.bytes!)).toBe(sha(up.files[0]!.bytes));
      const strip = dir('composite')[0]!;
      expect(sha(strip.bytes!)).not.toBe(sha(up.files[4]!.bytes));
      // The badge sits bottom right: that area is darker than the plain #eee paper.
      const raw = await sharp(strip.bytes!).raw().toBuffer({ resolveWithObject: true });
      let sum = 0;
      let n = 0;
      for (let y = raw.info.height - 36; y < raw.info.height - 20; y++)
        for (let x = raw.info.width - 200; x < raw.info.width - 20; x++) {
          sum += raw.data[(y * raw.info.width + x) * raw.info.channels]!;
          n++;
        }
      expect(sum / n).toBeLessThan(215); // plain paper is 238
      expect(dir('mirrored')[0]!.bytes!.byteLength).toBeGreaterThan(0);
    } finally {
      await setPlan('pro');
    }
  }, 180_000);

  it('retries transient Drive errors with backoff and never duplicates files', async () => {
    const s = newSession();
    const up = await agentUpload(s);
    expect((await up.complete()).status).toBe(200);
    fake.failUploads = 2;
    await runner.drain();
    let j = await jobs(s.id);
    expect(j.drive?.status).toBe('pending');
    expect(j.drive?.attempts).toBe(1);
    expect(j.drive?.nextAttemptAt!.getTime()).toBeGreaterThan(nowMs);
    expect((await sessionRow(s.id)).driveFolderUrl).toBeNull();
    nowMs += 5 * 60_000;
    await runner.drain();
    nowMs += 20 * 60_000;
    await runner.drain();
    j = await jobs(s.id);
    expect(j.drive?.status).toBe('done');
    const folder = (await sessionFolder(s))!;
    const names = fake.children(folder.id).map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const sub of fake.children(folder.id)) {
      const files = fake.children(sub.id).map((f) => f.name);
      expect(new Set(files).size).toBe(files.length);
    }
    nowMs = Date.now();
  }, 180_000);

  it('revoked Drive access: job fails with a clear message, files stay safe, reconnecting recovers', async () => {
    const s = newSession();
    const up = await agentUpload(s);
    expect((await up.complete()).status).toBe(200);
    fake.revokeAccess();
    await runner.drain();

    const j = await jobs(s.id);
    expect(j.storage?.status).toBe('done'); // processing itself needs no Drive
    expect(j.drive?.status).toBe('failed');
    expect(j.drive?.errorCode).toBe('drive_revoked');
    expect(j.drive?.lastError).toContain('Akses Google Drive dicabut');
    expect((await getDriveConnection(db, orgId))!.status).toBe('revoked');
    // Files are still in object storage, and the buyer's page does not spin forever on an owner problem.
    const outputs = await db
      .select()
      .from(sessionOutputs)
      .where(eq(sessionOutputs.sessionId, s.id));
    expect(outputs.length).toBeGreaterThanOrEqual(14);
    for (const o of outputs) expect(await storage.exists(o.storagePath!)).toBe(true);
    const page = await app.request(`http://api.test/s/${s.code}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('sedang diproses');

    // Owner reconnects: the failed job starts again by itself.
    expect(await connectDrive()).toContain('drive=connected');
    expect((await jobs(s.id)).drive?.status).toBe('pending');
    await runner.drain();
    expect((await jobs(s.id)).drive?.status).toBe('done');
    expect((await app.request(`http://api.test/s/${s.code}`)).status).toBe(302);
  }, 180_000);

  it('full Drive: fails with a quota message; manual retry from Studio works once space is free', async () => {
    const s = newSession();
    const up = await agentUpload(s);
    expect((await up.complete()).status).toBe(200);
    fake.quotaFull = true;
    await runner.drain();
    const failed = (await jobs(s.id)).drive!;
    expect(failed.status).toBe('failed');
    expect(failed.errorCode).toBe('drive_quota');
    expect(failed.lastError).toContain('penuh');

    fake.quotaFull = false;
    const retry = await api(`/studio/orgs/${orgId}/sessions/${s.id}/retry-upload`, {
      method: 'POST',
      token: userToken,
    });
    expect(retry.status).toBe(200);
    expect((await jobs(s.id)).drive?.status).toBe('pending');
    await runner.drain();
    expect((await jobs(s.id)).drive?.status).toBe('done');
    // Nothing failed → a second retry is refused.
    const again = await api(`/studio/orgs/${orgId}/sessions/${s.id}/retry-upload`, {
      method: 'POST',
      token: userToken,
    });
    expect(again.status).toBe(409);
  }, 180_000);

  it('no Drive connection: job fails with drive_not_connected (files kept)', async () => {
    const conn = (await getDriveConnection(db, orgId))!;
    const { driveConnections } = await import('@pb/db');
    await db.delete(driveConnections).where(eq(driveConnections.orgId, orgId));
    const s = newSession();
    const up = await agentUpload(s);
    expect((await up.complete()).status).toBe(200);
    await runner.drain();
    const j = (await jobs(s.id)).drive!;
    expect([j.status, j.errorCode]).toEqual(['failed', 'drive_not_connected']);
    await connectDrive();
    await runner.drain();
    expect((await jobs(s.id)).drive?.status).toBe('done');
    expect(conn.orgId).toBe(orgId);
  }, 180_000);
});

describe('agent upload endpoints', () => {
  it('rejects a body that does not match its hash, and a manifest with missing files', async () => {
    const s = newSession();
    const up = await agentUpload(s);
    const bad = await up.put({ ...up.files[0]!, id: 'freshfileid001' }, Buffer.from('truncated'));
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: string }).error).toBe('hash_mismatch');

    const manifest = {
      ...up.manifest,
      files: [
        ...up.manifest.files,
        { ...up.manifest.files[0]!, id: 'neveruploaded1', sha256: 'a'.repeat(64) },
      ],
    };
    const res = await api(`/device/sessions/${s.id}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(manifest),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { missing: string[] }).missing).toEqual(['neveruploaded1']);
  });

  it('is idempotent and unknown sessions wait for their outbox record', async () => {
    const s = newSession();
    const up = await agentUpload(s);
    const again = await up.put(up.files[0]!);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { already: boolean }).already).toBe(true);
    expect((await up.complete()).status).toBe(200);
    expect((await up.complete()).status).toBe(200);
    expect(Object.keys(await jobs(s.id))).toEqual(['storage']);

    const orphan = await api('/device/sessions/doesnotexist1/files/fileidabcdef1', {
      method: 'PUT',
      headers: {
        'x-pb-kind': 'original',
        'x-pb-name': 'a.jpg',
        'x-pb-sha256': 'a'.repeat(64),
        'x-pb-slot': '1',
      },
      body: Buffer.from('x'),
    });
    expect(orphan.status).toBe(409);
    expect(((await orphan.json()) as { error: string }).error).toBe('session_unknown');
  });

  it("another booth's device cannot touch this session", async () => {
    const s = newSession();
    await agentUpload(s);
    const { booths } = await import('@pb/db');
    const [other] = await db.insert(booths).values({ orgId, name: 'Other' }).returning();
    const token = randomToken();
    await db
      .insert(devices)
      .values({ orgId, boothId: other!.id, name: 'X', tokenHash: sha256Hex(token) });
    const res = await api(`/device/sessions/${s.id}/files/${s.id}orig1`, {
      method: 'PUT',
      token,
      headers: { 'x-pb-kind': 'original', 'x-pb-name': 'a.jpg', 'x-pb-sha256': 'a'.repeat(64) },
      body: Buffer.from('x'),
    });
    expect(res.status).toBe(409);
  });
});

describe('real agent code → API → worker → Drive', () => {
  it('the actual UploadQueue and DeviceApi interoperate with the API (offline QR then Drive)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pb-agent-e2e-'));
    const realFetch = globalThis.fetch;
    // Only the agent's calls to the API are routed in-process; Google (127.0.0.1) stays real.
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return url.startsWith('http://api.test') ? app.request(url, init) : realFetch(input, init);
    }) as typeof fetch;
    const store = new AgentStore(dir);
    try {
      const files = new SessionFiles(store);
      const ref = {
        id: 'e2eagentsession1',
        code: 'EAGENT22',
        boothId,
        configVersion: 1,
        startedAt: '2026-11-25T01:00:00.000Z',
      };
      const jpeg = (c: string) =>
        sharp({ create: { width: 800, height: 600, channels: 3, background: c } })
          .jpeg()
          .toBuffer();
      const shots = [];
      for (let slot = 1; slot <= 4; slot++)
        shots.push(
          await files.saveShot({
            session: ref,
            slotIndex: slot,
            takeNumber: 1,
            bytes: await jpeg(['#223344', '#335544', '#554433', '#443355'][slot - 1]!),
            source: 'mock',
          }),
        );
      const session = store.session(ref.id)!;
      await files.saveOutput(
        session,
        'composite',
        'EAGENT22-strip.jpg',
        await sharp({ create: { width: 600, height: 1800, channels: 3, background: '#f0f0f0' } })
          .jpeg()
          .toBuffer(),
        'image/jpeg',
        { width: 600, height: 1800 },
      );
      store.markSelected(
        ref.id,
        shots.map((s) => s.id),
      );
      store.completeSession(ref.id, {
        frameId,
        filterId,
        paymentMethod: 'free',
        amount: 0,
        extraPrints: 0,
        downloadUrl: 'http://api.test/s/EAGENT22',
        data: {},
        status: 'completed',
      });

      // Offline at the booth: the printed QR already points at /s/EAGENT22 but the server has never
      // heard of the session.
      expect((await app.request('http://api.test/s/EAGENT22')).status).toBe(404);

      // Booth online: the session record arrives (outbox), then the real upload queue runs.
      await api('/device/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          events: [],
          printJobs: [],
          sessions: [
            {
              id: 'obe2eagent001',
              session: {
                id: ref.id,
                code: ref.code,
                startedAt: ref.startedAt,
                completedAt: '2026-11-25T01:01:00.000Z',
                status: 'completed',
                frameId,
                filterId,
                paymentMethod: 'free',
                amount: 0,
                extraPrints: 0,
                offline: true,
              },
            },
          ],
        }),
      });
      const queue = new UploadQueue(
        store,
        files,
        new DeviceApi('http://api.test', deviceToken),
        { flush: async () => {}, report: () => {} } as never,
        { retentionDays: 0, intervalMs: 60_000 },
        () => {},
      );
      await queue.kick();
      expect(store.session(ref.id)!.sync_status).toBe('purged');
      expect(existsSync(shots[0]!.path)).toBe(false); // local copy gone only after the API confirmed

      expect((await app.request('http://api.test/s/EAGENT22')).status).toBe(200); // processing
      await runner.drain();
      const res = await app.request('http://api.test/s/EAGENT22');
      expect(res.status).toBe(302);
      const folder = fake.find(['Photobooth', 'Booth Demo', '2026-11-25', 'EAGENT22'])!;
      expect(res.headers.get('location')).toContain(folder.id);
      const sub = (n: string) =>
        fake.children(fake.children(folder.id).find((f) => f.name === n)!.id);
      expect(
        sub('original')
          .map((f) => f.name)
          .sort(),
      ).toEqual([
        'EAGENT22-foto1.jpg',
        'EAGENT22-foto2.jpg',
        'EAGENT22-foto3.jpg',
        'EAGENT22-foto4.jpg',
      ]);
      expect(sub('composite').map((f) => f.name)).toEqual(['EAGENT22-strip.jpg']);
      expect(sub('video')).toHaveLength(1);
    } finally {
      globalThis.fetch = realFetch;
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
