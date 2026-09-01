ALTER TABLE "api_keys" ALTER COLUMN "expires_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "action" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "resource_type" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "timestamp" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "timestamp" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "host_access" ALTER COLUMN "expires_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "opkssh_tokens" ALTER COLUMN "expires_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "recent_activity" ALTER COLUMN "timestamp" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "recent_activity" ALTER COLUMN "timestamp" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "session_shares" ALTER COLUMN "expires_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "expires_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "snippet_access" ALTER COLUMN "expires_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "trusted_devices" ALTER COLUMN "expires_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "vault_tokens" ALTER COLUMN "expires_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ALTER COLUMN "credential_id" SET DATA TYPE varchar(255);--> statement-breakpoint
CREATE INDEX "idx_audit_logs_timestamp" ON "audit_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_user_ts" ON "audit_logs" USING btree ("user_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_action_ts" ON "audit_logs" USING btree ("action","timestamp");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_resource_ts" ON "audit_logs" USING btree ("resource_type","timestamp");--> statement-breakpoint
CREATE INDEX "idx_host_access_user_id" ON "host_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_host_access_role_id" ON "host_access" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_host_access_host_id" ON "host_access" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "idx_host_access_expires_at" ON "host_access" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_ssh_data_user_id" ON "ssh_data" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_ssh_data_parent_host" ON "ssh_data" USING btree ("parent_host_id");--> statement-breakpoint
CREATE INDEX "idx_ssh_data_credential" ON "ssh_data" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_user_id" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires_at" ON "sessions" USING btree ("expires_at");