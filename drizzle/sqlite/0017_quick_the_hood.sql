ALTER TABLE `ssh_data` ADD `enable_web_ui` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ssh_data` ADD `web_ui_config` text;