ALTER TABLE "cash_approvals" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "cash_approvals" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "env" "provider_env";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "batch_id" text;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "used_offline" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_credentials" ADD COLUMN "client_key" text;--> statement-breakpoint
ALTER TABLE "payment_credentials" ADD COLUMN "is_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_credentials" ADD COLUMN "last_test_message" text;--> statement-breakpoint
ALTER TABLE "cash_approvals" ADD CONSTRAINT "cash_approvals_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_org_status_idx" ON "payments" USING btree ("org_id","status");--> statement-breakpoint
-- One active credential (env) per org + provider.
CREATE UNIQUE INDEX "payment_credentials_one_active_uq" ON "payment_credentials" ("org_id","provider") WHERE "is_active";--> statement-breakpoint
-- Initial MDR for Midtrans QRIS (data, not code: change by inserting a row with a later effective_from).
INSERT INTO "fee_settings" ("id","provider","method","percent","fixed","effective_from")
VALUES ('fee_midtrans_qris_2024','midtrans','qris','0.7000',0,'2024-01-01T00:00:00Z')
ON CONFLICT DO NOTHING;
