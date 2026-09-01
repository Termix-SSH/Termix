ALTER TABLE `api_keys` MODIFY COLUMN `expires_at` varchar(255);--> statement-breakpoint
ALTER TABLE `audit_logs` MODIFY COLUMN `action` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_logs` MODIFY COLUMN `resource_type` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_logs` MODIFY COLUMN `timestamp` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `host_access` MODIFY COLUMN `expires_at` varchar(255);--> statement-breakpoint
ALTER TABLE `opkssh_tokens` MODIFY COLUMN `expires_at` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `recent_activity` MODIFY COLUMN `timestamp` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `session_shares` MODIFY COLUMN `expires_at` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` MODIFY COLUMN `expires_at` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `snippet_access` MODIFY COLUMN `expires_at` varchar(255);--> statement-breakpoint
ALTER TABLE `trusted_devices` MODIFY COLUMN `expires_at` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `vault_tokens` MODIFY COLUMN `expires_at` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `webauthn_credentials` MODIFY COLUMN `credential_id` varchar(255) NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_audit_logs_timestamp` ON `audit_logs` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_user_ts` ON `audit_logs` (`user_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_action_ts` ON `audit_logs` (`action`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_resource_ts` ON `audit_logs` (`resource_type`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_host_access_user_id` ON `host_access` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_host_access_role_id` ON `host_access` (`role_id`);--> statement-breakpoint
CREATE INDEX `idx_host_access_host_id` ON `host_access` (`host_id`);--> statement-breakpoint
CREATE INDEX `idx_host_access_expires_at` ON `host_access` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_ssh_data_user_id` ON `ssh_data` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_ssh_data_parent_host` ON `ssh_data` (`parent_host_id`);--> statement-breakpoint
CREATE INDEX `idx_ssh_data_credential` ON `ssh_data` (`credential_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user_id` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires_at` ON `sessions` (`expires_at`);