import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSettings } from './settings';

afterEach(() => vi.unstubAllEnvs());

describe('readSettings: booth mode', () => {
  it('dev server shows the dev overlay, but never on a real booth', () => {
    vi.stubEnv('DEV', true);
    expect(readSettings('')).toMatchObject({ dev: true, kiosk: false });
    vi.stubEnv('VITE_BOOTH', '1');
    expect(readSettings('')).toMatchObject({ dev: false, kiosk: true });
    // Support can still opt in explicitly.
    expect(readSettings('?dev=1&kiosk=0')).toMatchObject({ dev: true, kiosk: false });
  });
});
