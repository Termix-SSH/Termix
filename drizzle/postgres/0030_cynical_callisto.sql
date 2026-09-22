CREATE TABLE "plugin_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"plugin_id" varchar(255) NOT NULL,
	"scope" varchar(255) NOT NULL,
	"scope_id" varchar(255),
	"key" varchar(255) NOT NULL,
	"value" text,
	"encrypted" boolean DEFAULT false NOT NULL,
	"updated_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plugin_settings" ADD CONSTRAINT "plugin_settings_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_plugin_settings_scope_key" ON "plugin_settings" USING btree ("plugin_id","scope","scope_id","key");--> statement-breakpoint
CREATE INDEX "idx_plugin_settings_plugin_scope" ON "plugin_settings" USING btree ("plugin_id","scope");