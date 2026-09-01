CREATE TABLE `ai_conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`provider_id` integer,
	`model` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ai_conversations_user` ON `ai_conversations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`tool_calls` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ai_messages_conversation` ON `ai_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`summary` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`applied_at` text,
	`result_summary` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ai_proposals_user` ON `ai_proposals` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_ai_proposals_conversation` ON `ai_proposals` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `ai_providers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`provider_type` text NOT NULL,
	`label` text NOT NULL,
	`base_url` text,
	`api_key` text(8192),
	`api_key_prefix` text,
	`default_model` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ai_providers_user_label` ON `ai_providers` (`user_id`,`label`);--> statement-breakpoint
CREATE TABLE `automation_channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`automation_id` integer NOT NULL,
	`channel_id` integer NOT NULL,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `notification_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_automation_channels_pair` ON `automation_channels` (`automation_id`,`channel_id`);--> statement-breakpoint
CREATE TABLE `automation_run_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`step_index` integer NOT NULL,
	`step_id` text NOT NULL,
	`step_type` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`finished_at` text,
	`output` text,
	`error` text,
	`truncated` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `automation_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_automation_run_steps_run` ON `automation_run_steps` (`run_id`,`step_index`);--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`automation_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`trigger_type` text NOT NULL,
	`trigger_context` text,
	`status` text NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`finished_at` text,
	`duration_ms` integer,
	`error` text,
	`dry_run` integer DEFAULT false NOT NULL,
	`parent_run_id` integer,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_automation_runs_automation` ON `automation_runs` (`automation_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_user` ON `automation_runs` (`user_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `automation_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`automation_id` integer NOT NULL,
	`cron` text,
	`interval_seconds` integer,
	`timezone` text,
	`next_due_at` text,
	`last_tick_at` text,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_automation_schedules_automation` ON `automation_schedules` (`automation_id`);--> statement-breakpoint
CREATE INDEX `idx_automation_schedules_due` ON `automation_schedules` (`next_due_at`);--> statement-breakpoint
CREATE TABLE `automation_trigger_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`automation_id` integer NOT NULL,
	`state_key` text NOT NULL,
	`breach_started_at` text,
	`last_fired_at` text,
	`last_value` real,
	`last_observed_state` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_automation_trigger_state_key` ON `automation_trigger_state` (`automation_id`,`state_key`);--> statement-breakpoint
CREATE TABLE `automations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`definition` text NOT NULL,
	`definition_version` integer DEFAULT 1 NOT NULL,
	`concurrency_policy` text DEFAULT 'skip' NOT NULL,
	`max_run_seconds` integer DEFAULT 300 NOT NULL,
	`dry_run` integer DEFAULT false NOT NULL,
	`last_run_at` text,
	`last_run_status` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_automations_user` ON `automations` (`user_id`,`enabled`);--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `ai_assistant_enabled` integer;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `ai_read_only_commands` integer;