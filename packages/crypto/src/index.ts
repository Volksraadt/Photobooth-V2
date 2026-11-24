import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

export * from './user-token';
export * from './voucher';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';

export class SecretBoxError extends Error {
  override name = 'SecretBoxError';
}

export type SecretBox = {
  /**
   * Encrypt a UTF-8 secret. `aad` binds the ciphertext to a context (e.g. `org:<id>:midtrans`)
   * so a value copied to another row/org fails to decrypt.
   */
  encrypt(plaintext: string, aad: string): string;
  decrypt(payload: string, aad: string): string;
};

/** Parse a base64 32-byte master key. */
export function parseMasterKey(base64: string | undefined): Buffer {
  if (!base64) throw new SecretBoxError('SECRET_MASTER_KEY is not set');
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) {
    throw new SecretBoxError(`SECRET_MASTER_KEY must decode to 32 bytes (got ${key.length})`);
  }
  return key;
}

/**
 * Payload format: `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url parts).
 * keyId = first 8 hex chars of sha256(key), for detecting key mismatch and future rotation.
 */
export function createSecretBox(masterKey: Buffer): SecretBox {
  if (masterKey.length !== 32) throw new SecretBoxError('master key must be 32 bytes');
  const keyId = createHash('sha256').update(masterKey).digest('hex').slice(0, 8);

  return {
    encrypt(plaintext, aad) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGO, masterKey, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [VERSION, keyId, b64(iv), b64(tag), b64(ct)].join('.');
    },
    decrypt(payload, aad) {
      const parts = payload.split('.');
      if (parts.length !== 5 || parts[0] !== VERSION) {
        throw new SecretBoxError('unsupported secret payload format');
      }
      const [, kid, ivPart, tagPart, ctPart] = parts as [string, string, string, string, string];
      if (!safeEqual(kid, keyId))
        throw new SecretBoxError('secret was encrypted with a different key');
      const iv = Buffer.from(ivPart, 'base64url');
      const tag = Buffer.from(tagPart, 'base64url');
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
        throw new SecretBoxError('malformed secret payload');
      }
      const decipher = createDecipheriv(ALGO, masterKey, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(tag);
      try {
        return Buffer.concat([
          decipher.update(Buffer.from(ctPart, 'base64url')),
          decipher.final(),
        ]).toString('utf8');
      } catch {
        throw new SecretBoxError('secret authentication failed');
      }
    },
  };
}

export function secretBoxFromEnv(env: Record<string, string | undefined> = process.env): SecretBox {
  return createSecretBox(parseMasterKey(env.SECRET_MASTER_KEY));
}

/** sha256 hex, for storing lookup hashes of high-entropy tokens (device tokens, voucher codes). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** URL-safe random token with `bytes` of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 32 } as const;

/** scrypt password hash: `scrypt$N$r$p$<salt>$<hash>` (base64url). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, b64(salt), b64(hash)].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  const salt = Buffer.from(parts[4]!, 'base64url');
  const expected = Buffer.from(parts[5]!, 'base64url');
  const actual = scryptSync(password, salt, expected.length, { N, r, p });
  return timingSafeEqual(actual, expected);
}

function b64(buf: Buffer): string {
  return buf.toString('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
