import {
  createMidtransProvider,
  createMockProvider,
  decodeQrImage,
  type MockProvider,
  type PaymentProvider,
  type ProviderEnv,
} from '@pb/payments';

/**
 * The PLATFORM's own Midtrans account, used only for subscription invoices. It is configured by
 * environment variables of apps/api (PB_BILLING_MIDTRANS_*), never by an owner, and it never
 * reads `payment_credentials` (those are the owners' accounts for their buyers' money).
 * Buyer money → owner's gateway; subscription money → platform's gateway: not mixed.
 */
export type BillingGateway = {
  /** `disabled` = no platform server key configured: invoices exist but cannot be paid online. */
  readonly mode: 'midtrans' | 'mock' | 'disabled';
  readonly env: ProviderEnv;
  readonly provider: PaymentProvider | null;
  /** Mock mode only: simulate the owner scanning the QR. */
  readonly mock: MockProvider | null;
};

export const DISABLED_BILLING: BillingGateway = {
  mode: 'disabled',
  env: 'sandbox',
  provider: null,
  mock: null,
};

export function createBillingGateway(opts: {
  mode: 'midtrans' | 'mock';
  serverKey?: string;
  env?: ProviderEnv;
  fetch?: typeof fetch;
}): BillingGateway {
  const env = opts.env ?? 'sandbox';
  if (opts.mode === 'mock') {
    const mock = createMockProvider({ serverKey: opts.serverKey ?? 'mock-platform-billing-key' });
    return { mode: 'mock', env, provider: mock, mock };
  }
  if (!opts.serverKey) return DISABLED_BILLING;
  return {
    mode: 'midtrans',
    env,
    provider: createMidtransProvider({
      serverKey: opts.serverKey,
      env,
      fetch: opts.fetch,
      decodeQrImage,
    }),
    mock: null,
  };
}

export function billingGatewayFromEnv(
  env: Record<string, string | undefined> = process.env,
): BillingGateway {
  if (env.PB_BILLING_PROVIDER === 'mock') {
    if (env.NODE_ENV === 'production')
      throw new Error('PB_BILLING_PROVIDER=mock is not allowed in production');
    return createBillingGateway({ mode: 'mock' });
  }
  const serverKey = env.PB_BILLING_MIDTRANS_SERVER_KEY;
  if (!serverKey) return DISABLED_BILLING;
  return createBillingGateway({
    mode: 'midtrans',
    serverKey,
    env: env.PB_BILLING_MIDTRANS_ENV === 'production' ? 'production' : 'sandbox',
  });
}
