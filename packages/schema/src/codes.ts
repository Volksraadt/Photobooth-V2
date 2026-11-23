/** Uppercase letters + digits without ambiguous 0/O, 1/I. */
export const SESSION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const SESSION_CODE_LENGTH = 8;

const SESSION_CODE_RE = new RegExp(`^[${SESSION_CODE_ALPHABET}]{${SESSION_CODE_LENGTH}}$`);

export function isSessionCode(value: string): boolean {
  return SESSION_CODE_RE.test(value);
}

/** Uses Web Crypto (available in browsers and Node ≥ 19). */
export function generateSessionCode(): string {
  const n = SESSION_CODE_ALPHABET.length;
  // Rejection sampling avoids modulo bias.
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < SESSION_CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    for (const b of bytes) {
      if (b < limit && out.length < SESSION_CODE_LENGTH) out += SESSION_CODE_ALPHABET[b % n];
    }
  }
  return out;
}
