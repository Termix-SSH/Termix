PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_shared_credential_secrets` (
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
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `ssh_credentials`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_access_id`) REFERENCES `credential_access`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_shared_credential_secrets`("id", "credential_access_id", "target_user_id", "credential_id", "encrypted_username", "auth_type", "encrypted_password", "encrypted_key", "encrypted_key_password", "key_type", "public_key", "cert_public_key", "created_at", "updated_at") SELECT "id", "credential_access_id", "target_user_id", "credential_id", "encrypted_username", "auth_type", "encrypted_password", "encrypted_key", "encrypted_key_password", "key_type", "public_key", "cert_public_key", "created_at", "updated_at" FROM `shared_credential_secrets`;--> statement-breakpoint
DROP TABLE `shared_credential_secrets`;--> statement-breakpoint
ALTER TABLE `__new_shared_credential_secrets` RENAME TO `shared_credential_secrets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shared_credential_secrets_scope` ON `shared_credential_secrets` (`credential_access_id`,`target_user_id`);--> statement-breakpoint
CREATE INDEX `idx_shared_credential_secrets_target` ON `shared_credential_secrets` (`target_user_id`,`credential_id`);