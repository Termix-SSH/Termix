CREATE TABLE `rbac_applied_defaults` (
	`id` int AUTO_INCREMENT NOT NULL,
	`role_name` varchar(255) NOT NULL,
	`permission` varchar(255) NOT NULL,
	`applied_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `rbac_applied_defaults_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_rbac_applied_defaults_role_permission` UNIQUE(`role_name`,`permission`)
);
--> statement-breakpoint
CREATE TABLE `rbac_known_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`permission` varchar(255) NOT NULL,
	`plugin_id` varchar(255),
	`first_seen_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `rbac_known_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_rbac_known_permissions_permission` UNIQUE(`permission`)
);
