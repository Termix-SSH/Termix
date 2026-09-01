CREATE TABLE `fleet_inventory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`host_id` int NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`os_pretty_name` text,
	`kernel` text,
	`architecture` text,
	`hostname` text,
	`uptime_seconds` int,
	`ip` text,
	`package_manager` text,
	`collected_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `fleet_inventory_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_fleet_inventory_host` UNIQUE(`host_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `fleet_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fleet_id` int NOT NULL,
	`host_id` int NOT NULL,
	`added_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `fleet_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_fleet_members_fleet_host` UNIQUE(`fleet_id`,`host_id`)
);
--> statement-breakpoint
CREATE TABLE `fleets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`color` text,
	`icon` text,
	`tag_rules` text,
	`sync_id` varchar(255),
	`created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `fleets_id` PRIMARY KEY(`id`),
	CONSTRAINT `fleets_sync_id_unique` UNIQUE(`sync_id`)
);
--> statement-breakpoint
ALTER TABLE `fleet_inventory` ADD CONSTRAINT `fleet_inventory_host_id_ssh_data_id_fk` FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fleet_inventory` ADD CONSTRAINT `fleet_inventory_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fleet_members` ADD CONSTRAINT `fleet_members_fleet_id_fleets_id_fk` FOREIGN KEY (`fleet_id`) REFERENCES `fleets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fleet_members` ADD CONSTRAINT `fleet_members_host_id_ssh_data_id_fk` FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fleets` ADD CONSTRAINT `fleets_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;