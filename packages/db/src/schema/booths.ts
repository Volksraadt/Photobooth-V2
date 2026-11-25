import type { BoothConfig } from '@pb/schema';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps, tz } from './_common';
import { orgs } from './orgs';

export const boothStatus = pgEnum('booth_status', ['active', 'inactive']);
export const assetKind = pgEnum('asset_kind', ['image', 'video', 'font', 'audio']);
export const deviceComponentStatus = pgEnum('device_component_status', [
  'unknown',
  'ok',
  'warning',
  'error',
  'disconnected',
]);

const orgId = () =>
  text('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' });

export const booths = pgTable(
  'booths',
  {
    id: id(),
    orgId: orgId(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('Asia/Jakarta'),
    activeConfigId: text('active_config_id').references((): AnyPgColumn => boothConfigs.id, {
      onDelete: 'set null',
    }),
    status: boothStatus('status').notNull().default('active'),
    /**
     * Owner allows vouchers while the booth is offline. Only then does the device receive the
     * voucher hash list (8-digit codes; a copied list can be guessed). Off = vouchers need internet.
     */
    voucherOffline: boolean('voucher_offline').notNull().default(false),
    ...timestamps,
  },
  (t) => [index('booths_org_idx').on(t.orgId)],
);

/** Immutable published versions. */
export const boothConfigs = pgTable(
  'booth_configs',
  {
    id: id(),
    orgId: orgId(),
    boothId: text('booth_id')
      .notNull()
      .references(() => booths.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    config: jsonb('config').$type<BoothConfig>().notNull(),
    publishedBy: uuid('published_by'),
    publishedAt: tz('published_at').notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('booth_configs_booth_version_uq').on(t.boothId, t.version),
    index('booth_configs_org_idx').on(t.orgId),
  ],
);

/** Editor draft, one per booth. Config may be invalid while editing. */
export const boothDrafts = pgTable(
  'booth_drafts',
  {
    id: id(),
    orgId: orgId(),
    boothId: text('booth_id')
      .notNull()
      .unique()
      .references(() => booths.id, { onDelete: 'cascade' }),
    config: jsonb('config').$type<BoothConfig>().notNull(),
    updatedBy: uuid('updated_by'),
    ...timestamps,
  },
  (t) => [index('booth_drafts_org_idx').on(t.orgId)],
);

export const devices = pgTable(
  'devices',
  {
    id: id(),
    orgId: orgId(),
    boothId: text('booth_id').references(() => booths.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    /** sha256 of the device token; the token itself is shown once at pairing. */
    tokenHash: text('token_hash').notNull().unique(),
    platform: text('platform'),
    appVersion: text('app_version'),
    lastHeartbeatAt: tz('last_heartbeat_at'),
    lastConfigVersion: integer('last_config_version'),
    cameraStatus: deviceComponentStatus('camera_status').notNull().default('unknown'),
    printerStatus: deviceComponentStatus('printer_status').notNull().default('unknown'),
    revokedAt: tz('revoked_at'),
    /** Reported by the agent heartbeat: items still waiting to reach the API (unsynced data). */
    outboxPending: integer('outbox_pending'),
    uploadsPending: integer('uploads_pending'),
    /** Owner-entered: sheets per paper/ribbon roll; the counter restarts at paper_loaded_at. */
    paperCapacity: integer('paper_capacity'),
    paperLoadedAt: tz('paper_loaded_at'),
    ...timestamps,
  },
  (t) => [index('devices_org_idx').on(t.orgId), index('devices_booth_idx').on(t.boothId)],
);

/** Global (pre-org): a kiosk shows the code before it belongs to any org. API-only. */
export const pairingCodes = pgTable('pairing_codes', {
  id: id(),
  code: text('code').notNull().unique(),
  deviceFingerprint: text('device_fingerprint').notNull(),
  /** sha256 of the device token the kiosk generated; becomes devices.token_hash on claim. */
  tokenHash: text('token_hash'),
  expiresAt: tz('expires_at').notNull(),
  claimedBoothId: text('claimed_booth_id').references(() => booths.id, { onDelete: 'cascade' }),
  ...timestamps,
});

export const assets = pgTable(
  'assets',
  {
    id: id(),
    orgId: orgId(),
    kind: assetKind('kind').notNull(),
    /** Original file name (shown in the library). */
    name: text('name').notNull().default(''),
    mimeType: text('mime_type'),
    storagePath: text('storage_path').notNull(),
    sha256: text('sha256').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    ...timestamps,
  },
  (t) => [index('assets_org_idx').on(t.orgId)],
);

/** Global starter templates. */
export const templates = pgTable('templates', {
  id: id(),
  /** Stable key of built-in templates (seed upserts by key). */
  key: text('key').unique(),
  name: text('name').notNull(),
  description: text('description'),
  preview: text('preview'),
  config: jsonb('config').$type<Partial<BoothConfig>>().notNull(),
  isPublic: boolean('is_public').notNull().default(false),
  ...timestamps,
});
