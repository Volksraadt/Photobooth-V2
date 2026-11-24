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

export type StoredSecret = { serverKey: string };

export function encryptCredential(
  box: SecretBox,
  orgId: string,
  env: ProviderEnv,
  serverKey: string,
): string {
  return box.encrypt(
    JSON.stringify({ serverKey } satisfies StoredSecret),
    credentialAad(orgId, env),
  );
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

  const serverKeyOf = (cred: CredentialRow): string => {
    if (!opts.secretBox) throw new Error('SECRET_MASTER_KEY belum diatur di API');
    const secret = JSON.parse(
      opts.secretBox.decrypt(cred.encryptedSecret, credentialAad(cred.orgId, cred.env)),
    ) as StoredSecret;
    return secret.serverKey;
  };

  const mockFor = (orgId: string, env: ProviderEnv, serverKey = MOCK_KEY) => {
    const key = `${orgId}:${env}`;
    let m = mocks.get(key);
    if (!m) mocks.set(key, (m = createMockProvider({ serverKey })));
    return m;
  };

  const forCredential = (cred: CredentialRow): PaymentProvider =>
    opts.mode === 'mock'
      ? mockFor(cred.orgId, cred.env, serverKeyOf(cred))
      : createMidtransProvider({
          serverKey: serverKeyOf(cred),
          env: cred.env,
          fetch: opts.fetch,
          decodeQrImage,
        });

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
