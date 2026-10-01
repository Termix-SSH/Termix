CREATE TABLE `user_external_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`subject` text NOT NULL,
	`email` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_external_identities_provider_subject` ON `user_external_identities` (`provider_id`,`subject`);--> statement-breakpoint
CREATE INDEX `idx_user_external_identities_user` ON `user_external_identities` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_second_factors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`factor_id` text NOT NULL,
	`enrolled_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_second_factors_user_factor` ON `user_second_factors` (`user_id`,`plugin_id`,`factor_id`);