CREATE TABLE `user_workspaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`icon` text,
	`kind` text DEFAULT 'manual' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`sync_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_workspaces_sync_id_unique` ON `user_workspaces` (`sync_id`);