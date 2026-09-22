CREATE TABLE `plugin_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plugin_id` text NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text,
	`key` text NOT NULL,
	`value` text,
	`encrypted` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_settings_scope_key` ON `plugin_settings` (`plugin_id`,`scope`,`scope_id`,`key`);--> statement-breakpoint
CREATE INDEX `idx_plugin_settings_plugin_scope` ON `plugin_settings` (`plugin_id`,`scope`);