import type { SecretBox } from '@pb/crypto';
import { getActiveCredential, getCredential, type CredentialRow, type Db } from '@pb/db';
import {
  createMidtransProvider,
  createMockProvider,
  decodeQrImage,
  type MockProvider,
  type PaymentProvider,
  type ProviderEnv,
} from '@pb/payments';

export type ResolvedProvider = { provider: PaymentProvider; env: ProviderEnv };

export type PaymentGateway = {
  /** `mock` = PB_PAYMENT_PROVIDER=mock (dev/test): in-memory provider with Midtrans semantics. */
  readonly mode: 'midtrans' | 'mock';
  /** The org's provider: the given env, else the active credential. null = not configured. */
  forOrg(db: Db, orgId: string, env?: ProviderEnv | null): Promise<ResolvedProvider | null>;
  /** Provider for one stored credential (connection test). */
  forCredential(cred: CredentialRow): PaymentProvider;
  /** Mock mode only: the in-memory provider of an org/env (dev "simulate paid"). */
  mockFor(orgId: string, env: ProviderEnv): MockProvider | null;
};

export const credentialAad = (orgId: string, env: ProviderEnv) =>
  `org:${orgId}:payment:midtrans:${env}`;

/**
 * Encrypted JSON in payment_credentials.encrypted_secret. `signatureKey` = Midtrans Signature
 * Secret Key (signs notifications since 2026-10-28); `previousSignatureKey` keeps the replaced one
 * so notifications Midtrans retries with the old signature still verify.
 */
export type StoredSecret = {
  serverKey: string;
  signatureKey?: string;
  previousSignatureKey?: string;
};

export function encryptCredential(
  box: SecretBox,
  orgId: string,
  env: ProviderEnv,
  secret: StoredSecret | string,
): string {
  const value: StoredSecret = typeof secret === 'string' ? { serverKey: secret } : secret;
  return box.encrypt(JSON.stringify(value), credentialAad(orgId, env));
}

export function decryptCredential(box: SecretBox, cred: CredentialRow): StoredSecret {
  return JSON.parse(
    box.decrypt(cred.encryptedSecret, credentialAad(cred.orgId, cred.env)),
  ) as StoredSecret;
}

/**
 * Applies a save to the stored secret. Empty fields keep the stored value. Returns null when
 * nothing secret changed. A new signature key moves the old one to `previousSignatureKey`.
 */
export function mergeStoredSecret(
  stored: StoredSecret | null,
  input: { serverKey?: string; signatureKey?: string },
): StoredSecret | null {
  if (!input.serverKey && !input.signatureKey) return null;
  const serverKey = input.serverKey || stored?.serverKey;
  if (!serverKey) return null;
  const next: StoredSecret = { ...stored, serverKey };
  if (input.signatureKey && input.signatureKey !== stored?.signatureKey) {
    next.signatureKey = input.signatureKey;
    if (stored?.signatureKey) next.previousSignatureKey = stored.signatureKey;
  }
  return next;
}

/**
 * Decrypts owner credentials only inside apps/api, right before a provider call. The server key
 * lives in the provider closure; it is never put in responses, logs or errors.
 */
export function createPaymentGateway(opts: {
  mode: 'midtrans' | 'mock';
  secretBox: SecretBox | null;
  fetch?: typeof fetch;
}): PaymentGateway {
  const mocks = new Map<string, MockProvider>();
  const MOCK_KEY = 'mock-server-key';

  const secretOf = (cred: CredentialRow): StoredSecret => {
    if (!opts.secretBox) throw new Error('SECRET_MASTER_KEY belum diatur di API');
    return decryptCredential(opts.secretBox, cred);
  };

  const mockFor = (orgId: string, env: ProviderEnv, serverKey = MOCK_KEY) => {
    const key = `${orgId}:${env}`;
    let m = mocks.get(key);
    if (!m) mocks.set(key, (m = createMockProvider({ serverKey })));
    return m;
  };

  const forCredential = (cred: CredentialRow): PaymentProvider => {
    const secret = secretOf(cred);
    return opts.mode === 'mock'
      ? mockFor(cred.orgId, cred.env, secret.serverKey)
      : createMidtransProvider({
          serverKey: secret.serverKey,
          signatureKeys: [secret.signatureKey, secret.previousSignatureKey],
          env: cred.env,
          fetch: opts.fetch,
          decodeQrImage,
        });
  };

  return {
    mode: opts.mode,
    async forOrg(db, orgId, env) {
      const cred = env ? await getCredential(db, orgId, env) : await getActiveCredential(db, orgId);
      if (cred) return { provider: forCredential(cred), env: cred.env };
      // Dev without a saved credential: the mock still works end to end.
      if (opts.mode === 'mock') {
        const e = env ?? 'sandbox';
        return { provider: mockFor(orgId, e), env: e };
      }
      return null;
    },
    forCredential,
    mockFor: (orgId, env) =>
      opts.mode === 'mock' ? (mocks.get(`${orgId}:${env}`) ?? mockFor(orgId, env)) : null,
  };
}
