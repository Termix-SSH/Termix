CREATE TABLE "credential_sidebar_preferences" (
	"user_id" varchar(255) PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ssh_credentials" ADD COLUMN "pin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ssh_credentials" ADD COLUMN "sort_order" integer;--> statement-breakpoint
ALTER TABLE "credential_sidebar_preferences" ADD CONSTRAINT "credential_sidebar_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;