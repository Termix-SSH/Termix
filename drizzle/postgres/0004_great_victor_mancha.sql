CREATE TABLE "proxmox_node_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_id" integer NOT NULL,
	"ts" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"cpu_percent" double precision,
	"mem_percent" double precision,
	"disk_percent" double precision,
	"net_rx_bytes" integer,
	"net_tx_bytes" integer
);
--> statement-breakpoint
CREATE TABLE "proxmox_stats_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"host_id" integer NOT NULL,
	"layout" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ssh_data" ADD COLUMN "enable_proxmox_stats" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ssh_data" ADD COLUMN "proxmox_stats_config" text;--> statement-breakpoint
ALTER TABLE "proxmox_node_history" ADD CONSTRAINT "proxmox_node_history_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxmox_stats_preferences" ADD CONSTRAINT "proxmox_stats_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxmox_stats_preferences" ADD CONSTRAINT "proxmox_stats_preferences_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_proxmox_stats_prefs_user_host" ON "proxmox_stats_preferences" USING btree ("user_id","host_id");