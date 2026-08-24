ALTER TABLE `collab_rooms` ADD `guest_link_token` varchar(255);--> statement-breakpoint
ALTER TABLE `collab_rooms` ADD CONSTRAINT `idx_collab_rooms_guest_token` UNIQUE(`guest_link_token`);