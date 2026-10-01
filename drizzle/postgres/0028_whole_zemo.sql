CREATE TABLE "plugin_migrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"plugin_id" varchar(255) NOT NULL,
	"migration_id" varchar(255) NOT NULL,
	"checksum" text NOT NULL,
	"applied_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plugin_migrations" ADD CONSTRAINT "plugin_migrations_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_plugin_migrations_plugin_migration" ON "plugin_migrations" USING btree ("plugin_id","migration_id");