CREATE TABLE `operation_approvals` (
	`id` varchar(255) NOT NULL,
	`run_id` varchar(255) NOT NULL,
	`requested_by` text,
	`reason` text,
	`allow_self` boolean NOT NULL DEFAULT false,
	`status` varchar(255) NOT NULL,
	`decided_by` text,
	`comment` text,
	`created_at` text NOT NULL,
	`expires_at` varchar(255) NOT NULL,
	`decided_at` text,
	CONSTRAINT `operation_approvals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `operation_events` (
	`id` varchar(255) NOT NULL,
	`event_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`host_id` int,
	`severity` text,
	`payload` text,
	`run_id` text,
	`created_at` varchar(255) NOT NULL,
	CONSTRAINT `operation_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `operation_runs` (
	`id` varchar(255) NOT NULL,
	`action_id` text NOT NULL,
	`action_version` int NOT NULL DEFAULT 1,
	`plugin_id` text NOT NULL,
	`plugin_version` text NOT NULL,
	`user_id` varchar(255),
	`username` text NOT NULL,
	`origin` text NOT NULL,
	`host_id` int,
	`host_name` text,
	`batch_id` varchar(255),
	`dry_run` boolean NOT NULL DEFAULT false,
	`risk` text NOT NULL,
	`status` varchar(255) NOT NULL,
	`summary` text,
	`changed` boolean,
	`input` text,
	`sealed_input` text,
	`output` text,
	`undo_input` text,
	`error` text,
	`error_code` text,
	`undo_of` text,
	`idempotency_key` text,
	`created_at` varchar(255) NOT NULL,
	`started_at` text,
	`finished_at` text,
	CONSTRAINT `operation_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `api_keys` ADD `scopes` text;--> statement-breakpoint
ALTER TABLE `operation_approvals` ADD CONSTRAINT `operation_approvals_run_id_operation_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `operation_runs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operation_runs` ADD CONSTRAINT `operation_runs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_operation_approvals_status` ON `operation_approvals` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_operation_approvals_run` ON `operation_approvals` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_operation_events_created` ON `operation_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_operation_events_host_created` ON `operation_events` (`host_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_operation_runs_created` ON `operation_runs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_operation_runs_user_created` ON `operation_runs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_operation_runs_host_created` ON `operation_runs` (`host_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_operation_runs_status` ON `operation_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_operation_runs_batch` ON `operation_runs` (`batch_id`);