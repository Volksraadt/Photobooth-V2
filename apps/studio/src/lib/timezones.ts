export const BOOTH_TIMEZONES = [
  { value: 'Asia/Jakarta', label: 'WIB (Asia/Jakarta)' },
  { value: 'Asia/Makassar', label: 'WITA (Asia/Makassar)' },
  { value: 'Asia/Jayapura', label: 'WIT (Asia/Jayapura)' },
] as const;

export function isBoothTimezone(
  value: unknown,
): value is (typeof BOOTH_TIMEZONES)[number]['value'] {
  return BOOTH_TIMEZONES.some((tz) => tz.value === value);
}

/** Offset (ms) of `timeZone` from UTC at instant `at`. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** 23:59:59 of `yyyyMmDd` in the booth time zone, as a UTC instant (stored in UTC). */
export function endOfDayInZone(yyyyMmDd: string, timeZone: string): Date {
  const [y, m, d] = yyyyMmDd.split('-').map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
  return new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
}

/** Short date-time in the booth time zone (UI). */
export function formatInZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(d);
}

/** "WIB" for a booth zone; other zones are shown as-is. */
export function timezoneLabel(value: string): string {
  return BOOTH_TIMEZONES.find((tz) => tz.value === value)?.label.split(' ')[0] ?? value;
}
