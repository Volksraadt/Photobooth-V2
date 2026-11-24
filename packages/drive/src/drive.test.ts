import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DriveClient, DriveError, DRIVE_SCOPE, endpointsFromBase, GoogleOAuth } from './index';
import { FakeGoogle } from './testing';

const fake = new FakeGoogle();
let oauth: GoogleOAuth;
let drive: DriveClient;
let refreshToken = '';
let access: string | null = null;

beforeAll(async () => {
  const base = await fake.start();
  const endpoints = endpointsFromBase(base);
  oauth = new GoogleOAuth({
    clientId: 'cid',
    clientSecret: 'secret',
    redirectUri: 'http://localhost/cb',
    endpoints,
  });
  const t = await oauth.exchangeCode('fake-code');
  refreshToken = t.refreshToken!;
  access = t.accessToken;
  drive = new DriveClient(async (force) => {
    if (force || !access) access = (await oauth.refresh(refreshToken)).accessToken;
    return access;
  }, endpoints);
});
afterAll(() => fake.stop());

describe('GoogleOAuth', () => {
  it('asks for drive.file only, offline access and consent', () => {
    const u = new URL(oauth.authUrl('state-1'));
    expect(u.searchParams.get('scope')).toBe(DRIVE_SCOPE);
    expect(u.searchParams.get('scope')).not.toMatch(/auth\/drive$/);
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('state')).toBe('state-1');
  });
});

describe('DriveClient', () => {
  it('creates folders once (ensureFolder is idempotent) and uploads without duplicating', async () => {
    const root = await drive.ensureFolder('Photobooth', null);
    const again = await drive.ensureFolder('Photobooth', null);
    expect(again.id).toBe(root.id);
    const sub = await drive.ensureFolder('2026-11-25', root.id);
    const bytes = Buffer.from('hello');
    const a = await drive.uploadFile({
      name: 'a.jpg',
      parentId: sub.id,
      bytes,
      mimeType: 'image/jpeg',
    });
    const b = await drive.uploadFile({
      name: 'a.jpg',
      parentId: sub.id,
      bytes,
      mimeType: 'image/jpeg',
    });
    expect(a.reused).toBe(false);
    expect(b).toEqual({ id: a.id, reused: true });
    expect(fake.children(sub.id)).toHaveLength(1);
    await drive.shareAnyoneReader(sub.id);
    expect(fake.files.get(sub.id)!.permissions).toEqual([
      { role: 'reader', type: 'anyone', allowFileDiscovery: false },
    ]);
    expect(await drive.accountEmail()).toBe('owner@example.test');
  });

  it('classifies a missing folder', async () => {
    expect(await drive.getFolder('does-not-exist')).toBeNull();
  });

  it('retries once with a fresh token when the access token expired', async () => {
    access = 'stale-token';
    const folders = await drive.listAppFolders();
    expect(folders.length).toBeGreaterThan(0);
  });

  it('maps quota and transient failures', async () => {
    const root = await drive.ensureFolder('Photobooth', null);
    fake.quotaFull = true;
    await expect(
      drive.uploadFile({
        name: 'q.jpg',
        parentId: root.id,
        bytes: Buffer.from('q'),
        mimeType: 'image/jpeg',
      }),
    ).rejects.toMatchObject({ kind: 'quota' });
    fake.quotaFull = false;
    fake.failUploads = 1;
    await expect(
      drive.uploadFile({
        name: 't.jpg',
        parentId: root.id,
        bytes: Buffer.from('t'),
        mimeType: 'image/jpeg',
      }),
    ).rejects.toMatchObject({ kind: 'transient' });
  });

  it('reports revoked access as an auth error', async () => {
    fake.revokeAccess();
    await expect(oauth.refresh(refreshToken)).rejects.toMatchObject({
      kind: 'auth',
      reason: 'invalid_grant',
    });
    await expect(drive.listAppFolders()).rejects.toBeInstanceOf(DriveError);
    fake.revoked = false;
  });
});
