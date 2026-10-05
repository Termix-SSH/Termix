PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ssh_folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`icon` text,
	`sort_order` integer,
	`sync_id` text,
	`local_only` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_ssh_folders`("id", "user_id", "name", "color", "icon", "sort_order", "sync_id", "local_only", "created_at", "updated_at") SELECT "id", "user_id", "name", "color", "icon", "sort_order", "sync_id", "local_only", "created_at", "updated_at" FROM `ssh_folders`;--> statement-breakpoint
DROP TABLE `ssh_folders`;--> statement-breakpoint
ALTER TABLE `__new_ssh_folders` RENAME TO `ssh_folders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `ssh_folders_sync_id_unique` ON `ssh_folders` (`sync_id`);--> statement-breakpoint
CREATE INDEX `idx_ssh_folders_user_id` ON `ssh_folders` (`user_id`);--> statement-breakpoint
ALTER TABLE `ssh_data` DROP COLUMN `terminal_config`;--> statement-breakpoint
ALTER TABLE `ssh_data` DROP COLUMN `quick_actions`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `oidc_sub`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `oidc_sid`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `sso_provider_id`;--> statement-breakpoint
ALTER TABLE `user_preferences` DROP COLUMN `command_autocomplete`;--> statement-breakpoint
ALTER TABLE `user_preferences` DROP COLUMN `confirm_snippet_execution`;--> statement-breakpoint
ALTER TABLE `user_preferences` DROP COLUMN `custom_themes`;--> statement-breakpoint
ALTER TABLE `user_preferences` DROP COLUMN `terminal_defaults`;--> statement-breakpoint
ALTER TABLE `user_preferences` DROP COLUMN `terminal_macros`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `is_oidc`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `oidc_identifier`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `sso_provider_id`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `client_id`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `client_secret`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `issuer_url`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `authorization_url`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `token_url`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `identifier_path`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `name_path`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `scopes`;--> statement-breakpoint
DELETE FROM `settings` WHERE `key` IN ('host_defaults', 'analytics_enabled', 'analytics_instance_id');--> statement-breakpoint
UPDATE `ssh_data` SET `username` = REPLACE(`username`, '$oidc.preferred_username', '$external.username') WHERE `username` LIKE '%$oidc.preferred_username%';--> statement-breakpoint
UPDATE `ssh_credentials` SET `username` = REPLACE(`username`, '$oidc.preferred_username', '$external.username') WHERE `username` LIKE '%$oidc.preferred_username%';--> statement-breakpoint
UPDATE `host_defaults` SET `value` = REPLACE(`value`, '$oidc.preferred_username', '$external.username') WHERE `value` LIKE '%$oidc.preferred_username%';