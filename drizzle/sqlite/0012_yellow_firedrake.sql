ALTER TABLE `collab_rooms` ADD `guest_link_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_collab_rooms_guest_token` ON `collab_rooms` (`guest_link_token`);