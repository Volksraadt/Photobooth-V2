import { index, integer, numeric, pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { id, timestamps, tz } from './_common';
import { orgs } from './orgs';
import { paymentMethod, paymentProvider } from './sessions';

export const providerEnv = pgEnum('provider_env', ['sandbox', 'production']);
export const connectionStatus = pgEnum('connection_status', [
  'untested',
  'ok',
  'failed',
  'revoked',
]);

/** API/worker only (no RLS policy for Studio users). */
export const paymentCredentials = pgTable(
  'payment_credentials',
  {
    id: id(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    provider: paymentProvider('provider').notNull(),
    env: providerEnv('env').notNull(),
    /** @pb/crypto SecretBox payload, AAD = `org:<orgId>:payment:<provider>:<env>`. */
    encryptedSecret: text('encrypted_secret').notNull(),
    merchantId: text('merchant_id'),
    status: connectionStatus('status').notNull().default('untested'),
    lastTestedAt: tz('last_tested_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('payment_credentials_org_provider_env_uq').on(t.orgId, t.provider, t.env)],
);

/** API/worker only (no RLS policy for Studio users). */
export const driveConnections = pgTable('drive_connections', {
  id: id(),
  orgId: text('org_id')
    .notNull()
    .unique()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  googleEmail: text('google_email').notNull(),
  /** @pb/crypto SecretBox payload, AAD = `org:<orgId>:drive`. */
  encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
  rootFolderId: text('root_folder_id'),
  status: connectionStatus('status').notNull().default('untested'),
  ...timestamps,
});

/** Global fee table used to compute sessions.net_amount. Not hardcoded: MDR can change. */
export const feeSettings = pgTable(
  'fee_settings',
  {
    id: id(),
    provider: paymentProvider('provider').notNull(),
    method: paymentMethod('method').notNull(),
    /** e.g. "0.7000" = 0.7% */
    percent: numeric('percent', { precision: 7, scale: 4 }).notNull().default('0'),
    /** IDR per transaction */
    fixed: integer('fixed').notNull().default(0),
    effectiveFrom: tz('effective_from').notNull(),
    ...timestamps,
  },
  (t) => [index('fee_settings_lookup_idx').on(t.provider, t.method, t.effectiveFrom)],
);
