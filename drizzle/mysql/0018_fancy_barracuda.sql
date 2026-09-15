CREATE TABLE `credential_access` (
	`id` int AUTO_INCREMENT NOT NULL,
	`credential_id` int NOT NULL,
	`user_id` varchar(255),
	`role_id` int,
	`granted_by` varchar(255) NOT NULL,
	`permission_level` text NOT NULL DEFAULT ('use'),
	`expires_at` varchar(255),
	`created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `credential_access_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shared_credential_secrets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`credential_access_id` int NOT NULL,
	`target_user_id` varchar(255) NOT NULL,
	`credential_id` int NOT NULL,
	`encrypted_username` text,
	`auth_type` text NOT NULL DEFAULT ('password'),
	`encrypted_password` text,
	`encrypted_key` text,
	`encrypted_key_password` text,
	`key_type` text,
	`public_key` text,
	`cert_public_key` text,
	`created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`updated_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `shared_credential_secrets_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_shared_credential_secrets_scope` UNIQUE(`credential_access_id`,`target_user_id`)
);
--> statement-breakpoint
ALTER TABLE `credential_access` ADD CONSTRAINT `credential_access_credential_id_ssh_credentials_id_fk` FOREIGN KEY (`credential_id`) REFERENCES `ssh_credentials`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credential_access` ADD CONSTRAINT `credential_access_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credential_access` ADD CONSTRAINT `credential_access_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credential_access` ADD CONSTRAINT `credential_access_granted_by_users_id_fk` FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shared_credential_secrets` ADD CONSTRAINT `shared_cred_secrets_access_id_fk` FOREIGN KEY (`credential_access_id`) REFERENCES `credential_access`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shared_credential_secrets` ADD CONSTRAINT `shared_credential_secrets_target_user_id_users_id_fk` FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shared_credential_secrets` ADD CONSTRAINT `shared_credential_secrets_credential_id_ssh_credentials_id_fk` FOREIGN KEY (`credential_id`) REFERENCES `ssh_credentials`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_credential_access_user_id` ON `credential_access` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_credential_access_role_id` ON `credential_access` (`role_id`);--> statement-breakpoint
CREATE INDEX `idx_credential_access_credential_id` ON `credential_access` (`credential_id`);--> statement-breakpoint
CREATE INDEX `idx_shared_credential_secrets_target` ON `shared_credential_secrets` (`target_user_id`,`credential_id`);
