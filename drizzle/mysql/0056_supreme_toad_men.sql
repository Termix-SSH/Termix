-- The dialect generator now decides varchar or text per table. Columns that
-- were varchar(255) only because the same name was a key in another table
-- become text, and the timestamps and labels B18's regeneration left as
-- varchar(255) on real databases follow. varchar to text keeps every value.
ALTER TABLE `api_keys` MODIFY COLUMN `name` text NOT NULL;--> statement-breakpoint
ALTER TABLE `api_keys` MODIFY COLUMN `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `api_keys` MODIFY COLUMN `expires_at` text;--> statement-breakpoint
ALTER TABLE `credential_access` MODIFY COLUMN `expires_at` text;--> statement-breakpoint
ALTER TABLE `credential_access` MODIFY COLUMN `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `credential_sidebar_preferences` MODIFY COLUMN `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `folder_access` MODIFY COLUMN `expires_at` text;--> statement-breakpoint
ALTER TABLE `folder_access` MODIFY COLUMN `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `host_access` MODIFY COLUMN `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `host_sidebar_preferences` MODIFY COLUMN `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `ssh_data` MODIFY COLUMN `name` text;--> statement-breakpoint
ALTER TABLE `ssh_data` MODIFY COLUMN `folder` text;--> statement-breakpoint
ALTER TABLE `ssh_data` MODIFY COLUMN `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `ssh_data` MODIFY COLUMN `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `notification_channels` MODIFY COLUMN `name` text NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_channels` MODIFY COLUMN `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `plugin_install_counts` MODIFY COLUMN `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `plugin_registries` MODIFY COLUMN `name` text NOT NULL;--> statement-breakpoint
ALTER TABLE `plugin_settings` MODIFY COLUMN `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `plugin_storage` MODIFY COLUMN `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `plugins` MODIFY COLUMN `name` text NOT NULL;--> statement-breakpoint
ALTER TABLE `plugins` MODIFY COLUMN `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `rbac_known_permissions` MODIFY COLUMN `plugin_id` text;--> statement-breakpoint
ALTER TABLE `roles` MODIFY COLUMN `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `roles` MODIFY COLUMN `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `sessions` MODIFY COLUMN `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `shared_credential_secrets` MODIFY COLUMN `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `shared_credential_secrets` MODIFY COLUMN `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `shared_host_auth_overrides` MODIFY COLUMN `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `shared_host_auth_overrides` MODIFY COLUMN `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `shared_host_secrets` MODIFY COLUMN `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `shared_host_secrets` MODIFY COLUMN `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `ssh_credentials` MODIFY COLUMN `name` text NOT NULL;--> statement-breakpoint
ALTER TABLE `ssh_credentials` MODIFY COLUMN `folder` text;--> statement-breakpoint
ALTER TABLE `ssh_credentials` MODIFY COLUMN `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `ssh_credentials` MODIFY COLUMN `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `ssh_folders` MODIFY COLUMN `name` text NOT NULL;--> statement-breakpoint
ALTER TABLE `ssh_folders` MODIFY COLUMN `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `ssh_folders` MODIFY COLUMN `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `sync_tombstones` MODIFY COLUMN `sync_id` text NOT NULL;--> statement-breakpoint
ALTER TABLE `trusted_devices` MODIFY COLUMN `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `trusted_devices` MODIFY COLUMN `expires_at` text NOT NULL;--> statement-breakpoint
ALTER TABLE `ui_preferences` MODIFY COLUMN `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `user_external_identities` MODIFY COLUMN `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `user_open_tabs` MODIFY COLUMN `label` text NOT NULL;--> statement-breakpoint
ALTER TABLE `user_open_tabs` MODIFY COLUMN `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `user_open_tabs` MODIFY COLUMN `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `user_preferences` MODIFY COLUMN `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP);