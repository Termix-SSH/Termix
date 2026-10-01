CREATE TABLE `plugin_storage` (
	`id` int AUTO_INCREMENT NOT NULL,
	`plugin_id` varchar(255) NOT NULL,
	`key` varchar(255) NOT NULL,
	`value` text NOT NULL,
	`updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `plugin_storage_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_plugin_storage_plugin_key` UNIQUE(`plugin_id`,`key`)
);
--> statement-breakpoint
ALTER TABLE `plugin_storage` ADD CONSTRAINT `plugin_storage_plugin_id_plugins_id_fk` FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON DELETE cascade ON UPDATE no action;