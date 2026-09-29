-- The RDP, VNC and Telnet logins moved out of ssh_data into host_protocol_auth.
-- A boot migration copies them after this runs, so the old ssh_data columns
-- and their foreign keys stay in place, unused, until 3.0.0.
CREATE TABLE "host_protocol_auth" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"protocol" varchar(255) NOT NULL,
	"auth_type" text DEFAULT 'direct' NOT NULL,
	"credential_id" integer,
	"username" text,
	"password" text,
	"fields" text,
	"secret_fields" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared_host_secrets" ADD COLUMN "encrypted_fields" text;--> statement-breakpoint
ALTER TABLE "host_protocol_auth" ADD CONSTRAINT "host_protocol_auth_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_protocol_auth" ADD CONSTRAINT "host_protocol_auth_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_protocol_auth" ADD CONSTRAINT "host_protocol_auth_credential_id_ssh_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."ssh_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_host_protocol_auth_host_protocol" ON "host_protocol_auth" USING btree ("host_id","protocol");--> statement-breakpoint
CREATE INDEX "idx_host_protocol_auth_user" ON "host_protocol_auth" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_host_protocol_auth_credential" ON "host_protocol_auth" USING btree ("credential_id");
