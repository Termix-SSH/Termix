CREATE TABLE `plugin_storage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plugin_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_storage_plugin_key` ON `plugin_storage` (`plugin_id`,`key`);