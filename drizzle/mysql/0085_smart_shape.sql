CREATE TABLE `sync_pending_host_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`host_id` int NOT NULL,
	`plugin_id` varchar(255) NOT NULL,
	`settings` text NOT NULL,
	`updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `sync_pending_host_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_sync_pending_host_settings_host_plugin` UNIQUE(`host_id`,`plugin_id`)
);
--> statement-breakpoint
ALTER TABLE `sync_pending_host_settings` ADD CONSTRAINT `sync_pending_host_settings_host_id_ssh_data_id_fk` FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON DELETE cascade ON UPDATE no action;