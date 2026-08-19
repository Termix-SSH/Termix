ALTER TABLE `alert_firings` MODIFY COLUMN `fired_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `session_recordings` MODIFY COLUMN `started_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `session_shares` MODIFY COLUMN `session_id` varchar(255) NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_alert_firings_rule` ON `alert_firings` (`rule_id`,`fired_at`);--> statement-breakpoint
CREATE INDEX `idx_alert_firings_host` ON `alert_firings` (`host_id`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_user_id` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_command_history_user_host` ON `command_history` (`user_id`,`host_id`);--> statement-breakpoint
CREATE INDEX `idx_dismissed_alerts_user_id` ON `dismissed_alerts` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_file_manager_pinned_user` ON `file_manager_pinned` (`user_id`,`host_id`);--> statement-breakpoint
CREATE INDEX `idx_file_manager_recent_user` ON `file_manager_recent` (`user_id`,`host_id`);--> statement-breakpoint
CREATE INDEX `idx_file_manager_shortcuts_user` ON `file_manager_shortcuts` (`user_id`,`host_id`);--> statement-breakpoint
CREATE INDEX `idx_fleet_inventory_user` ON `fleet_inventory` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_fleet_members_host` ON `fleet_members` (`host_id`);--> statement-breakpoint
CREATE INDEX `idx_homepage_items_user_id` ON `homepage_items` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_recent_activity_user_ts` ON `recent_activity` (`user_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_session_recordings_user_started` ON `session_recordings` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_session_recordings_host` ON `session_recordings` (`host_id`);--> statement-breakpoint
CREATE INDEX `idx_session_shares_session_id` ON `session_shares` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_session_shares_host_id` ON `session_shares` (`host_id`);--> statement-breakpoint
CREATE INDEX `idx_snippet_access_user_id` ON `snippet_access` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_snippet_access_snippet_id` ON `snippet_access` (`snippet_id`);--> statement-breakpoint
CREATE INDEX `idx_snippet_access_role_id` ON `snippet_access` (`role_id`);--> statement-breakpoint
CREATE INDEX `idx_snippets_user_id` ON `snippets` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_ssh_credential_usage_credential` ON `ssh_credential_usage` (`credential_id`);--> statement-breakpoint
CREATE INDEX `idx_ssh_credential_usage_user` ON `ssh_credential_usage` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_ssh_credentials_user_id` ON `ssh_credentials` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_ssh_folders_user_id` ON `ssh_folders` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_recent_user` ON `transfer_recent` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_trusted_devices_user_id` ON `trusted_devices` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_user_open_tabs_user_id` ON `user_open_tabs` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_user_roles_role_id` ON `user_roles` (`role_id`);--> statement-breakpoint
CREATE INDEX `idx_user_workspaces_user_id` ON `user_workspaces` (`user_id`);