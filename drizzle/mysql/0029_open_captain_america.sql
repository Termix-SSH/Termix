CREATE TABLE `plugin_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`plugin_id` varchar(255) NOT NULL,
	`scope` varchar(255) NOT NULL,
	`scope_id` varchar(255),
	`key` varchar(255) NOT NULL,
	`value` text,
	`encrypted` boolean NOT NULL DEFAULT false,
	`updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `plugin_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_plugin_settings_scope_key` UNIQUE(`plugin_id`,`scope`,`scope_id`,`key`)
);
--> statement-breakpoint
ALTER TABLE `plugin_settings` ADD CONSTRAINT `plugin_settings_plugin_id_plugins_id_fk` FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_plugin_settings_plugin_scope` ON `plugin_settings` (`plugin_id`,`scope`);