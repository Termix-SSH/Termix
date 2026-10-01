CREATE TABLE `rbac_applied_defaults` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role_name` text NOT NULL,
	`permission` text NOT NULL,
	`applied_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rbac_applied_defaults_role_permission` ON `rbac_applied_defaults` (`role_name`,`permission`);--> statement-breakpoint
CREATE TABLE `rbac_known_permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`permission` text NOT NULL,
	`plugin_id` text,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rbac_known_permissions_permission` ON `rbac_known_permissions` (`permission`);