import { NEUTRAL_FILTER_PARAMS } from '@pb/schema';
import { describe, expect, it } from 'vitest';
import { filterMatrixValues } from './filter-view';
import { computeFit, cropGuideRect } from './fit';
import { qrPath } from './qr-code';
import { formatIdr, formatMmSs, paymentHint, resolveTextTokens } from './tokens';

describe('computeFit', () => {
  it('scales the artboard identically at 1920×1080 and 1366×768 (letterbox)', () => {
    const artboard = { width: 1920, height: 1080 };
    expect(computeFit({ width: 1920, height: 1080 }, artboard)).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    const small = computeFit({ width: 1366, height: 768 }, artboard);
    expect(small.scale).toBeCloseTo(768 / 1080, 10);
    expect(small.offsetY).toBe(0);
    expect(small.offsetX).toBeCloseTo((1366 - 1920 * (768 / 1080)) / 2, 10);
  });

  it('letterboxes a portrait artboard on a landscape screen', () => {
    const fit = computeFit({ width: 1920, height: 1080 }, { width: 1080, height: 1920 });
    expect(fit.scale).toBeCloseTo(1080 / 1920);
    expect(fit.offsetX).toBeCloseTo((1920 - 1080 * (1080 / 1920)) / 2);
    expect(fit.offsetY).toBe(0);
  });
});

describe('cropGuideRect', () => {
  it('shows the center crop of a 3:2 slot on a 16:9 camera image', () => {
    const box = { width: 1280, height: 720 };
    const guide = cropGuideRect(box, { width: 1920, height: 1080 }, 540 / 360, 'cover');
    expect(guide.height).toBeCloseTo(720);
    expect(guide.width).toBeCloseTo(1080);
    expect(guide.x).toBeCloseTo(100);
    expect(guide.y).toBeCloseTo(0);
  });
});

describe('tokens', () => {
  it('formats IDR without locale dependencies', () => {
    expect(formatIdr(35000)).toBe('Rp 35.000');
    expect(formatIdr(1250000)).toBe('Rp 1.250.000');
    expect(formatIdr(0)).toBe('Rp 0');
  });

  it('resolves {{price}}, {{boothName}} and {{date}} in the booth timezone', () => {
    // 2026-11-24 18:30 UTC = 2026-11-25 01:30 WIB
    const date = new Date('2026-11-24T18:30:00Z');
    const out = resolveTextTokens('{{boothName}} · {{ date }} · {{price}} · {{unknown}}', {
      boothName: 'Booth A',
      price: 35000,
      date,
      timezone: 'Asia/Jakarta',
      locale: 'id',
    });
    expect(out).toBe('Booth A · 25 November 2026 · Rp 35.000 · {{unknown}}');
  });

  it('{{paymentHint}} only mentions QRIS while it can be used', () => {
    const all = ['qris', 'voucher', 'cash'] as const;
    expect(paymentHint(all, true)).toBe(
      'Scan QRIS dengan e-wallet atau m-banking, masukkan kode voucher, atau bayar tunai ke petugas.',
    );
    expect(paymentHint(all, false)).toBe('Masukkan kode voucher atau bayar tunai ke petugas.');
    expect(paymentHint(['qris', 'voucher'], false)).toBe('Masukkan kode voucher.');
    expect(paymentHint(['qris'], false)).toBe('Pembayaran belum tersedia. Hubungi petugas.');
    expect(paymentHint(['cash'], true, 'en')).toBe('Pay cash to the staff.');
    expect(
      resolveTextTokens('{{paymentHint}}', {
        date: new Date(),
        timezone: 'Asia/Jakarta',
        locale: 'id',
        paymentHint: 'X',
      }),
    ).toBe('X');
  });

  it('formats the payment timer', () => {
    expect(formatMmSs(300)).toBe('05:00');
    expect(formatMmSs(59.2)).toBe('01:00');
    expect(formatMmSs(-3)).toBe('00:00');
  });
});

describe('filterMatrixValues', () => {
  it('is the identity matrix for neutral params', () => {
    expect(filterMatrixValues(NEUTRAL_FILTER_PARAMS)).toBe(
      '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0',
    );
  });
});

describe('qrPath', () => {
  it('encodes a short link', () => {
    const { size, d } = qrPath('https://pb.example/s/ABCD2345');
    expect(size).toBeGreaterThanOrEqual(21);
    expect(d.length).toBeGreaterThan(100);
  });
});
