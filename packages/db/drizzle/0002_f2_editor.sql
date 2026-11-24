ALTER TABLE "assets" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "pairing_codes" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_key_unique" UNIQUE("key");