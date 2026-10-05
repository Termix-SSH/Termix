ALTER TABLE "ssh_folders" DROP CONSTRAINT "ssh_folders_credential_id_ssh_credentials_id_fk";
--> statement-breakpoint
ALTER TABLE "ssh_data" DROP COLUMN "terminal_config";--> statement-breakpoint
ALTER TABLE "ssh_data" DROP COLUMN "quick_actions";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "oidc_sub";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "oidc_sid";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "sso_provider_id";--> statement-breakpoint
ALTER TABLE "ssh_folders" DROP COLUMN "credential_id";--> statement-breakpoint
ALTER TABLE "user_preferences" DROP COLUMN "command_autocomplete";--> statement-breakpoint
ALTER TABLE "user_preferences" DROP COLUMN "confirm_snippet_execution";--> statement-breakpoint
ALTER TABLE "user_preferences" DROP COLUMN "custom_themes";--> statement-breakpoint
ALTER TABLE "user_preferences" DROP COLUMN "terminal_defaults";--> statement-breakpoint
ALTER TABLE "user_preferences" DROP COLUMN "terminal_macros";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "is_oidc";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "oidc_identifier";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "sso_provider_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "client_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "client_secret";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "issuer_url";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "authorization_url";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "token_url";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "identifier_path";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "name_path";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "scopes";--> statement-breakpoint
DELETE FROM "settings" WHERE "key" IN ('host_defaults', 'analytics_enabled', 'analytics_instance_id');--> statement-breakpoint
UPDATE "ssh_data" SET "username" = REPLACE("username", '$oidc.preferred_username', '$external.username') WHERE "username" LIKE '%$oidc.preferred_username%';--> statement-breakpoint
UPDATE "ssh_credentials" SET "username" = REPLACE("username", '$oidc.preferred_username', '$external.username') WHERE "username" LIKE '%$oidc.preferred_username%';--> statement-breakpoint
UPDATE "host_defaults" SET "value" = REPLACE("value", '$oidc.preferred_username', '$external.username') WHERE "value" LIKE '%$oidc.preferred_username%';