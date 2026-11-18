CREATE TABLE `frame_registrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`client` varchar(255) NOT NULL,
	`plugin_id` varchar(255) NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `frame_registrations_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_frame_registrations_user_client_plugin` UNIQUE(`user_id`,`client`,`plugin_id`)
);
--> statement-breakpoint
ALTER TABLE `frame_registrations` ADD CONSTRAINT `frame_registrations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;