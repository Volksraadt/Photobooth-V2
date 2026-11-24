import { describe, expect, it } from 'vitest';
import { addDays, resolveRange, todayIn } from './range';

describe('recap range', () => {
  it('defaults to the last 7 days ending today', () => {
    expect(resolveRange({}, '2026-11-25', null)).toMatchObject({
      from: '2026-11-19',
      to: '2026-11-25',
      clamped: false,
    });
  });

  it("computes today in the org's zone: 23:30 WIB on 20 Nov is still 20 Nov, not 21 Nov UTC+8", () => {
    const at = new Date('2026-11-20T16:30:00Z'); // 23:30 WIB, 00:30 WITA next day
    expect(todayIn('Asia/Jakarta', at)).toBe('2026-11-20');
    expect(todayIn('Asia/Makassar', at)).toBe('2026-11-21');
    expect(todayIn('UTC', at)).toBe('2026-11-20');
  });

  it('limits Starter to 30 days and flags it', () => {
    const r = resolveRange({ from: '2026-01-01', to: '2026-11-25' }, '2026-11-25', 30);
    expect(r).toMatchObject({ from: '2026-10-27', to: '2026-11-25', clamped: true });
    expect(resolveRange({ from: '2026-01-01', to: '2026-01-31' }, '2026-11-25', 30).to).toBe(
      '2026-10-27',
    );
  });

  it('ignores junk and future dates, keeps order and a one-year cap', () => {
    expect(resolveRange({ from: 'x', to: '2030-01-01' }, '2026-11-25', null).to).toBe('2026-11-25');
    expect(
      resolveRange({ from: '2026-11-25', to: '2026-11-20' }, '2026-11-25', null),
    ).toMatchObject({
      from: '2026-11-20',
      to: '2026-11-20',
    });
    const long = resolveRange({ from: '2020-01-01', to: '2026-11-25' }, '2026-11-25', null);
    expect(long.from).toBe(addDays('2026-11-25', -365));
  });
});
