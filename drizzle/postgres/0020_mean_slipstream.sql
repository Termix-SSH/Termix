ALTER TABLE "shared_credential_secrets" DROP CONSTRAINT "shared_credential_secrets_credential_access_id_credential_access_id_fk";
--> statement-breakpoint
ALTER TABLE "shared_credential_secrets" ADD CONSTRAINT "shared_cred_secrets_access_id_fk" FOREIGN KEY ("credential_access_id") REFERENCES "public"."credential_access"("id") ON DELETE cascade ON UPDATE no action;