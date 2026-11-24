import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TokenFile } from './device-api';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('device token file', () => {
  it('stores and removes the token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-token-'));
    dirs.push(dir);
    const f = new TokenFile(dir);
    f.write('secret-token');
    expect(f.read()).toBe('secret-token');
    f.write(null);
    expect(f.read()).toBeNull();
  });

  it.runIf(process.platform === 'win32')(
    'on Windows only the current user and SYSTEM may read it (audit R7)',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'pb-token-'));
      dirs.push(dir);
      new TokenFile(dir).write('secret-token');
      const path = join(dir, 'device-token');
      const acl = execFileSync('icacls', [path], { encoding: 'utf8' });
      expect(acl).not.toMatch(/\(I\)/); // nothing inherited from the folder
      expect(acl).not.toMatch(/Everyone|BUILTIN\\Users|Authenticated Users/i);
      expect(acl.toLowerCase()).toContain(userInfo().username.toLowerCase());
      expect(readFileSync(path, 'utf8')).toBe('secret-token');
    },
  );
});
