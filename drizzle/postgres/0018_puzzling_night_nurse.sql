CREATE TABLE "credential_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"credential_id" integer NOT NULL,
	"user_id" varchar(255),
	"role_id" integer,
	"granted_by" varchar(255) NOT NULL,
	"permission_level" text DEFAULT 'use' NOT NULL,
	"expires_at" varchar(255),
	"created_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_credential_secrets" (
	"id" serial PRIMARY KEY NOT NULL,
	"credential_access_id" integer NOT NULL,
	"target_user_id" varchar(255) NOT NULL,
	"credential_id" integer NOT NULL,
	"encrypted_username" text,
	"auth_type" text DEFAULT 'password' NOT NULL,
	"encrypted_password" text,
	"encrypted_key" text,
	"encrypted_key_password" text,
	"key_type" text,
	"public_key" text,
	"cert_public_key" text,
	"created_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credential_access" ADD CONSTRAINT "credential_access_credential_id_ssh_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."ssh_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_access" ADD CONSTRAINT "credential_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_access" ADD CONSTRAINT "credential_access_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_access" ADD CONSTRAINT "credential_access_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_credential_secrets" ADD CONSTRAINT "shared_credential_secrets_credential_access_id_credential_access_id_fk" FOREIGN KEY ("credential_access_id") REFERENCES "public"."credential_access"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_credential_secrets" ADD CONSTRAINT "shared_credential_secrets_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_credential_secrets" ADD CONSTRAINT "shared_credential_secrets_credential_id_ssh_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."ssh_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_credential_access_user_id" ON "credential_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_credential_access_role_id" ON "credential_access" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_credential_access_credential_id" ON "credential_access" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_shared_credential_secrets_scope" ON "shared_credential_secrets" USING btree ("credential_access_id","target_user_id");--> statement-breakpoint
CREATE INDEX "idx_shared_credential_secrets_target" ON "shared_credential_secrets" USING btree ("target_user_id","credential_id");