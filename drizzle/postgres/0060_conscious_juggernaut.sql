CREATE TABLE "sync_conflicts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"entity_type" text NOT NULL,
	"sync_id" text NOT NULL,
	"local_row" text NOT NULL,
	"server_revision" integer NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_link" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"server_url" text NOT NULL,
	"server_name" text,
	"server_version" text,
	"session_token" text,
	"custom_headers" text,
	"basic_auth" text,
	"allow_invalid_certificate" boolean DEFAULT false NOT NULL,
	"remote_user_id" text,
	"remote_username" text,
	"account" text,
	"scope" text,
	"known_types" text,
	"cursor" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"last_error" text,
	"linked_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"last_sync_at" text
);
--> statement-breakpoint
CREATE TABLE "sync_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"entity_type" varchar(255) NOT NULL,
	"sync_id" varchar(255) NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"hash" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"error" text,
	"error_hash" text,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ssh_data" ADD COLUMN "local_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ssh_data" ADD COLUMN "shared_source" text;--> statement-breakpoint
ALTER TABLE "ssh_credentials" ADD COLUMN "shared_source" text;--> statement-breakpoint
ALTER TABLE "ssh_folders" ADD COLUMN "local_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_link" ADD CONSTRAINT "sync_link_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_records" ADD CONSTRAINT "sync_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sync_conflicts_user" ON "sync_conflicts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sync_records_user_entity_sync" ON "sync_records" USING btree ("user_id","entity_type","sync_id");--> statement-breakpoint
CREATE INDEX "idx_sync_records_user_seq" ON "sync_records" USING btree ("user_id","seq");