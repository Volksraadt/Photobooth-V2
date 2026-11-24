/**
 * Kiosk admin PIN hash (`admin.pinHash`). Web Crypto only, so Studio (Node) and Kiosk (browser)
 * share the code. Format: `pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>`.
 * Empty string = PIN not set (admin mode locked).
 */
export const ADMIN_PIN_HASH_RE =
  /^pbkdf2-sha256\$(\d{4,7})\$([A-Za-z0-9_-]{16,})\$([A-Za-z0-9_-]{43})$/;
/** PINs a booth accepts (4-digit PINs set before the audit keep working). */
export const ADMIN_PIN_RE = /^\d{4,8}$/;
/**
 * PINs Studio lets an owner set from now on (audit R2). The hash ships to the booth, so a 4-digit
 * PIN can be brute-forced offline in seconds by whoever holds the config; 6+ digits at 210k
 * PBKDF2 iterations takes far longer, on top of the kiosk/agent lockout.
 */
export const NEW_ADMIN_PIN_RE = /^\d{6,8}$/;
const DEFAULT_ITERATIONS = 210_000;

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const s = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function derive(
  pin: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashAdminPin(
  pin: string,
  opts: { iterations?: number } = {},
): Promise<string> {
  if (!ADMIN_PIN_RE.test(pin)) throw new Error('PIN harus 4–8 digit angka.');
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(hash)}`;
}

/** False for an empty/malformed hash: the kiosk must refuse admin mode then. */
export async function verifyAdminPin(pin: string, pinHash: string): Promise<boolean> {
  const match = ADMIN_PIN_HASH_RE.exec(pinHash);
  if (!match || !ADMIN_PIN_RE.test(pin)) return false;
  const iterations = Number(match[1]);
  const expected = fromB64url(match[3]!);
  const actual = await derive(pin, fromB64url(match[2]!), iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}
