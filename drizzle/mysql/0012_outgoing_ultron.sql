CREATE TABLE `ai_conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`title` text,
	`provider_id` int,
	`model` text,
	`created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `ai_conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversation_id` int NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL DEFAULT (''),
	`tool_calls` text,
	`created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `ai_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_proposals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversation_id` int NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`kind` text NOT NULL,
	`summary` text,
	`payload` text NOT NULL DEFAULT ('{}'),
	`status` varchar(255) NOT NULL DEFAULT 'pending',
	`applied_at` text,
	`result_summary` text,
	`created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `ai_proposals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_providers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`provider_type` text NOT NULL,
	`label` varchar(255) NOT NULL,
	`base_url` text,
	`api_key` text,
	`api_key_prefix` text,
	`default_model` text,
	`enabled` boolean NOT NULL DEFAULT true,
	`created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `ai_providers_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_ai_providers_user_label` UNIQUE(`user_id`,`label`)
);
--> statement-breakpoint
CREATE TABLE `automation_channels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`automation_id` int NOT NULL,
	`channel_id` int NOT NULL,
	CONSTRAINT `automation_channels_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_automation_channels_pair` UNIQUE(`automation_id`,`channel_id`)
);
--> statement-breakpoint
CREATE TABLE `automation_run_steps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`run_id` int NOT NULL,
	`step_index` int NOT NULL,
	`step_id` text NOT NULL,
	`step_type` text NOT NULL,
	`status` varchar(255) NOT NULL,
	`started_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`finished_at` text,
	`output` text,
	`error` text,
	`truncated` boolean NOT NULL DEFAULT false,
	CONSTRAINT `automation_run_steps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`automation_id` int NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`trigger_type` text NOT NULL,
	`trigger_context` text,
	`status` varchar(255) NOT NULL,
	`started_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`finished_at` text,
	`duration_ms` int,
	`error` text,
	`dry_run` boolean NOT NULL DEFAULT false,
	`parent_run_id` int,
	CONSTRAINT `automation_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `automation_schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`automation_id` int NOT NULL,
	`cron` text,
	`interval_seconds` int,
	`timezone` text,
	`next_due_at` varchar(255),
	`last_tick_at` text,
	CONSTRAINT `automation_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_automation_schedules_automation` UNIQUE(`automation_id`)
);
--> statement-breakpoint
CREATE TABLE `automation_trigger_state` (
	`id` int AUTO_INCREMENT NOT NULL,
	`automation_id` int NOT NULL,
	`state_key` varchar(255) NOT NULL,
	`breach_started_at` text,
	`last_fired_at` text,
	`last_value` double,
	`last_observed_state` text,
	`updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `automation_trigger_state_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_automation_trigger_state_key` UNIQUE(`automation_id`,`state_key`)
);
--> statement-breakpoint
CREATE TABLE `automations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`enabled` boolean NOT NULL DEFAULT true,
	`definition` text NOT NULL,
	`definition_version` int NOT NULL DEFAULT 1,
	`concurrency_policy` text NOT NULL DEFAULT ('skip'),
	`max_run_seconds` int NOT NULL DEFAULT 300,
	`dry_run` boolean NOT NULL DEFAULT false,
	`last_run_at` text,
	`last_run_status` text,
	`created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `automations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `alert_rules` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `alert_rules` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `api_keys` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `c2s_tunnel_presets` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `c2s_tunnel_presets` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `credential_sidebar_preferences` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `dashboard_service_links` MODIFY COLUMN `label` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `dashboard_service_links` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `dashboard_service_links` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `file_manager_shortcuts` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `fleets` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `fleets` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `homepage_items` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `homepage_items` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `homepage_layouts` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `host_access` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `host_health_checks` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `host_health_checks` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `host_metrics_preferences` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `host_metrics_preferences` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `host_sidebar_preferences` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `ssh_data` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `ssh_data` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `network_topology` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `network_topology` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `notification_channels` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `opkssh_tokens` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `proxmox_stats_preferences` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `proxmox_stats_preferences` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `roles` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `roles` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `session_shares` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `sessions` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `shared_host_auth_overrides` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `shared_host_auth_overrides` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `shared_host_secrets` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `shared_host_secrets` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `snippet_access` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `snippet_folders` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `snippet_folders` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `snippets` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `snippets` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `ssh_credentials` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `ssh_credentials` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `ssh_folders` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `ssh_folders` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `sso_providers` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `sso_providers` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `termix_identities` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `termix_identities` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `termix_identity_ca` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `termix_identity_ca` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `termix_identity_keys` MODIFY COLUMN `label` varchar(255);--> statement-breakpoint
ALTER TABLE `termix_identity_keys` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `tmux_session_tags` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `trusted_devices` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `ui_preferences` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `user_open_tabs` MODIFY COLUMN `label` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `user_open_tabs` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `user_open_tabs` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `user_preferences` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `user_workspaces` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `user_workspaces` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `vault_profiles` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `vault_profiles` MODIFY COLUMN `updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `vault_tokens` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `webauthn_credentials` MODIFY COLUMN `created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP);--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `ai_assistant_enabled` boolean;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `ai_read_only_commands` boolean;--> statement-breakpoint
ALTER TABLE `ai_conversations` ADD CONSTRAINT `ai_conversations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_messages` ADD CONSTRAINT `ai_messages_conversation_id_ai_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_proposals` ADD CONSTRAINT `ai_proposals_conversation_id_ai_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_proposals` ADD CONSTRAINT `ai_proposals_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_providers` ADD CONSTRAINT `ai_providers_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automation_channels` ADD CONSTRAINT `automation_channels_automation_id_automations_id_fk` FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automation_channels` ADD CONSTRAINT `automation_channels_channel_id_notification_channels_id_fk` FOREIGN KEY (`channel_id`) REFERENCES `notification_channels`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automation_run_steps` ADD CONSTRAINT `automation_run_steps_run_id_automation_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `automation_runs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automation_runs` ADD CONSTRAINT `automation_runs_automation_id_automations_id_fk` FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automation_runs` ADD CONSTRAINT `automation_runs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automation_schedules` ADD CONSTRAINT `automation_schedules_automation_id_automations_id_fk` FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automation_trigger_state` ADD CONSTRAINT `automation_trigger_state_automation_id_automations_id_fk` FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automations` ADD CONSTRAINT `automations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_ai_conversations_user` ON `ai_conversations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_messages_conversation` ON `ai_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_proposals_user` ON `ai_proposals` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_ai_proposals_conversation` ON `ai_proposals` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_automation_run_steps_run` ON `automation_run_steps` (`run_id`,`step_index`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_automation` ON `automation_runs` (`automation_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_user` ON `automation_runs` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_automation_schedules_due` ON `automation_schedules` (`next_due_at`);--> statement-breakpoint
CREATE INDEX `idx_automations_user` ON `automations` (`user_id`,`enabled`);