ALTER TABLE `api_keys` ADD `host_ids` text;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `auto_approve` integer DEFAULT false NOT NULL;