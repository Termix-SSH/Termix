CREATE TABLE `fleet_inventory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`os_pretty_name` text,
	`kernel` text,
	`architecture` text,
	`hostname` text,
	`uptime_seconds` integer,
	`ip` text,
	`package_manager` text,
	`collected_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fleet_inventory_host` ON `fleet_inventory` (`host_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `fleet_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fleet_id` integer NOT NULL,
	`host_id` integer NOT NULL,
	`added_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`fleet_id`) REFERENCES `fleets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fleet_members_fleet_host` ON `fleet_members` (`fleet_id`,`host_id`);--> statement-breakpoint
CREATE TABLE `fleets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text,
	`icon` text,
	`tag_rules` text,
	`sync_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fleets_sync_id_unique` ON `fleets` (`sync_id`);