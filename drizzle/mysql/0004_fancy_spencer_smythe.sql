CREATE TABLE `proxmox_node_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`host_id` int NOT NULL,
	`ts` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`cpu_percent` double,
	`mem_percent` double,
	`disk_percent` double,
	`net_rx_bytes` int,
	`net_tx_bytes` int,
	CONSTRAINT `proxmox_node_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `proxmox_stats_preferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`host_id` int NOT NULL,
	`layout` text NOT NULL,
	`created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `proxmox_stats_preferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_proxmox_stats_prefs_user_host` UNIQUE(`user_id`,`host_id`)
);
--> statement-breakpoint
ALTER TABLE `ssh_data` ADD `enable_proxmox_stats` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ssh_data` ADD `proxmox_stats_config` text;--> statement-breakpoint
ALTER TABLE `proxmox_node_history` ADD CONSTRAINT `proxmox_node_history_host_id_ssh_data_id_fk` FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `proxmox_stats_preferences` ADD CONSTRAINT `proxmox_stats_preferences_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `proxmox_stats_preferences` ADD CONSTRAINT `proxmox_stats_preferences_host_id_ssh_data_id_fk` FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON DELETE cascade ON UPDATE no action;