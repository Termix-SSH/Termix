CREATE TABLE "plugin_install_counts" (
	"id" serial PRIMARY KEY NOT NULL,
	"plugin_id" varchar(255) NOT NULL,
	"registry_id" varchar(255) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'aggregate-telemetry' NOT NULL,
	"updated_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_permission_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"plugin_id" varchar(255) NOT NULL,
	"capability" varchar(255) NOT NULL,
	"granted_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"granted_by" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_registries" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"kind" text DEFAULT 'community' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"signing_key" text,
	"last_checked_at" text,
	"last_index_hash" text
);
--> statement-breakpoint
CREATE TABLE "plugins" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"version" text NOT NULL,
	"tier" text DEFAULT 'available' NOT NULL,
	"source" text DEFAULT 'community' NOT NULL,
	"registry_id" varchar(255),
	"state" text DEFAULT 'disabled' NOT NULL,
	"installed_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"auto_update" boolean DEFAULT false NOT NULL,
	"manifest_json" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plugin_permission_grants" ADD CONSTRAINT "plugin_permission_grants_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_permission_grants" ADD CONSTRAINT "plugin_permission_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_plugin_install_counts_plugin_registry" ON "plugin_install_counts" USING btree ("plugin_id","registry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_plugin_permission_grants_plugin_capability" ON "plugin_permission_grants" USING btree ("plugin_id","capability");--> statement-breakpoint
CREATE INDEX "idx_plugins_registry_id" ON "plugins" USING btree ("registry_id");