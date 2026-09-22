ALTER TABLE `plugin_permission_grants` MODIFY COLUMN `granted_by` varchar(255);--> statement-breakpoint
ALTER TABLE `plugin_permission_grants` ADD `source` text DEFAULT ('admin') NOT NULL;--> statement-breakpoint
ALTER TABLE `plugins` ADD `last_error` text;