CREATE TABLE `host_defaults` (
	`id` int AUTO_INCREMENT NOT NULL,
	`level` enum('admin','user','folder') NOT NULL,
	`scope_key` varchar(255) NOT NULL,
	`user_id` varchar(255),
	`folder_id` int,
	`namespace` varchar(255) NOT NULL,
	`key` varchar(255) NOT NULL,
	`value` text,
	`updated_by` text,
	`updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `host_defaults_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_host_defaults_scope_key` UNIQUE(`scope_key`,`namespace`,`key`)
);
--> statement-breakpoint
ALTER TABLE `ssh_data` ADD `default_overrides` text;--> statement-breakpoint
ALTER TABLE `host_defaults` ADD CONSTRAINT `host_defaults_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `host_defaults` ADD CONSTRAINT `host_defaults_folder_id_ssh_folders_id_fk` FOREIGN KEY (`folder_id`) REFERENCES `ssh_folders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_host_defaults_user` ON `host_defaults` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_host_defaults_folder` ON `host_defaults` (`folder_id`);