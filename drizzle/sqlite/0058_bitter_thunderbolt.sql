-- The RDP, VNC and Telnet logins moved out of ssh_data into host_protocol_auth.
-- A boot migration copies them after this runs, so the old ssh_data columns
-- are not dropped here; they stay in place, unused, until 3.0.0.
CREATE TABLE `host_protocol_auth` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`protocol` text NOT NULL,
	`auth_type` text DEFAULT 'direct' NOT NULL,
	`credential_id` integer,
	`username` text,
	`password` text,
	`fields` text,
	`secret_fields` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `ssh_credentials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_host_protocol_auth_host_protocol` ON `host_protocol_auth` (`host_id`,`protocol`);--> statement-breakpoint
CREATE INDEX `idx_host_protocol_auth_user` ON `host_protocol_auth` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_host_protocol_auth_credential` ON `host_protocol_auth` (`credential_id`);--> statement-breakpoint
ALTER TABLE `shared_host_secrets` ADD `encrypted_fields` text;