import { describe, expect, it } from 'vitest';
import { parsePairingPayload } from './link';

describe('pairing QR', () => {
  const valid = {
    t: 'pb-camera',
    v: 1,
    hosts: ['192.168.1.20'],
    port: 47811,
    code: 'a'.repeat(32),
    agentId: 'ag1',
  };

  it('accepts the kiosk payload', () => {
    expect(parsePairingPayload(JSON.stringify(valid))).toEqual(valid);
  });

  it('rejects other QR codes and other protocol versions', () => {
    expect(parsePairingPayload('https://example.com')).toBeNull();
    expect(parsePairingPayload(JSON.stringify({ ...valid, t: 'other' }))).toBeNull();
    expect(parsePairingPayload(JSON.stringify({ ...valid, v: 2 }))).toBeNull();
    expect(parsePairingPayload(JSON.stringify({ ...valid, port: '47811' }))).toBeNull();
  });
});
