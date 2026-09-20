CREATE TABLE `plugin_install_counts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`plugin_id` varchar(255) NOT NULL,
	`registry_id` varchar(255) NOT NULL,
	`count` int NOT NULL DEFAULT 0,
	`source` text NOT NULL DEFAULT ('aggregate-telemetry'),
	`updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `plugin_install_counts_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_plugin_install_counts_plugin_registry` UNIQUE(`plugin_id`,`registry_id`)
);
--> statement-breakpoint
CREATE TABLE `plugin_permission_grants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`plugin_id` varchar(255) NOT NULL,
	`capability` varchar(255) NOT NULL,
	`granted_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`granted_by` varchar(255) NOT NULL,
	CONSTRAINT `plugin_permission_grants_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_plugin_permission_grants_plugin_capability` UNIQUE(`plugin_id`,`capability`)
);
--> statement-breakpoint
CREATE TABLE `plugin_registries` (
	`id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`url` text NOT NULL,
	`kind` text NOT NULL DEFAULT ('community'),
	`enabled` boolean NOT NULL DEFAULT true,
	`signing_key` text,
	`last_checked_at` text,
	`last_index_hash` text,
	CONSTRAINT `plugin_registries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `plugins` (
	`id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`version` text NOT NULL,
	`tier` text NOT NULL DEFAULT ('available'),
	`source` text NOT NULL DEFAULT ('community'),
	`registry_id` varchar(255),
	`state` text NOT NULL DEFAULT ('disabled'),
	`installed_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`auto_update` boolean NOT NULL DEFAULT false,
	`manifest_json` text NOT NULL,
	CONSTRAINT `plugins_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `plugin_permission_grants` ADD CONSTRAINT `plugin_permission_grants_plugin_id_plugins_id_fk` FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `plugin_permission_grants` ADD CONSTRAINT `plugin_permission_grants_granted_by_users_id_fk` FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_plugins_registry_id` ON `plugins` (`registry_id`);