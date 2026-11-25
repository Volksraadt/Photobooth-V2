ALTER TABLE "booths" ADD COLUMN "voucher_offline" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "code_encrypted" text;--> statement-breakpoint
-- 16-digit (PBKDF2) vouchers cannot be entered any more (8-digit scrypt codes since 2026-11-25).
-- Unused ones are marked expired so counts and lists stop offering them; nothing is deleted.
UPDATE "vouchers" SET "expires_at" = now() WHERE "code_encrypted" IS NULL AND "used_at" IS NULL AND ("expires_at" IS NULL OR "expires_at" > now());
