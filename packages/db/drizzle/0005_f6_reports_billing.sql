ALTER TABLE "billing_invoices" ADD COLUMN "plan_id" text;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "kind" text DEFAULT 'renewal' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "qr_string" text;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "qr_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "env" text;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "outbox_pending" integer;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "uploads_pending" integer;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "paper_capacity" integer;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "paper_loaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_invoices_status_idx" ON "billing_invoices" USING btree ("status");--> statement-breakpoint
-- Daily sales per booth. The day is the calendar date in the BOOTH's timezone
-- (sessions.started_at is stored in UTC), so a 23:30 WIB session belongs to that WIB day.
-- Only sessions that were paid for (any method, including free event sessions) are counted.
-- Materialized views have no RLS: Studio reads the filtered view `daily_booth_stats_v` only;
-- apps/worker refreshes the view (REFRESH ... CONCURRENTLY needs the unique index below).
CREATE MATERIALIZED VIEW "daily_booth_stats" AS
SELECT
  s.org_id,
  s.booth_id,
  (s.started_at AT TIME ZONE b.timezone)::date AS day,
  count(*)::int AS sessions,
  coalesce(sum(s.gross_amount), 0)::bigint AS gross,
  coalesce(sum(s.fee_amount), 0)::bigint AS fee,
  coalesce(sum(s.net_amount), 0)::bigint AS net,
  coalesce(sum(s.extra_prints), 0)::int AS extra_prints,
  count(*) FILTER (WHERE s.offline)::int AS offline_sessions,
  count(*) FILTER (WHERE s.payment_method = 'qris')::int AS qris_sessions,
  coalesce(sum(s.gross_amount) FILTER (WHERE s.payment_method = 'qris'), 0)::bigint AS qris_gross,
  count(*) FILTER (WHERE s.payment_method = 'voucher')::int AS voucher_sessions,
  coalesce(sum(s.gross_amount) FILTER (WHERE s.payment_method = 'voucher'), 0)::bigint AS voucher_gross,
  count(*) FILTER (WHERE s.payment_method = 'cash')::int AS cash_sessions,
  coalesce(sum(s.gross_amount) FILTER (WHERE s.payment_method = 'cash'), 0)::bigint AS cash_gross,
  count(*) FILTER (WHERE s.payment_method = 'free')::int AS free_sessions
FROM "sessions" s
JOIN "booths" b ON b.id = s.booth_id
WHERE s.payment_method IS NOT NULL
GROUP BY s.org_id, s.booth_id, (s.started_at AT TIME ZONE b.timezone)::date;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_booth_stats_pk" ON "daily_booth_stats" ("booth_id", "day");--> statement-breakpoint
CREATE INDEX "daily_booth_stats_org_day" ON "daily_booth_stats" ("org_id", "day");--> statement-breakpoint
REVOKE ALL ON "daily_booth_stats" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE VIEW "daily_booth_stats_v" AS
  -- Studio users (JWT present) only see their orgs. Service connections (api/worker, no JWT) see
  -- everything and always filter by org_id themselves.
  SELECT * FROM "daily_booth_stats" WHERE app.is_org_member(org_id) OR auth.uid() IS NULL;--> statement-breakpoint
REVOKE ALL ON "daily_booth_stats_v" FROM PUBLIC, anon;--> statement-breakpoint
GRANT SELECT ON "daily_booth_stats_v" TO authenticated;

--> statement-breakpoint
-- PRD §11: Starter shows 30 days of sales recap (other plans: unlimited). Existing databases.
UPDATE "plans" SET "limits" = "limits" || '{"recapDays": 30}'::jsonb WHERE "code" = 'starter';
