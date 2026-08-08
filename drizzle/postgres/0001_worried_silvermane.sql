CREATE TABLE "host_sidebar_preferences" (
	"user_id" varchar(255) PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ssh_data" ADD COLUMN "sort_order" integer;--> statement-breakpoint
ALTER TABLE "ssh_folders" ADD COLUMN "sort_order" integer;--> statement-breakpoint
ALTER TABLE "host_sidebar_preferences" ADD CONSTRAINT "host_sidebar_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;