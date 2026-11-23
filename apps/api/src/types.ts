import type { UserClaims, UserTokenVerifier } from '@pb/crypto';
import type { Db } from '@pb/db';

export type AuthedDevice = { id: string; orgId: string; boothId: string | null; name: string };

export type AppDeps = {
  db: Db;
  verifyUserToken: UserTokenVerifier;
};

export type AppEnv = {
  Variables: {
    deps: AppDeps;
    device: AuthedDevice;
    user: UserClaims;
  };
};
