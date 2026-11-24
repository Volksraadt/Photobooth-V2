import { describe, expect, it } from 'vitest';
import {
  formatVoucherCode,
  generateVoucherCode,
  hashVoucherCode,
  hashVoucherCodeAsync,
  normalizeVoucherCode,
} from './voucher';

describe('voucher codes', () => {
  it('generates 12 digits and formats them like the print', () => {
    const code = generateVoucherCode();
    expect(code).toMatch(/^\d{12}$/);
    expect(formatVoucherCode('123412341234')).toBe('1234-1234-1234');
    expect(normalizeVoucherCode(' 1234-1234 1234 ')).toBe('123412341234');
    expect(normalizeVoucherCode('12341234123')).toBeNull();
    expect(normalizeVoucherCode('ABCD12341234')).toBeNull();
  });

  it('hash is per booth, stable, and the same sync/async', async () => {
    const a = hashVoucherCode('booth-a', '123412341234');
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(hashVoucherCode('booth-a', '123412341234')).toBe(a);
    expect(hashVoucherCode('booth-b', '123412341234')).not.toBe(a);
    expect(await hashVoucherCodeAsync('booth-a', '123412341234')).toBe(a);
  });
});
