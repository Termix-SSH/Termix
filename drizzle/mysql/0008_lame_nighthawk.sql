CREATE TABLE `user_workspaces` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`color` text,
	`icon` text,
	`kind` text NOT NULL DEFAULT ('manual'),
	`is_default` boolean NOT NULL DEFAULT false,
	`payload` text NOT NULL DEFAULT ('{}'),
	`sync_id` varchar(255),
	`created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`last_used_at` text,
	CONSTRAINT `user_workspaces_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_workspaces_sync_id_unique` UNIQUE(`sync_id`)
);
--> statement-breakpoint
ALTER TABLE `user_workspaces` ADD CONSTRAINT `user_workspaces_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;