CREATE TABLE `sync_conflicts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`sync_id` text NOT NULL,
	`local_row` text NOT NULL,
	`server_revision` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sync_conflicts_user` ON `sync_conflicts` (`user_id`);--> statement-breakpoint
CREATE TABLE `sync_link` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`server_url` text NOT NULL,
	`server_name` text,
	`server_version` text,
	`session_token` text,
	`custom_headers` text,
	`basic_auth` text,
	`allow_invalid_certificate` integer DEFAULT false NOT NULL,
	`remote_user_id` text,
	`remote_username` text,
	`account` text,
	`scope` text,
	`known_types` text,
	`cursor` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`last_error` text,
	`linked_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_sync_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sync_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`sync_id` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`hash` text,
	`deleted` integer DEFAULT false NOT NULL,
	`error` text,
	`error_hash` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sync_records_user_entity_sync` ON `sync_records` (`user_id`,`entity_type`,`sync_id`);--> statement-breakpoint
CREATE INDEX `idx_sync_records_user_seq` ON `sync_records` (`user_id`,`seq`);--> statement-breakpoint
ALTER TABLE `ssh_data` ADD `local_only` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ssh_data` ADD `shared_source` text;--> statement-breakpoint
ALTER TABLE `ssh_credentials` ADD `shared_source` text;--> statement-breakpoint
ALTER TABLE `ssh_folders` ADD `local_only` integer DEFAULT false NOT NULL;