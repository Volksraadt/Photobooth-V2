import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createSecretBox,
  hashPassword,
  parseMasterKey,
  randomToken,
  SecretBoxError,
  sha256Hex,
  verifyPassword,
} from './index';

const key = randomBytes(32);
const box = createSecretBox(key);

describe('SecretBox (AES-256-GCM)', () => {
  it('round-trips a secret', () => {
    const payload = box.encrypt('SB-Mid-server-abc123', 'org:1:midtrans');
    expect(payload.startsWith('v1.')).toBe(true);
    expect(payload).not.toContain('SB-Mid');
    expect(box.decrypt(payload, 'org:1:midtrans')).toBe('SB-Mid-server-abc123');
  });

  it('uses a fresh IV each time', () => {
    expect(box.encrypt('x', 'a')).not.toBe(box.encrypt('x', 'a'));
  });

  it('round-trips unicode and empty strings', () => {
    expect(box.decrypt(box.encrypt('', 'a'), 'a')).toBe('');
    expect(box.decrypt(box.encrypt('rahasia 🔐 ✓', 'a'), 'a')).toBe('rahasia 🔐 ✓');
  });

  it('fails when AAD differs (secret moved to another org)', () => {
    const payload = box.encrypt('secret', 'org:1:midtrans');
    expect(() => box.decrypt(payload, 'org:2:midtrans')).toThrow(SecretBoxError);
  });

  it('fails when ciphertext is tampered', () => {
    const parts = box.encrypt('secret', 'a').split('.');
    const ct = Buffer.from(parts[4]!, 'base64url');
    ct[0] = ct[0]! ^ 0xff;
    parts[4] = ct.toString('base64url');
    expect(() => box.decrypt(parts.join('.'), 'a')).toThrow(/authentication failed/);
  });

  it('fails with a different master key', () => {
    const other = createSecretBox(randomBytes(32));
    expect(() => other.decrypt(box.encrypt('secret', 'a'), 'a')).toThrow(/different key/);
  });

  it('rejects malformed payloads', () => {
    expect(() => box.decrypt('garbage', 'a')).toThrow(SecretBoxError);
    expect(() => box.decrypt('v2.a.b.c.d', 'a')).toThrow(SecretBoxError);
  });
});

describe('parseMasterKey', () => {
  it('accepts 32-byte base64 keys and rejects others', () => {
    expect(parseMasterKey(key.toString('base64')).equals(key)).toBe(true);
    expect(() => parseMasterKey(undefined)).toThrow(/not set/);
    expect(() => parseMasterKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('helpers', () => {
  it('sha256Hex is stable and hex', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('randomToken is url-safe', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('password hashing', () => {
  it('verifies the right password only', () => {
    const stored = hashPassword('rahasia123');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('rahasia123', stored)).toBe(true);
    expect(verifyPassword('salah', stored)).toBe(false);
    expect(verifyPassword('rahasia123', 'garbage')).toBe(false);
  });
});
