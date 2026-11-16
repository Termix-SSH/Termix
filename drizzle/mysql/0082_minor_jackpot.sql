CREATE TABLE `user_invites` (
	`id` varchar(255) NOT NULL,
	`token_hash` varchar(255) NOT NULL,
	`note` text,
	`role_ids` text,
	`make_admin` boolean NOT NULL DEFAULT false,
	`max_uses` int NOT NULL DEFAULT 1,
	`uses` int NOT NULL DEFAULT 0,
	`created_by` varchar(255),
	`created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`expires_at` text NOT NULL,
	`revoked_at` text,
	CONSTRAINT `user_invites_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_user_invites_token_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `display_name` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `disabled_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `disabled_reason` text;--> statement-breakpoint
ALTER TABLE `users` ADD `last_login_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `idx_users_email` UNIQUE(`email`);--> statement-breakpoint
ALTER TABLE `user_invites` ADD CONSTRAINT `user_invites_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;