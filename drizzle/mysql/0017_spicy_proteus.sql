CREATE TABLE `secret_sources` (
	`id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`kind` text NOT NULL DEFAULT ('onepassword-connect'),
	`base_url` text NOT NULL,
	`token` text NOT NULL,
	`shared` boolean NOT NULL DEFAULT false,
	`created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `secret_sources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `secret_sources` ADD CONSTRAINT `secret_sources_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_secret_sources_user` ON `secret_sources` (`user_id`);