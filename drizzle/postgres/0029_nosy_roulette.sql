CREATE TABLE "rbac_applied_defaults" (
	"id" serial PRIMARY KEY NOT NULL,
	"role_name" varchar(255) NOT NULL,
	"permission" varchar(255) NOT NULL,
	"applied_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rbac_known_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"permission" varchar(255) NOT NULL,
	"plugin_id" varchar(255),
	"first_seen_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_rbac_applied_defaults_role_permission" ON "rbac_applied_defaults" USING btree ("role_name","permission");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_rbac_known_permissions_permission" ON "rbac_known_permissions" USING btree ("permission");