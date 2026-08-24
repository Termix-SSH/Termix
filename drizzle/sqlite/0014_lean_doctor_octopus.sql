CREATE TABLE `credential_access` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`credential_id` integer NOT NULL,
	`user_id` text,
	`role_id` integer,
	`granted_by` text NOT NULL,
	`permission_level` text DEFAULT 'use' NOT NULL,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`credential_id`) REFERENCES `ssh_credentials`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_credential_access_user_id` ON `credential_access` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_credential_access_role_id` ON `credential_access` (`role_id`);--> statement-breakpoint
CREATE INDEX `idx_credential_access_credential_id` ON `credential_access` (`credential_id`);--> statement-breakpoint
CREATE TABLE `shared_credential_secrets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`credential_access_id` integer NOT NULL,
	`target_user_id` text NOT NULL,
	`credential_id` integer NOT NULL,
	`encrypted_username` text,
	`auth_type` text DEFAULT 'password' NOT NULL,
	`encrypted_password` text,
	`encrypted_key` text(16384),
	`encrypted_key_password` text,
	`key_type` text,
	`public_key` text(4096),
	`cert_public_key` text(8192),
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`credential_access_id`) REFERENCES `credential_access`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `ssh_credentials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shared_credential_secrets_scope` ON `shared_credential_secrets` (`credential_access_id`,`target_user_id`);--> statement-breakpoint
CREATE INDEX `idx_shared_credential_secrets_target` ON `shared_credential_secrets` (`target_user_id`,`credential_id`);