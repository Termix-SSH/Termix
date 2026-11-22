CREATE TABLE `sync_pending_host_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_id` integer NOT NULL,
	`plugin_id` text NOT NULL,
	`settings` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sync_pending_host_settings_host_plugin` ON `sync_pending_host_settings` (`host_id`,`plugin_id`);