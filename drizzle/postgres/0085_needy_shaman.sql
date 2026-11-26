CREATE TABLE "sync_pending_host_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_id" integer NOT NULL,
	"plugin_id" varchar(255) NOT NULL,
	"settings" text NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_pending_host_settings" ADD CONSTRAINT "sync_pending_host_settings_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sync_pending_host_settings_host_plugin" ON "sync_pending_host_settings" USING btree ("host_id","plugin_id");