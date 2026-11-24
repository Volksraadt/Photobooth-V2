import {
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
import { devices } from './booths';
import { orgs } from './orgs';
import { sessions } from './sessions';

export const eventLevel = pgEnum('event_level', ['info', 'warn', 'error']);
export const printJobStatus = pgEnum('print_job_status', ['queued', 'printing', 'done', 'failed']);
export const uploadTarget = pgEnum('upload_target', ['storage', 'drive']);
export const uploadStatus = pgEnum('upload_status', ['pending', 'running', 'done', 'failed']);

const orgId = () =>
  text('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' });

export const deviceEvents = pgTable(
  'device_events',
  {
    id: id(),
    orgId: orgId(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    level: eventLevel('level').notNull(),
    /** camera_disconnected, printer_error, payment_timeout, sync_failed, crash, … */
    kind: text('kind').notNull(),
    message: text('message'),
    data: jsonb('data'),
    occurredAt: tz('occurred_at').notNull(),
    ...timestamps,
  },
  (t) => [
    index('device_events_org_idx').on(t.orgId),
    index('device_events_device_idx').on(t.deviceId, t.occurredAt),
  ],
);

export const printJobs = pgTable(
  'print_jobs',
  {
    id: id(),
    orgId: orgId(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    sheets: integer('sheets').notNull(),
    status: printJobStatus('status').notNull(),
    occurredAt: tz('occurred_at').notNull(),
    ...timestamps,
  },
  (t) => [index('print_jobs_org_idx').on(t.orgId)],
);

export const uploadJobs = pgTable(
  'upload_jobs',
  {
    id: id(),
    orgId: orgId(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    target: uploadTarget('target').notNull(),
    status: uploadStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    /** Machine-readable failure (drive_revoked, drive_quota, …) so Studio can explain it. */
    errorCode: text('error_code'),
    /** Backoff: the runner picks the job when this has passed (null = now). */
    nextAttemptAt: tz('next_attempt_at'),
    finishedAt: tz('finished_at'),
    ...timestamps,
  },
  (t) => [
    index('upload_jobs_org_idx').on(t.orgId),
    uniqueIndex('upload_jobs_session_target_uq').on(t.sessionId, t.target),
    index('upload_jobs_status_idx').on(t.status, t.nextAttemptAt),
  ],
);

/** Append-only: UPDATE/DELETE/TRUNCATE blocked by trigger (see RLS migration). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    orgId: orgId(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    at: tz('at').notNull().defaultNow(),
  },
  (t) => [index('audit_logs_org_at_idx').on(t.orgId, t.at)],
);
