ALTER TABLE "api_keys" ADD COLUMN "host_ids" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "auto_approve" boolean DEFAULT false NOT NULL;