CREATE TABLE `shared_folder_auth_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`folder` text NOT NULL,
	`protocol` text DEFAULT 'ssh' NOT NULL,
	`credential_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `ssh_credentials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_folder_auth_overrides_user_folder_protocol_unique` ON `shared_folder_auth_overrides` (`user_id`,`folder`,`protocol`);