ALTER TABLE "ssh_data" ADD COLUMN "enable_web_ui" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ssh_data" ADD COLUMN "web_ui_config" text;