import { describe, expect, it } from 'vitest';
import {
  formatVoucherCode,
  generateVoucherCode,
  hashVoucherCode,
  hashVoucherCodeAsync,
  normalizeVoucherCode,
} from './voucher';

describe('voucher codes', () => {
  it('generates 8 digits and formats them like the print', () => {
    const code = generateVoucherCode();
    expect(code).toMatch(/^\d{8}$/);
    expect(formatVoucherCode('12345678')).toBe('1234-5678');
    expect(normalizeVoucherCode(' 1234-5678 ')).toBe('12345678');
    expect(normalizeVoucherCode('1234123412341234')).toBeNull(); // old 16-digit length
    expect(normalizeVoucherCode('ABCD5678')).toBeNull();
  });

  it('hash is per booth, stable, and the same sync/async', async () => {
    const a = hashVoucherCode('booth-a', '12345678');
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(hashVoucherCode('booth-a', '12345678')).toBe(a);
    expect(hashVoucherCode('booth-b', '12345678')).not.toBe(a);
    expect(await hashVoucherCodeAsync('booth-a', '12345678')).toBe(a);
  });
});
