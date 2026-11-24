/** "35.000" — Indonesian thousands separator, deterministic (no ICU dependency). */
export function formatNumberId(value: number): string {
  const sign = value < 0 ? '-' : '';
  const digits = Math.round(Math.abs(value)).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** "Rp 35.000" */
export function formatIdr(value: number): string {
  return `Rp ${formatNumberId(value)}`;
}

export function formatPrice(value: number, format: 'idr' | 'number'): string {
  return format === 'idr' ? formatIdr(value) : formatNumberId(value);
}

/** Booth-local date, e.g. "24 November 2026". Times are stored UTC; shown in the booth zone. */
export function formatBoothDate(date: Date, timezone: string, locale: 'id' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'id' ? 'id-ID' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  }).format(date);
}

export type TokenValues = {
  price?: number;
  boothName?: string;
  date: Date;
  timezone: string;
  locale: 'id' | 'en';
};

/** Replaces {{price}}, {{boothName}}, {{date}}. Unknown tokens stay as written. */
export function resolveTextTokens(content: string, values: TokenValues): string {
  return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    switch (name) {
      case 'price':
        return values.price === undefined ? match : formatIdr(values.price);
      case 'boothName':
        return values.boothName ?? match;
      case 'date':
        return formatBoothDate(values.date, values.timezone, values.locale);
      default:
        return match;
    }
  });
}

export function formatMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
