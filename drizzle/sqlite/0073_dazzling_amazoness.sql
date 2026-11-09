CREATE TABLE `operation_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`requested_by` text,
	`reason` text,
	`allow_self` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`decided_by` text,
	`comment` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `operation_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_operation_approvals_status` ON `operation_approvals` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_operation_approvals_run` ON `operation_approvals` (`run_id`);--> statement-breakpoint
CREATE TABLE `operation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`host_id` integer,
	`severity` text,
	`payload` text,
	`run_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_operation_events_created` ON `operation_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_operation_events_host_created` ON `operation_events` (`host_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `operation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`action_version` integer DEFAULT 1 NOT NULL,
	`plugin_id` text NOT NULL,
	`plugin_version` text NOT NULL,
	`user_id` text,
	`username` text NOT NULL,
	`origin` text NOT NULL,
	`host_id` integer,
	`host_name` text,
	`batch_id` text,
	`dry_run` integer DEFAULT false NOT NULL,
	`risk` text NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`changed` integer,
	`input` text,
	`sealed_input` text,
	`output` text,
	`undo_input` text,
	`error` text,
	`error_code` text,
	`undo_of` text,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_operation_runs_created` ON `operation_runs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_operation_runs_user_created` ON `operation_runs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_operation_runs_host_created` ON `operation_runs` (`host_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_operation_runs_status` ON `operation_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_operation_runs_batch` ON `operation_runs` (`batch_id`);--> statement-breakpoint
ALTER TABLE `api_keys` ADD `scopes` text;