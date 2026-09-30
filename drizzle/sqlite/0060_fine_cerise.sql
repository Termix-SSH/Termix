CREATE TABLE `host_defaults` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`level` text NOT NULL,
	`scope_key` text NOT NULL,
	`user_id` text,
	`folder_id` integer,
	`namespace` text NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`updated_by` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `ssh_folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_host_defaults_scope_key` ON `host_defaults` (`scope_key`,`namespace`,`key`);--> statement-breakpoint
CREATE INDEX `idx_host_defaults_user` ON `host_defaults` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_host_defaults_folder` ON `host_defaults` (`folder_id`);--> statement-breakpoint
ALTER TABLE `ssh_data` ADD `default_overrides` text;