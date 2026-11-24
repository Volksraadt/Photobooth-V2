import type { SecretBox, UserClaims, UserTokenVerifier } from '@pb/crypto';
import type { BoothConfigEvents, Db } from '@pb/db';
import type { AccessTokenCache, GoogleOAuth } from '@pb/drive';
import type { ObjectStorage } from '@pb/storage';
import type { PaymentGateway } from './payments/gateway';
import type { DeviceSignals } from './payments/device-signals';

export type AuthedDevice = { id: string; orgId: string; boothId: string | null; name: string };

/** Wakes the worker (BullMQ when Redis is configured). The database stays the source of truth. */
export interface JobWaker {
  wake(sessionId: string): Promise<void>;
}

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
  /** F5: object storage for session files (default: in memory, tests only). */
  storage?: ObjectStorage;
  /** F5: Google OAuth client. null = GOOGLE_CLIENT_ID/SECRET missing (Drive cannot be connected). */
  google?: GoogleOAuth | null;
  driveTokens?: AccessTokenCache;
  jobs?: JobWaker;
  /** Where the OAuth callback sends the browser back to (Studio). */
  studioUrl?: string;
};

export type ResolvedDeps = Required<AppDeps>;

export type AppEnv = {
  Variables: {
    deps: ResolvedDeps;
    device: AuthedDevice;
    user: UserClaims;
  };
};
