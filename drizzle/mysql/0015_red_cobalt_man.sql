CREATE TABLE `collab_room_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`room_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`room_role` text NOT NULL DEFAULT ('member'),
	`added_by` varchar(255),
	`created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `collab_room_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_collab_room_members_room_user` UNIQUE(`room_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `collab_rooms` (
	`id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`owner_user_id` varchar(255) NOT NULL,
	`persistent` boolean NOT NULL DEFAULT false,
	`presenter_user_id` varchar(255),
	`stage_protocol` text,
	`stage_host_id` int,
	`stage_share_id` varchar(255),
	`created_at` varchar(255) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`ended_at` text,
	CONSTRAINT `collab_rooms_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `collab_room_members` ADD CONSTRAINT `collab_room_members_room_id_collab_rooms_id_fk` FOREIGN KEY (`room_id`) REFERENCES `collab_rooms`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `collab_room_members` ADD CONSTRAINT `collab_room_members_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `collab_room_members` ADD CONSTRAINT `collab_room_members_added_by_users_id_fk` FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `collab_rooms` ADD CONSTRAINT `collab_rooms_owner_user_id_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `collab_rooms` ADD CONSTRAINT `collab_rooms_presenter_user_id_users_id_fk` FOREIGN KEY (`presenter_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `collab_rooms` ADD CONSTRAINT `collab_rooms_stage_host_id_ssh_data_id_fk` FOREIGN KEY (`stage_host_id`) REFERENCES `ssh_data`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `collab_rooms` ADD CONSTRAINT `collab_rooms_stage_share_id_session_shares_id_fk` FOREIGN KEY (`stage_share_id`) REFERENCES `session_shares`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_collab_room_members_user` ON `collab_room_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_collab_rooms_owner` ON `collab_rooms` (`owner_user_id`);