CREATE TABLE `shared_folder_auth_overrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`folder` varchar(255) NOT NULL,
	`protocol` varchar(255) NOT NULL DEFAULT 'ssh',
	`credential_id` int NOT NULL,
	`created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `shared_folder_auth_overrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `shared_folder_auth_overrides_user_folder_protocol_unique` UNIQUE(`user_id`,`folder`,`protocol`)
);
--> statement-breakpoint
ALTER TABLE `shared_folder_auth_overrides` ADD CONSTRAINT `shared_folder_auth_overrides_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shared_folder_auth_overrides` ADD CONSTRAINT `shared_folder_auth_overrides_credential_id_ssh_credentials_id_fk` FOREIGN KEY (`credential_id`) REFERENCES `ssh_credentials`(`id`) ON DELETE cascade ON UPDATE no action;