-- Row Level Security for Studio access (role `authenticated`, user id from auth.uid()).
-- apps/api + apps/worker connect as the table owner / service role (bypass RLS) and must
-- always filter by org_id explicitly.
-- Requires: schema `auth` with auth.users + auth.uid(), roles anon/authenticated
-- (provided by Supabase, or by src/auth-shim.sql for local/test databases).

-- ---------------------------------------------------------------------------
-- Tenant consistency: child rows must belong to the same org as their parent.
-- ---------------------------------------------------------------------------
ALTER TABLE "booths" ADD CONSTRAINT "booths_id_org_uq" UNIQUE ("id", "org_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_id_org_uq" UNIQUE ("id", "org_id");--> statement-breakpoint
ALTER TABLE "booth_configs" ADD CONSTRAINT "booth_configs_booth_org_fk" FOREIGN KEY ("booth_id", "org_id") REFERENCES "booths" ("id", "org_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "booth_drafts" ADD CONSTRAINT "booth_drafts_booth_org_fk" FOREIGN KEY ("booth_id", "org_id") REFERENCES "booths" ("id", "org_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_booth_org_fk" FOREIGN KEY ("booth_id", "org_id") REFERENCES "booths" ("id", "org_id");--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_booth_org_fk" FOREIGN KEY ("booth_id", "org_id") REFERENCES "booths" ("id", "org_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_booth_org_fk" FOREIGN KEY ("booth_id", "org_id") REFERENCES "booths" ("id", "org_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session_shots" ADD CONSTRAINT "session_shots_session_org_fk" FOREIGN KEY ("session_id", "org_id") REFERENCES "sessions" ("id", "org_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session_outputs" ADD CONSTRAINT "session_outputs_session_org_fk" FOREIGN KEY ("session_id", "org_id") REFERENCES "sessions" ("id", "org_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_session_org_fk" FOREIGN KEY ("session_id", "org_id") REFERENCES "sessions" ("id", "org_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cash_approvals" ADD CONSTRAINT "cash_approvals_session_org_fk" FOREIGN KEY ("session_id", "org_id") REFERENCES "sessions" ("id", "org_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD CONSTRAINT "upload_jobs_session_org_fk" FOREIGN KEY ("session_id", "org_id") REFERENCES "sessions" ("id", "org_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER so they can read org_members without recursing into RLS)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS "app";--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.is_org_member(p_org_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = p_org_id AND m.user_id = auth.uid()
  );
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.has_org_role(p_org_id text, p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = p_org_id AND m.user_id = auth.uid() AND m.role::text = ANY (p_roles)
  );
$$;--> statement-breakpoint

-- Creates an org with the caller as owner and starts the trial.
-- Trial = 14 days on plan `pro` (docs/open-questions.md #3). Ids come from the app (cuid2).
CREATE OR REPLACE FUNCTION app.create_org(
  p_org_id text, p_member_id text, p_subscription_id text,
  p_name text, p_slug text, p_timezone text
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_plan text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'org name required' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_plan FROM public.plans WHERE code = 'pro';
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'plan pro not seeded' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.orgs (id, name, slug, timezone) VALUES (p_org_id, trim(p_name), p_slug, p_timezone);
  INSERT INTO public.org_members (id, org_id, user_id, role) VALUES (p_member_id, p_org_id, v_uid, 'owner');
  INSERT INTO public.subscriptions (id, org_id, plan_id, status, current_period_start, current_period_end)
    VALUES (p_subscription_id, p_org_id, v_plan, 'trialing', now(), now() + interval '14 days');
  RETURN p_org_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;--> statement-breakpoint

REVOKE ALL ON SCHEMA app FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO authenticated;--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.is_org_member(text) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.has_org_role(text, text[]) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.create_org(text, text, text, text, text, text) TO authenticated;--> statement-breakpoint

-- Append-only audit log, enforced for every role including the owner.
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();--> statement-breakpoint

-- Published configs are immutable.
CREATE TRIGGER booth_configs_no_update BEFORE UPDATE ON "booth_configs"
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Grants. RLS below decides which rows; tables without policies stay closed.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;--> statement-breakpoint

ALTER TABLE "orgs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "booths" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "booth_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "booth_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pairing_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session_shots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session_outputs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vouchers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "drive_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fee_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "device_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "print_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "upload_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Global read-only reference data.
CREATE POLICY "plans_read" ON "plans" FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY "fee_settings_read" ON "fee_settings" FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY "templates_read_public" ON "templates" FOR SELECT TO authenticated USING (is_public);--> statement-breakpoint

-- Orgs & members. Org creation goes through app.create_org().
CREATE POLICY "orgs_member_read" ON "orgs" FOR SELECT TO authenticated USING (app.is_org_member(id));--> statement-breakpoint
CREATE POLICY "orgs_owner_update" ON "orgs" FOR UPDATE TO authenticated
  USING (app.has_org_role(id, ARRAY['owner'])) WITH CHECK (app.has_org_role(id, ARRAY['owner']));--> statement-breakpoint
CREATE POLICY "org_members_member_read" ON "org_members" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint
CREATE POLICY "org_members_owner_insert" ON "org_members" FOR INSERT TO authenticated WITH CHECK (app.has_org_role(org_id, ARRAY['owner']));--> statement-breakpoint
CREATE POLICY "org_members_owner_update" ON "org_members" FOR UPDATE TO authenticated
  USING (app.has_org_role(org_id, ARRAY['owner'])) WITH CHECK (app.has_org_role(org_id, ARRAY['owner']));--> statement-breakpoint
CREATE POLICY "org_members_owner_delete" ON "org_members" FOR DELETE TO authenticated USING (app.has_org_role(org_id, ARRAY['owner']));--> statement-breakpoint

-- Billing: read-only for members (written by API/worker).
CREATE POLICY "subscriptions_member_read" ON "subscriptions" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint
CREATE POLICY "billing_invoices_member_read" ON "billing_invoices" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint

-- Configuration tables: members read, owner/manager write.
CREATE POLICY "booths_member_read" ON "booths" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint
CREATE POLICY "booths_editor_insert" ON "booths" FOR INSERT TO authenticated WITH CHECK (app.has_org_role(org_id, ARRAY['owner','manager']));--> statement-breakpoint
CREATE POLICY "booths_editor_update" ON "booths" FOR UPDATE TO authenticated
  USING (app.has_org_role(org_id, ARRAY['owner','manager'])) WITH CHECK (app.has_org_role(org_id, ARRAY['owner','manager']));--> statement-breakpoint
CREATE POLICY "booths_editor_delete" ON "booths" FOR DELETE TO authenticated USING (app.has_org_role(org_id, ARRAY['owner','manager']));--> statement-breakpoint

CREATE POLICY "booth_configs_member_read" ON "booth_configs" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint
CREATE POLICY "booth_configs_editor_insert" ON "booth_configs" FOR INSERT TO authenticated WITH CHECK (app.has_org_role(org_id, ARRAY['owner','manager']));--> statement-breakpoint

CREATE POLICY "booth_drafts_member_read" ON "booth_drafts" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint
CREATE POLICY "booth_drafts_editor_insert" ON "booth_drafts" FOR INSERT TO authenticated WITH CHECK (app.has_org_role(org_id, ARRAY['owner','manager']));--> statement-breakpoint
CREATE POLICY "booth_drafts_editor_update" ON "booth_drafts" FOR UPDATE TO authenticated
  USING (app.has_org_role(org_id, ARRAY['owner','manager'])) WITH CHECK (app.has_org_role(org_id, ARRAY['owner','manager']));--> statement-breakpoint
CREATE POLICY "booth_drafts_editor_delete" ON "booth_drafts" FOR DELETE TO authenticated USING (app.has_org_role(org_id, ARRAY['owner','manager']));--> statement-breakpoint

-- Devices: members read; owner/manager rename/revoke/delete. Creation happens via API pairing.
CREATE POLICY "devices_member_read" ON "devices" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint
CREATE POLICY "devices_editor_update" ON "devices" FOR UPDATE TO authenticated
  USING (app.has_org_role(org_id, ARRAY['owner','manager'])) WITH CHECK (app.has_org_role(org_id, ARRAY['owner','manager']));--> statement-breakpoint
CREATE POLICY "devices_editor_delete" ON "devices" FOR DELETE TO authenticated USING (app.has_org_role(org_id, ARRAY['owner','manager']));--> statement-breakpoint

CREATE POLICY "assets_member_read" ON "assets" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint
CREATE POLICY "assets_editor_insert" ON "assets" FOR INSERT TO authenticated WITH CHECK (app.has_org_role(org_id, ARRAY['owner','manager']));--> statement-breakpoint
CREATE POLICY "assets_editor_delete" ON "assets" FOR DELETE TO authenticated USING (app.has_org_role(org_id, ARRAY['owner','manager']));--> statement-breakpoint

CREATE POLICY "vouchers_member_read" ON "vouchers" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint
CREATE POLICY "vouchers_editor_insert" ON "vouchers" FOR INSERT TO authenticated WITH CHECK (app.has_org_role(org_id, ARRAY['owner','manager']));--> statement-breakpoint
CREATE POLICY "vouchers_editor_delete" ON "vouchers" FOR DELETE TO authenticated USING (app.has_org_role(org_id, ARRAY['owner','manager']));--> statement-breakpoint

-- Operational data: read-only for members (written by API/worker).
CREATE POLICY "sessions_member_read" ON "sessions" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint
CREATE POLICY "session_shots_member_read" ON "session_shots" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint
CREATE POLICY "session_outputs_member_read" ON "session_outputs" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint
CREATE POLICY "payments_member_read" ON "payments" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint
CREATE POLICY "cash_approvals_member_read" ON "cash_approvals" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint
CREATE POLICY "device_events_member_read" ON "device_events" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint
CREATE POLICY "print_jobs_member_read" ON "print_jobs" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint
CREATE POLICY "upload_jobs_member_read" ON "upload_jobs" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint

-- Audit log: members read; members may append entries as themselves.
CREATE POLICY "audit_logs_member_read" ON "audit_logs" FOR SELECT TO authenticated USING (app.is_org_member(org_id));--> statement-breakpoint
CREATE POLICY "audit_logs_member_insert" ON "audit_logs" FOR INSERT TO authenticated
  WITH CHECK (app.is_org_member(org_id) AND actor_id = auth.uid());--> statement-breakpoint

-- pairing_codes, payment_credentials, drive_connections: RLS on, no policies = closed to Studio.
-- Secrets never leave apps/api + apps/worker.
SELECT 1;
