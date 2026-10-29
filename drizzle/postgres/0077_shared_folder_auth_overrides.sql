CREATE TABLE "shared_folder_auth_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"folder" varchar(255) NOT NULL,
	"protocol" varchar(255) DEFAULT 'ssh' NOT NULL,
	"credential_id" integer NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared_folder_auth_overrides" ADD CONSTRAINT "shared_folder_auth_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_folder_auth_overrides" ADD CONSTRAINT "shared_folder_auth_overrides_credential_id_ssh_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."ssh_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shared_folder_auth_overrides_user_folder_protocol_unique" ON "shared_folder_auth_overrides" USING btree ("user_id","folder","protocol");