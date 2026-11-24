import { describe, expect, it } from 'vitest';
import { ADMIN_PIN_HASH_RE, hashAdminPin, verifyAdminPin } from './admin-pin';
import { createDefaultBoothConfig } from './default-config';
import { validateBoothConfig } from './validate';

describe('admin PIN hash', () => {
  it('hashes with a random salt and verifies', async () => {
    const a = await hashAdminPin('1234', { iterations: 1000 });
    const b = await hashAdminPin('1234', { iterations: 1000 });
    expect(a).toMatch(ADMIN_PIN_HASH_RE);
    expect(a).not.toBe(b);
    expect(await verifyAdminPin('1234', a)).toBe(true);
    expect(await verifyAdminPin('1235', a)).toBe(false);
  });

  it('refuses empty or malformed hashes and bad PINs', async () => {
    expect(await verifyAdminPin('1234', '')).toBe(false);
    expect(await verifyAdminPin('1234', 'plain-1234')).toBe(false);
    await expect(hashAdminPin('12')).rejects.toThrow();
    await expect(hashAdminPin('abcd')).rejects.toThrow();
  });

  it('is accepted by the config schema (and empty stays valid)', async () => {
    const config = createDefaultBoothConfig({ boothId: 'b' });
    expect(validateBoothConfig(config).success).toBe(true);
    config.admin.pinHash = await hashAdminPin('987654', { iterations: 1000 });
    expect(validateBoothConfig(config).success).toBe(true);
    config.admin.pinHash = '1234';
    const result = validateBoothConfig(config);
    expect(result.success).toBe(false);
  });
});
