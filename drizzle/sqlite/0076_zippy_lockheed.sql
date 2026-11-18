CREATE TABLE `admin_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`summary` text NOT NULL,
	`requested_by` text,
	`requested_by_name` text NOT NULL,
	`requested_at` text NOT NULL,
	`runs_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`error` text,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_admin_holds_status_runs` ON `admin_holds` (`status`,`runs_at`);--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `prev_hash` text;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `hash` text;