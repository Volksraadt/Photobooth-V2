import { pbkdf2, pbkdf2Sync, randomInt } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Voucher codes: 12 digits (entered on the kiosk keypad, printed as 1234-5678-9012).
 *
 * The device validates vouchers offline from a synced list of hashes, so the hash must be slow:
 * PBKDF2-SHA256 with a per-booth salt. One hash per redeem attempt on the device; the list itself
 * cannot be reversed cheaply (10^12 codes × PBKDF2). See docs/decisions.md (F4).
 */
export const VOUCHER_CODE_DIGITS = 12;
export const VOUCHER_HASH_ITERATIONS = 20_000;

const pbkdf2Async = promisify(pbkdf2);

/** Strips spaces/dashes; null when not a 12-digit code. */
export function normalizeVoucherCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return new RegExp(`^\\d{${VOUCHER_CODE_DIGITS}}$`).test(digits) ? digits : null;
}

export function formatVoucherCode(code: string): string {
  return code.replace(/(\d{4})(?=\d)/g, '$1-');
}

export function generateVoucherCode(): string {
  let out = '';
  for (let i = 0; i < VOUCHER_CODE_DIGITS; i++) out += String(randomInt(10));
  return out;
}

const salt = (boothId: string) => `pb-voucher:v1:${boothId}`;

export function hashVoucherCode(boothId: string, code: string): string {
  return pbkdf2Sync(code, salt(boothId), VOUCHER_HASH_ITERATIONS, 32, 'sha256').toString('hex');
}

export async function hashVoucherCodeAsync(boothId: string, code: string): Promise<string> {
  return (await pbkdf2Async(code, salt(boothId), VOUCHER_HASH_ITERATIONS, 32, 'sha256')).toString(
    'hex',
  );
}
