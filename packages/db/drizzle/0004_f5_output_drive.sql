ALTER TABLE "session_outputs" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "session_outputs" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "session_outputs" ADD COLUMN "bytes" integer;--> statement-breakpoint
ALTER TABLE "session_outputs" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "session_outputs" ADD COLUMN "slot_index" integer;--> statement-breakpoint
ALTER TABLE "session_outputs" ADD COLUMN "source_file_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "drive_folder_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "manifest" jsonb;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "files_complete_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drive_connections" ADD COLUMN "root_folder_name" text;--> statement-breakpoint
ALTER TABLE "drive_connections" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "drive_connections" ADD COLUMN "connected_by" text;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "session_outputs_source_uq" ON "session_outputs" USING btree ("session_id","source_file_id") WHERE "session_outputs"."source_file_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "session_outputs_name_uq" ON "session_outputs" USING btree ("session_id","kind","name");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_jobs_session_target_uq" ON "upload_jobs" USING btree ("session_id","target");--> statement-breakpoint
CREATE INDEX "upload_jobs_status_idx" ON "upload_jobs" USING btree ("status","next_attempt_at");