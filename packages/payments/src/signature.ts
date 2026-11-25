import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Midtrans notification signature: SHA512(order_id + status_code + gross_amount + key), hex.
 * Since 2026-10-28 the key is the merchant's Signature Secret Key (before: the Server Key).
 */
export function midtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  key: string,
): string {
  return createHash('sha512')
    .update(orderId + statusCode + grossAmount + key, 'utf8')
    .digest('hex');
}

/** True when `signature` was made with any of `keys` (empty keys are ignored). */
export function matchesMidtransSignature(
  fields: { orderId: string; statusCode: string; grossAmount: string; signature: string },
  keys: readonly (string | null | undefined)[],
): boolean {
  let ok = false;
  for (const key of keys) {
    if (!key) continue;
    const expected = midtransSignature(fields.orderId, fields.statusCode, fields.grossAmount, key);
    // No early exit: every candidate is checked so timing does not reveal which key matched.
    if (constantTimeEqualHex(expected, fields.signature)) ok = true;
  }
  return ok;
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
