CREATE TABLE "host_defaults" (
	"id" serial PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"scope_key" varchar(255) NOT NULL,
	"user_id" varchar(255),
	"folder_id" integer,
	"namespace" varchar(255) NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text,
	"updated_by" text,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ssh_data" ADD COLUMN "default_overrides" text;--> statement-breakpoint
ALTER TABLE "host_defaults" ADD CONSTRAINT "host_defaults_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_defaults" ADD CONSTRAINT "host_defaults_folder_id_ssh_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."ssh_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_host_defaults_scope_key" ON "host_defaults" USING btree ("scope_key","namespace","key");--> statement-breakpoint
CREATE INDEX "idx_host_defaults_user" ON "host_defaults" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_host_defaults_folder" ON "host_defaults" USING btree ("folder_id");