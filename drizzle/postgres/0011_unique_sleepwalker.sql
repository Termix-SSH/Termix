ALTER TABLE "alert_firings" ALTER COLUMN "fired_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "alert_firings" ALTER COLUMN "fired_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "session_recordings" ALTER COLUMN "started_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "session_recordings" ALTER COLUMN "started_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "session_shares" ALTER COLUMN "session_id" SET DATA TYPE varchar(255);--> statement-breakpoint
CREATE INDEX "idx_alert_firings_rule" ON "alert_firings" USING btree ("rule_id","fired_at");--> statement-breakpoint
CREATE INDEX "idx_alert_firings_host" ON "alert_firings" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "idx_api_keys_user_id" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_command_history_user_host" ON "command_history" USING btree ("user_id","host_id");--> statement-breakpoint
CREATE INDEX "idx_dismissed_alerts_user_id" ON "dismissed_alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_file_manager_pinned_user" ON "file_manager_pinned" USING btree ("user_id","host_id");--> statement-breakpoint
CREATE INDEX "idx_file_manager_recent_user" ON "file_manager_recent" USING btree ("user_id","host_id");--> statement-breakpoint
CREATE INDEX "idx_file_manager_shortcuts_user" ON "file_manager_shortcuts" USING btree ("user_id","host_id");--> statement-breakpoint
CREATE INDEX "idx_fleet_inventory_user" ON "fleet_inventory" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_fleet_members_host" ON "fleet_members" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "idx_homepage_items_user_id" ON "homepage_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_recent_activity_user_ts" ON "recent_activity" USING btree ("user_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_session_recordings_user_started" ON "session_recordings" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_session_recordings_host" ON "session_recordings" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "idx_session_shares_session_id" ON "session_shares" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_session_shares_host_id" ON "session_shares" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "idx_snippet_access_user_id" ON "snippet_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_snippet_access_snippet_id" ON "snippet_access" USING btree ("snippet_id");--> statement-breakpoint
CREATE INDEX "idx_snippet_access_role_id" ON "snippet_access" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_snippets_user_id" ON "snippets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_ssh_credential_usage_credential" ON "ssh_credential_usage" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "idx_ssh_credential_usage_user" ON "ssh_credential_usage" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_ssh_credentials_user_id" ON "ssh_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_ssh_folders_user_id" ON "ssh_folders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_transfer_recent_user" ON "transfer_recent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_trusted_devices_user_id" ON "trusted_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_open_tabs_user_id" ON "user_open_tabs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_roles_role_id" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_user_workspaces_user_id" ON "user_workspaces" USING btree ("user_id");