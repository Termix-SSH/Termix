CREATE TABLE `collab_room_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`room_role` text DEFAULT 'member' NOT NULL,
	`added_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `collab_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_collab_room_members_room_user` ON `collab_room_members` (`room_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_collab_room_members_user` ON `collab_room_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `collab_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`persistent` integer DEFAULT false NOT NULL,
	`presenter_user_id` text,
	`stage_protocol` text,
	`stage_host_id` integer,
	`stage_share_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`presenter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`stage_host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`stage_share_id`) REFERENCES `session_shares`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_collab_rooms_owner` ON `collab_rooms` (`owner_user_id`);