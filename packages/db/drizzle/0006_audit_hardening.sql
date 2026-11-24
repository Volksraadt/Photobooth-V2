-- Audit 2026-11-25 (docs/audit-mvp.md T3): device identity is immutable, revocation is final.
-- Owners/managers may still rename a device, set the paper roll or revoke it (RLS + grants), but no
-- connection (Studio, a direct Data API call, or the service role) can swap a device's token
-- hash, move it to another org, or un-revoke it. Re-pairing always creates a new device row.
CREATE OR REPLACE FUNCTION app.guard_device_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash THEN
    RAISE EXCEPTION 'devices.token_hash is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'devices.org_id is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'a revoked device cannot be restored' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER devices_guard_identity BEFORE UPDATE ON "devices"
  FOR EACH ROW EXECUTE FUNCTION app.guard_device_identity();--> statement-breakpoint
-- Raw provider payloads are member-readable (RLS); the notification signature is not needed there.
UPDATE "payments" SET "raw" = jsonb_set("raw", '{webhook}', ("raw"->'webhook') - 'signature_key')
  WHERE "raw" ? 'webhook' AND jsonb_typeof("raw"->'webhook') = 'object';
