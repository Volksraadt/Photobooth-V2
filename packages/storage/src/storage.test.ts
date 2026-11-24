import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DiskStorage,
  safeDownloadUrl,
  safeFileName,
  SessionManifestSchema,
  sessionObjectKey,
  StorageError,
} from './index';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe('DiskStorage', () => {
  it('stores, reads, checks and deletes objects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pb-storage-'));
    dirs.push(dir);
    const s = new DiskStorage(dir);
    const key = sessionObjectKey('org1', 'sess1', 'original', 'a b.jpg');
    expect(key).toBe('org1/sessions/sess1/original/a_b.jpg');
    await s.put(key, Buffer.from('hello'), 'text/plain');
    expect(await s.exists(key)).toBe(true);
    expect((await s.get(key)).toString()).toBe('hello');
    await s.deletePrefix('org1/sessions/sess1');
    expect(await s.exists(key)).toBe(false);
    await expect(s.get(key)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects keys that escape the root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pb-storage-'));
    dirs.push(dir);
    const s = new DiskStorage(dir);
    await expect(s.put('../evil.txt', Buffer.from('x'), 'text/plain')).rejects.toBeInstanceOf(
      StorageError,
    );
  });
});

describe('manifest', () => {
  it('sanitizes names', () => {
    expect(safeFileName('a b?.jpg')).toBe('a_b_.jpg');
    expect(safeFileName('../x.jpg')).toBe('_x.jpg');
    expect(safeFileName('')).toBe('file');
  });

  it('validates a manifest', () => {
    const ok = SessionManifestSchema.safeParse({
      version: 1,
      configVersion: 3,
      frameId: 'f1',
      filterId: 'none',
      shots: [{ slotIndex: 1, takeNumber: 1, fileId: 'abcdefgh1' }],
      files: [
        {
          id: 'abcdefgh1',
          kind: 'original',
          name: 'a.jpg',
          sha256: 'a'.repeat(64),
          bytes: 10,
          mimeType: 'image/jpeg',
          slotIndex: 1,
        },
      ],
    });
    expect(ok.success).toBe(true);
    expect(SessionManifestSchema.safeParse({ version: 1 }).success).toBe(false);
  });
});

describe('safeDownloadUrl (audit R5)', () => {
  it("keeps the device's short link only when it is exactly /s/<this code>", () => {
    expect(safeDownloadUrl('https://pb.test/s/ABCD2345', 'ABCD2345', null)).toBe(
      'https://pb.test/s/ABCD2345',
    );
    expect(safeDownloadUrl('https://foto.custom.id/s/ABCD2345', 'ABCD2345', null)).toBe(
      'https://foto.custom.id/s/ABCD2345',
    );
    for (const bad of [
      'https://evil.test/phish',
      'https://pb.test/s/OTHER234',
      'https://pb.test/s/ABCD2345?next=https://evil.test',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(safeDownloadUrl(bad, 'ABCD2345', 'https://api.pb.test/'), bad).toBe(
        'https://api.pb.test/s/ABCD2345',
      );
    }
    expect(safeDownloadUrl(null, 'ABCD2345', null)).toBeNull();
  });
});
