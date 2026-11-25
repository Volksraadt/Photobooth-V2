CREATE TABLE "library_frames" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"url" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"slots" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Owners read published library frames; writes go through the API's platform-admin routes.
ALTER TABLE "library_frames" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "library_frames_read_published" ON "library_frames" FOR SELECT TO authenticated USING (is_published);
--> statement-breakpoint
REVOKE ALL ON "library_frames" FROM PUBLIC, anon;--> statement-breakpoint
GRANT SELECT ON "library_frames" TO authenticated;
