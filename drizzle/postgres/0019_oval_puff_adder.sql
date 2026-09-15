CREATE TABLE "folder_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" varchar(255) NOT NULL,
	"folder" varchar(255) NOT NULL,
	"user_id" varchar(255),
	"role_id" integer,
	"granted_by" varchar(255) NOT NULL,
	"permission_level" text DEFAULT 'connect' NOT NULL,
	"expires_at" varchar(255),
	"created_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ssh_data" ALTER COLUMN "folder" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "snippets" ALTER COLUMN "folder" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "ssh_credentials" ALTER COLUMN "folder" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "vault_profiles" ALTER COLUMN "folder" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "folder_access" ADD CONSTRAINT "folder_access_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_access" ADD CONSTRAINT "folder_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_access" ADD CONSTRAINT "folder_access_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_access" ADD CONSTRAINT "folder_access_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_folder_access_owner_folder" ON "folder_access" USING btree ("owner_user_id","folder");