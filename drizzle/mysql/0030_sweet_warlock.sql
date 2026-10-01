CREATE TABLE `user_external_identities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`provider_id` varchar(255) NOT NULL,
	`subject` varchar(255) NOT NULL,
	`email` text,
	`created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `user_external_identities_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_user_external_identities_provider_subject` UNIQUE(`provider_id`,`subject`)
);
--> statement-breakpoint
CREATE TABLE `user_second_factors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`plugin_id` varchar(255) NOT NULL,
	`factor_id` varchar(255) NOT NULL,
	`enrolled_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `user_second_factors_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_user_second_factors_user_factor` UNIQUE(`user_id`,`plugin_id`,`factor_id`)
);
--> statement-breakpoint
ALTER TABLE `user_external_identities` ADD CONSTRAINT `user_external_identities_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_second_factors` ADD CONSTRAINT `user_second_factors_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_user_external_identities_user` ON `user_external_identities` (`user_id`);