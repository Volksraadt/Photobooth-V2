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
  /** Payment page instruction that matches the methods the buyer can use right now. */
  paymentHint?: string;
};

type PaymentMethod = 'qris' | 'voucher' | 'cash';

/**
 * Instruction for the Payment page. `qrisShown` is false when QRIS is enabled but cannot be used
 * now (booth offline, Midtrans not set up), so the buyer is not told to scan a QR that is not there.
 */
export function paymentHint(
  methods: readonly PaymentMethod[],
  qrisShown: boolean,
  locale: 'id' | 'en' = 'id',
): string {
  const qris = qrisShown && methods.includes('qris');
  const voucher = methods.includes('voucher');
  const cash = methods.includes('cash');
  const id = locale === 'id';
  const parts: string[] = [];
  if (qris)
    parts.push(
      id
        ? 'scan QRIS dengan e-wallet atau m-banking'
        : 'scan the QRIS with an e-wallet or banking app',
    );
  if (voucher) parts.push(id ? 'masukkan kode voucher' : 'enter a voucher code');
  if (cash) parts.push(id ? 'bayar tunai ke petugas' : 'pay cash to the staff');
  if (parts.length === 0)
    return id
      ? 'Pembayaran belum tersedia. Hubungi petugas.'
      : 'Payment is not available. Please ask the staff.';
  const or = id ? 'atau' : 'or';
  const joined =
    parts.length === 1
      ? parts[0]!
      : parts.length === 2
        ? `${parts[0]} ${or} ${parts[1]}`
        : `${parts.slice(0, -1).join(', ')}, ${or} ${parts[parts.length - 1]}`;
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

/** Replaces {{price}}, {{boothName}}, {{date}}, {{paymentHint}}. Unknown tokens stay as written. */
export function resolveTextTokens(content: string, values: TokenValues): string {
  return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    switch (name) {
      case 'paymentHint':
        return values.paymentHint ?? match;
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
