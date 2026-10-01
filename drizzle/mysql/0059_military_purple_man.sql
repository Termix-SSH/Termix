CREATE TABLE `sync_conflicts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`entity_type` text NOT NULL,
	`sync_id` text NOT NULL,
	`local_row` text NOT NULL,
	`server_revision` int NOT NULL,
	`created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `sync_conflicts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sync_link` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`server_url` text NOT NULL,
	`server_name` text,
	`server_version` text,
	`session_token` text,
	`custom_headers` text,
	`basic_auth` text,
	`allow_invalid_certificate` boolean NOT NULL DEFAULT false,
	`remote_user_id` text,
	`remote_username` text,
	`account` text,
	`scope` text,
	`known_types` text,
	`cursor` int NOT NULL DEFAULT 0,
	`status` text NOT NULL DEFAULT ('idle'),
	`last_error` text,
	`linked_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`last_sync_at` text,
	CONSTRAINT `sync_link_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sync_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`entity_type` varchar(255) NOT NULL,
	`sync_id` varchar(255) NOT NULL,
	`revision` int NOT NULL DEFAULT 0,
	`seq` int NOT NULL DEFAULT 0,
	`hash` text,
	`deleted` boolean NOT NULL DEFAULT false,
	`error` text,
	`error_hash` text,
	`updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `sync_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_sync_records_user_entity_sync` UNIQUE(`user_id`,`entity_type`,`sync_id`)
);
--> statement-breakpoint
ALTER TABLE `ssh_data` ADD `local_only` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ssh_data` ADD `shared_source` text;--> statement-breakpoint
ALTER TABLE `ssh_credentials` ADD `shared_source` text;--> statement-breakpoint
ALTER TABLE `ssh_folders` ADD `local_only` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_conflicts` ADD CONSTRAINT `sync_conflicts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sync_link` ADD CONSTRAINT `sync_link_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sync_records` ADD CONSTRAINT `sync_records_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_sync_conflicts_user` ON `sync_conflicts` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sync_records_user_seq` ON `sync_records` (`user_id`,`seq`);