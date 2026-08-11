CREATE TABLE `proxmox_node_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_id` integer NOT NULL,
	`ts` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`cpu_percent` real,
	`mem_percent` real,
	`disk_percent` real,
	`net_rx_bytes` integer,
	`net_tx_bytes` integer,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `proxmox_stats_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`host_id` integer NOT NULL,
	`layout` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_proxmox_stats_prefs_user_host` ON `proxmox_stats_preferences` (`user_id`,`host_id`);--> statement-breakpoint
ALTER TABLE `ssh_data` ADD `enable_proxmox_stats` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ssh_data` ADD `proxmox_stats_config` text;