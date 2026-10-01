PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_plugin_permission_grants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plugin_id` text NOT NULL,
	`capability` text NOT NULL,
	`granted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`granted_by` text,
	`source` text DEFAULT 'admin' NOT NULL,
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_plugin_permission_grants`("id", "plugin_id", "capability", "granted_at", "granted_by", "source") SELECT "id", "plugin_id", "capability", "granted_at", "granted_by", 'admin' FROM `plugin_permission_grants`;--> statement-breakpoint
DROP TABLE `plugin_permission_grants`;--> statement-breakpoint
ALTER TABLE `__new_plugin_permission_grants` RENAME TO `plugin_permission_grants`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_permission_grants_plugin_capability` ON `plugin_permission_grants` (`plugin_id`,`capability`);--> statement-breakpoint
ALTER TABLE `plugins` ADD `last_error` text;