UPDATE `users` SET `username` = `username` || '-' || `id` WHERE EXISTS (SELECT 1 FROM `users` AS `older` WHERE `older`.`username` = `users`.`username` AND (`older`.`registered_at` < `users`.`registered_at` OR (`older`.`registered_at` = `users`.`registered_at` AND `older`.`id` < `users`.`id`)));--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`);
