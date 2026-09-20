CREATE TABLE `plugin_install_counts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plugin_id` text NOT NULL,
	`registry_id` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'aggregate-telemetry' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_install_counts_plugin_registry` ON `plugin_install_counts` (`plugin_id`,`registry_id`);--> statement-breakpoint
CREATE TABLE `plugin_permission_grants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plugin_id` text NOT NULL,
	`capability` text NOT NULL,
	`granted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`granted_by` text NOT NULL,
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_permission_grants_plugin_capability` ON `plugin_permission_grants` (`plugin_id`,`capability`);--> statement-breakpoint
CREATE TABLE `plugin_registries` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`kind` text DEFAULT 'community' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`signing_key` text,
	`last_checked_at` text,
	`last_index_hash` text
);
--> statement-breakpoint
CREATE TABLE `plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`tier` text DEFAULT 'available' NOT NULL,
	`source` text DEFAULT 'community' NOT NULL,
	`registry_id` text,
	`state` text DEFAULT 'disabled' NOT NULL,
	`installed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`auto_update` integer DEFAULT false NOT NULL,
	`manifest_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_plugins_registry_id` ON `plugins` (`registry_id`);