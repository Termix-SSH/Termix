CREATE TABLE "fleet_inventory" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"os_pretty_name" text,
	"kernel" text,
	"architecture" text,
	"hostname" text,
	"uptime_seconds" integer,
	"ip" text,
	"package_manager" text,
	"collected_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"fleet_id" integer NOT NULL,
	"host_id" integer NOT NULL,
	"added_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"color" text,
	"icon" text,
	"tag_rules" text,
	"sync_id" varchar(255),
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "fleets_sync_id_unique" UNIQUE("sync_id")
);
--> statement-breakpoint
ALTER TABLE "fleet_inventory" ADD CONSTRAINT "fleet_inventory_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_inventory" ADD CONSTRAINT "fleet_inventory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_members" ADD CONSTRAINT "fleet_members_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_members" ADD CONSTRAINT "fleet_members_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_fleet_inventory_host" ON "fleet_inventory" USING btree ("host_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_fleet_members_fleet_host" ON "fleet_members" USING btree ("fleet_id","host_id");