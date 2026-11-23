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
