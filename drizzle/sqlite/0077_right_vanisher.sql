CREATE TABLE `user_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`note` text,
	`role_ids` text,
	`make_admin` integer DEFAULT false NOT NULL,
	`max_uses` integer DEFAULT 1 NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_invites_token_hash` ON `user_invites` (`token_hash`);--> statement-breakpoint
ALTER TABLE `users` ADD `display_name` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `disabled_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `disabled_reason` text;--> statement-breakpoint
ALTER TABLE `users` ADD `last_login_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);