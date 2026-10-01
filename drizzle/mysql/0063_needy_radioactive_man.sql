-- The RDP, VNC and Telnet logins moved out of ssh_data into host_protocol_auth.
-- A boot migration copies them after this runs, so the old ssh_data columns
-- and their foreign keys stay in place, unused, until 3.0.0.
CREATE TABLE `host_protocol_auth` (
	`id` int AUTO_INCREMENT NOT NULL,
	`host_id` int NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`protocol` varchar(255) NOT NULL,
	`auth_type` text NOT NULL DEFAULT ('direct'),
	`credential_id` int,
	`username` text,
	`password` text,
	`fields` text,
	`secret_fields` text,
	`created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `host_protocol_auth_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_host_protocol_auth_host_protocol` UNIQUE(`host_id`,`protocol`)
);
--> statement-breakpoint
ALTER TABLE `shared_host_secrets` ADD `encrypted_fields` text;--> statement-breakpoint
ALTER TABLE `host_protocol_auth` ADD CONSTRAINT `host_protocol_auth_host_id_ssh_data_id_fk` FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `host_protocol_auth` ADD CONSTRAINT `host_protocol_auth_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `host_protocol_auth` ADD CONSTRAINT `host_protocol_auth_credential_id_ssh_credentials_id_fk` FOREIGN KEY (`credential_id`) REFERENCES `ssh_credentials`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_host_protocol_auth_user` ON `host_protocol_auth` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_host_protocol_auth_credential` ON `host_protocol_auth` (`credential_id`);
