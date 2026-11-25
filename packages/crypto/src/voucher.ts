import { randomInt, scrypt, scryptSync, type ScryptOptions } from 'node:crypto';

/**
 * Voucher codes: 8 digits (entered on the kiosk keypad, printed as 1234-5678).
 *
 * Lookup is by hash with a per-booth salt, so one guess tests every voucher of the booth. 8 digits
 * alone do not protect a hash list, which is why (decisions 2026-11-25, "Voucher 8 digit"):
 * - the device only receives the hash list when the owner allows offline vouchers for the booth;
 * - the API limits wrong attempts per device (online guessing);
 * - the hash is scrypt (memory-hard, ~16 MiB per attempt), so a copied list costs a GPU far more
 *   than PBKDF2 did. One hash per redeem attempt on the device (~50 ms).
 */
export const VOUCHER_CODE_DIGITS = 8;
export const VOUCHER_SCRYPT: ScryptOptions = { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Strips spaces/dashes; null when not an 8-digit code. */
export function normalizeVoucherCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return new RegExp(`^\\d{${VOUCHER_CODE_DIGITS}}$`).test(digits) ? digits : null;
}

/** 12345678 → 1234-5678 (as printed). */
export function formatVoucherCode(code: string): string {
  return code.replace(/(\d{4})(?=\d)/g, '$1-');
}

export function generateVoucherCode(): string {
  let out = '';
  for (let i = 0; i < VOUCHER_CODE_DIGITS; i++) out += String(randomInt(10));
  return out;
}

/** v2 = scrypt (v1 was PBKDF2 for 16-digit codes; those are no longer accepted). */
const salt = (boothId: string) => `pb-voucher:v2:${boothId}`;

export function hashVoucherCode(boothId: string, code: string): string {
  return scryptSync(code, salt(boothId), 32, VOUCHER_SCRYPT).toString('hex');
}

export function hashVoucherCodeAsync(boothId: string, code: string): Promise<string> {
  return new Promise((resolve, reject) =>
    scrypt(code, salt(boothId), 32, VOUCHER_SCRYPT, (err, key) =>
      err ? reject(err) : resolve(key.toString('hex')),
    ),
  );
}

/** AAD binding an encrypted voucher code to its booth (a ciphertext copied elsewhere fails). */
export const voucherCodeAad = (boothId: string) => `voucher:${boothId}`;
