CREATE TABLE `folder_access` (
	`id` int AUTO_INCREMENT NOT NULL,
	`owner_user_id` varchar(255) NOT NULL,
	`folder` varchar(255) NOT NULL,
	`user_id` varchar(255),
	`role_id` int,
	`granted_by` varchar(255) NOT NULL,
	`permission_level` text NOT NULL DEFAULT ('connect'),
	`expires_at` varchar(255),
	`created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `folder_access_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `ssh_data` MODIFY COLUMN `folder` varchar(255);--> statement-breakpoint
ALTER TABLE `snippets` MODIFY COLUMN `folder` varchar(255);--> statement-breakpoint
ALTER TABLE `ssh_credentials` MODIFY COLUMN `folder` varchar(255);--> statement-breakpoint
ALTER TABLE `vault_profiles` MODIFY COLUMN `folder` varchar(255);--> statement-breakpoint
ALTER TABLE `folder_access` ADD CONSTRAINT `folder_access_owner_user_id_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `folder_access` ADD CONSTRAINT `folder_access_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `folder_access` ADD CONSTRAINT `folder_access_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `folder_access` ADD CONSTRAINT `folder_access_granted_by_users_id_fk` FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_folder_access_owner_folder` ON `folder_access` (`owner_user_id`,`folder`);
