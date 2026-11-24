import type { SecretBox, UserClaims, UserTokenVerifier } from '@pb/crypto';
import type { BoothConfigEvents, Db } from '@pb/db';
import type { PaymentGateway } from './payments/gateway';
import type { DeviceSignals } from './payments/device-signals';

export type AuthedDevice = { id: string; orgId: string; boothId: string | null; name: string };

export type AppDeps = {
  db: Db;
  verifyUserToken: UserTokenVerifier;
  /** "Booth config published" signals (LISTEN pb_booth_config in production). */
  configEvents: BoothConfigEvents;
  /** Encrypts owner credentials. null = SECRET_MASTER_KEY missing (integrations disabled). */
  secretBox?: SecretBox | null;
  payments?: PaymentGateway;
  deviceSignals?: DeviceSignals;
  /** Public base URL of this API (webhook URL sent to Midtrans). null = dashboard URL is used. */
  publicApiUrl?: string | null;
};

export type ResolvedDeps = Required<AppDeps>;

export type AppEnv = {
  Variables: {
    deps: ResolvedDeps;
    device: AuthedDevice;
    user: UserClaims;
  };
};
