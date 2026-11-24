import { createHash, timingSafeEqual } from 'node:crypto';

/** Midtrans notification signature: SHA512(order_id + status_code + gross_amount + serverKey), hex. */
export function midtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
): string {
  return createHash('sha512')
    .update(orderId + statusCode + grossAmount + serverKey, 'utf8')
    .digest('hex');
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a.toLowerCase(), 'utf8');
  const bb = Buffer.from(b.toLowerCase(), 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** "35000.00" → 35000; null when not a whole IDR amount. */
export function parseIdr(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}
