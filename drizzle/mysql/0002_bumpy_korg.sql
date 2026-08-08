CREATE TABLE `credential_sidebar_preferences` (
	`user_id` varchar(255) NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `credential_sidebar_preferences_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
ALTER TABLE `ssh_credentials` ADD `pin` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ssh_credentials` ADD `sort_order` int;--> statement-breakpoint
ALTER TABLE `credential_sidebar_preferences` ADD CONSTRAINT `credential_sidebar_preferences_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;