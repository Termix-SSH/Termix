ALTER TABLE "plugin_permission_grants" ALTER COLUMN "granted_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "plugin_permission_grants" ADD COLUMN "source" text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE "plugins" ADD COLUMN "last_error" text;