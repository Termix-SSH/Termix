CREATE TABLE `plugin_migrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`plugin_id` varchar(255) NOT NULL,
	`migration_id` varchar(255) NOT NULL,
	`checksum` text NOT NULL,
	`applied_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `plugin_migrations_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_plugin_migrations_plugin_migration` UNIQUE(`plugin_id`,`migration_id`)
);
--> statement-breakpoint
ALTER TABLE `plugin_migrations` ADD CONSTRAINT `plugin_migrations_plugin_id_plugins_id_fk` FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON DELETE cascade ON UPDATE no action;