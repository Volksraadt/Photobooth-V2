import type { UserClaims, UserTokenVerifier } from '@pb/crypto';
import type { BoothConfigEvents, Db } from '@pb/db';

export type AuthedDevice = { id: string; orgId: string; boothId: string | null; name: string };

export type AppDeps = {
  db: Db;
  verifyUserToken: UserTokenVerifier;
  /** "Booth config published" signals (LISTEN pb_booth_config in production). */
  configEvents: BoothConfigEvents;
};

export type AppEnv = {
  Variables: {
    deps: AppDeps;
    device: AuthedDevice;
    user: UserClaims;
  };
};
