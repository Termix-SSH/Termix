CREATE TABLE `alert_firings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`rule_id` integer NOT NULL,
	`host_id` integer NOT NULL,
	`host_name` text NOT NULL,
	`fired_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	`value` real,
	`message` text NOT NULL,
	`severity` text DEFAULT 'warning' NOT NULL,
	`acknowledged` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`) REFERENCES `alert_rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `alert_rule_channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` integer NOT NULL,
	`channel_id` integer NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `alert_rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `notification_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `alert_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`host_id` integer,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`trigger_type` text NOT NULL,
	`threshold_value` real,
	`threshold_duration_seconds` integer,
	`cooldown_minutes` integer DEFAULT 15 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text,
	`last_used_at` text,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`username` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`resource_name` text,
	`details` text,
	`ip_address` text,
	`user_agent` text,
	`success` integer NOT NULL,
	`error_message` text,
	`timestamp` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `c2s_tunnel_presets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`platform` text,
	`computer_name` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `command_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`host_id` integer NOT NULL,
	`command` text NOT NULL,
	`executed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `credential_sidebar_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dashboard_service_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`sync_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dashboard_service_links_sync_id_unique` ON `dashboard_service_links` (`sync_id`);--> statement-breakpoint
CREATE TABLE `dismissed_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`alert_id` text NOT NULL,
	`dismissed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `file_manager_pinned` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`host_id` integer NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`pinned_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `file_manager_recent` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`host_id` integer NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`last_opened` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `file_manager_shortcuts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`host_id` integer NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `homepage_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`type_id` text NOT NULL,
	`title` text,
	`config` text DEFAULT '{}' NOT NULL,
	`folder_id` integer,
	`sync_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `homepage_items_sync_id_unique` ON `homepage_items` (`sync_id`);--> statement-breakpoint
CREATE TABLE `homepage_layouts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`layout` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `homepage_layouts_user_id_unique` ON `homepage_layouts` (`user_id`);--> statement-breakpoint
CREATE TABLE `host_access` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_id` integer NOT NULL,
	`user_id` text,
	`role_id` integer,
	`granted_by` text NOT NULL,
	`permission_level` text DEFAULT 'connect' NOT NULL,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_accessed_at` text,
	`access_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `host_health_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`host_id` integer NOT NULL,
	`checks` text NOT NULL,
	`interval_seconds` integer DEFAULT 300 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_host_health_checks_user_host` ON `host_health_checks` (`user_id`,`host_id`);--> statement-breakpoint
CREATE TABLE `host_health_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`host_id` integer NOT NULL,
	`check_id` text NOT NULL,
	`ts` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`ok` integer NOT NULL,
	`latency_ms` integer,
	`detail` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `host_metrics_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_id` integer NOT NULL,
	`ts` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`cpu_percent` real,
	`mem_percent` real,
	`disk_percent` real,
	`net_rx_bytes` integer,
	`net_tx_bytes` integer,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `host_metrics_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`host_id` integer NOT NULL,
	`layout` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_host_metrics_prefs_user_host` ON `host_metrics_preferences` (`user_id`,`host_id`);--> statement-breakpoint
CREATE TABLE `host_sidebar_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ssh_data` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`connection_type` text DEFAULT 'ssh' NOT NULL,
	`name` text,
	`ip` text NOT NULL,
	`port` integer NOT NULL,
	`username` text NOT NULL,
	`folder` text,
	`tags` text,
	`pin` integer DEFAULT false NOT NULL,
	`sort_order` integer,
	`auth_type` text NOT NULL,
	`use_warpgate` integer DEFAULT false NOT NULL,
	`share_ssh_auth` integer DEFAULT false NOT NULL,
	`force_keyboard_interactive` text,
	`password` text,
	`key` text(8192),
	`key_password` text,
	`key_type` text,
	`sudo_password` text,
	`autostart_password` text,
	`autostart_key` text(8192),
	`autostart_key_password` text,
	`credential_id` integer,
	`override_credential_username` integer,
	`vault_profile_id` integer,
	`enable_terminal` integer DEFAULT true NOT NULL,
	`enable_session_logging` integer DEFAULT true NOT NULL,
	`allow_session_sharing` integer DEFAULT true NOT NULL,
	`enable_command_history` integer DEFAULT true NOT NULL,
	`enable_tunnel` integer DEFAULT true NOT NULL,
	`tunnel_connections` text,
	`jump_hosts` text,
	`enable_file_manager` integer DEFAULT true NOT NULL,
	`scp_legacy` integer DEFAULT false NOT NULL,
	`enable_docker` integer DEFAULT false NOT NULL,
	`enable_tmux_monitor` integer DEFAULT false NOT NULL,
	`show_terminal_in_sidebar` integer DEFAULT true NOT NULL,
	`show_file_manager_in_sidebar` integer DEFAULT false NOT NULL,
	`show_tunnel_in_sidebar` integer DEFAULT false NOT NULL,
	`show_docker_in_sidebar` integer DEFAULT false NOT NULL,
	`show_server_stats_in_sidebar` integer DEFAULT false NOT NULL,
	`default_path` text,
	`stats_config` text,
	`docker_config` text,
	`enable_proxmox` integer DEFAULT false NOT NULL,
	`proxmox_config` text,
	`terminal_config` text,
	`quick_actions` text,
	`notes` text,
	`enable_ssh` integer DEFAULT true NOT NULL,
	`enable_rdp` integer DEFAULT false NOT NULL,
	`enable_vnc` integer DEFAULT false NOT NULL,
	`enable_telnet` integer DEFAULT false NOT NULL,
	`ssh_port` integer DEFAULT 22,
	`rdp_port` integer DEFAULT 3389,
	`vnc_port` integer DEFAULT 5900,
	`telnet_port` integer DEFAULT 23,
	`rdp_credential_id` integer,
	`rdp_user` text,
	`rdp_password` text,
	`rdp_domain` text,
	`rdp_security` text,
	`rdp_ignore_cert` integer DEFAULT false,
	`vnc_credential_id` integer,
	`vnc_password` text,
	`vnc_user` text,
	`telnet_user` text,
	`telnet_password` text,
	`telnet_credential_id` integer,
	`rdp_auth_type` text,
	`vnc_auth_type` text,
	`telnet_auth_type` text,
	`domain` text,
	`security` text,
	`ignore_cert` integer DEFAULT false,
	`guacamole_config` text,
	`use_socks5` integer,
	`socks5_host` text,
	`socks5_port` integer,
	`socks5_username` text,
	`socks5_password` text,
	`socks5_proxy_chain` text,
	`connection_origin` text,
	`mac_address` text,
	`wol_broadcast_address` text,
	`port_knock_sequence` text,
	`host_key_fingerprint` text,
	`host_key_type` text,
	`host_key_algorithm` text DEFAULT 'sha256',
	`host_key_first_seen` text,
	`host_key_last_verified` text,
	`host_key_changed_count` integer DEFAULT 0,
	`sync_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `ssh_credentials`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`vault_profile_id`) REFERENCES `vault_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`rdp_credential_id`) REFERENCES `ssh_credentials`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`vnc_credential_id`) REFERENCES `ssh_credentials`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`telnet_credential_id`) REFERENCES `ssh_credentials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ssh_data_sync_id_unique` ON `ssh_data` (`sync_id`);--> statement-breakpoint
CREATE TABLE `network_topology` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`topology` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification_channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `opkssh_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`host_id` integer NOT NULL,
	`ssh_cert` text(8192) NOT NULL,
	`private_key` text(8192) NOT NULL,
	`email` text,
	`sub` text,
	`issuer` text,
	`audience` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`last_used` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_opkssh_tokens_user_host` ON `opkssh_tokens` (`user_id`,`host_id`);--> statement-breakpoint
CREATE TABLE `recent_activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`host_id` integer NOT NULL,
	`host_name` text,
	`timestamp` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`is_system` integer DEFAULT false NOT NULL,
	`permissions` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_name_unique` ON `roles` (`name`);--> statement-breakpoint
CREATE TABLE `session_recordings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_id` integer NOT NULL,
	`user_id` text,
	`username` text,
	`access_id` integer,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`ended_at` text,
	`duration` integer,
	`commands` text,
	`dangerous_actions` text,
	`recording_path` text,
	`protocol` text DEFAULT 'ssh' NOT NULL,
	`format` text DEFAULT 'text' NOT NULL,
	`terminated_by_owner` integer DEFAULT false,
	`termination_reason` text,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`access_id`) REFERENCES `host_access`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `session_share_participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`share_id` text NOT NULL,
	`user_id` text,
	`guest_label` text,
	`joined_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`left_at` text,
	FOREIGN KEY (`share_id`) REFERENCES `session_shares`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`host_id` integer NOT NULL,
	`owner_user_id` text NOT NULL,
	`protocol` text NOT NULL,
	`session_id` text NOT NULL,
	`tab_instance_id` text,
	`share_type` text NOT NULL,
	`target_user_id` text,
	`link_token` text,
	`permission_level` text DEFAULT 'read-only' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`last_joined_at` text,
	`join_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_shares_link_token_unique` ON `session_shares` (`link_token`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`jwt_token` text NOT NULL,
	`device_type` text NOT NULL,
	`device_info` text NOT NULL,
	`oidc_sub` text,
	`oidc_sid` text,
	`sso_provider_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`last_active_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shared_host_auth_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`protocol` text DEFAULT 'ssh' NOT NULL,
	`credential_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `ssh_credentials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_host_auth_overrides_host_user_protocol_unique` ON `shared_host_auth_overrides` (`host_id`,`user_id`,`protocol`);--> statement-breakpoint
CREATE TABLE `shared_host_secrets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_access_id` integer NOT NULL,
	`target_user_id` text NOT NULL,
	`protocol` text DEFAULT 'ssh' NOT NULL,
	`source_type` text DEFAULT 'credential' NOT NULL,
	`original_credential_id` integer,
	`encrypted_username` text,
	`encrypted_auth_type` text,
	`encrypted_password` text,
	`encrypted_key` text(16384),
	`encrypted_key_password` text,
	`encrypted_key_type` text,
	`encrypted_domain` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`host_access_id`) REFERENCES `host_access`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`original_credential_id`) REFERENCES `ssh_credentials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shared_host_secrets_scope` ON `shared_host_secrets` (`host_access_id`,`target_user_id`,`protocol`);--> statement-breakpoint
CREATE TABLE `snippet_access` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snippet_id` integer NOT NULL,
	`user_id` text,
	`role_id` integer,
	`granted_by` text NOT NULL,
	`permission_level` text DEFAULT 'view' NOT NULL,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`snippet_id`) REFERENCES `snippets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `snippet_folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`icon` text,
	`sync_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snippet_folders_sync_id_unique` ON `snippet_folders` (`sync_id`);--> statement-breakpoint
CREATE TABLE `snippets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`description` text,
	`folder` text,
	`order` integer DEFAULT 0 NOT NULL,
	`sync_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`host_filter` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snippets_sync_id_unique` ON `snippets` (`sync_id`);--> statement-breakpoint
CREATE TABLE `ssh_credential_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`credential_id` integer NOT NULL,
	`host_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`used_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`credential_id`) REFERENCES `ssh_credentials`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ssh_credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`folder` text,
	`tags` text,
	`pin` integer DEFAULT false NOT NULL,
	`sort_order` integer,
	`auth_type` text NOT NULL,
	`username` text,
	`password` text,
	`key` text(16384),
	`private_key` text(16384),
	`public_key` text(4096),
	`key_password` text,
	`key_type` text,
	`detected_key_type` text,
	`cert_public_key` text(8192),
	`usage_count` integer DEFAULT 0 NOT NULL,
	`last_used` text,
	`sync_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ssh_credentials_sync_id_unique` ON `ssh_credentials` (`sync_id`);--> statement-breakpoint
CREATE TABLE `ssh_folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`icon` text,
	`credential_id` integer,
	`sort_order` integer,
	`sync_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `ssh_credentials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ssh_folders_sync_id_unique` ON `ssh_folders` (`sync_id`);--> statement-breakpoint
CREATE TABLE `sso_providers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`config` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_tombstones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`sync_id` text NOT NULL,
	`deleted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `termix_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`handle` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `termix_identities_user_id_unique` ON `termix_identities` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `termix_identities_handle_unique` ON `termix_identities` (`handle`);--> statement-breakpoint
CREATE TABLE `termix_identity_ca` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identity_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`public_key` text(4096) NOT NULL,
	`private_key` text(8192) NOT NULL,
	`validity_days` integer DEFAULT 90 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `termix_identities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `termix_identity_ca_identity_id_unique` ON `termix_identity_ca` (`identity_id`);--> statement-breakpoint
CREATE TABLE `termix_identity_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identity_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`public_key` text(8192) NOT NULL,
	`key_type` text NOT NULL,
	`algorithm` text NOT NULL,
	`label` text,
	`comment` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`credential_id` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `termix_identities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `ssh_credentials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `tmux_session_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`host_id` integer NOT NULL,
	`session_name` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `transfer_recent` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`source_host_id` integer NOT NULL,
	`dest_host_id` integer NOT NULL,
	`dest_path` text NOT NULL,
	`dest_path_label` text NOT NULL,
	`last_used` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dest_host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trusted_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_fingerprint` text NOT NULL,
	`device_type` text NOT NULL,
	`device_info` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`last_used_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_open_tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tab_type` text NOT NULL,
	`host_id` integer,
	`label` text NOT NULL,
	`tab_order` integer DEFAULT 0 NOT NULL,
	`backend_session_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`reopen_tabs_on_login` integer DEFAULT false NOT NULL,
	`theme` text,
	`font_size` text,
	`accent_color` text,
	`language` text,
	`storage_mode` text,
	`command_autocomplete` integer,
	`command_palette_enabled` integer,
	`show_host_tags` integer,
	`host_tray_on_click` integer,
	`pin_app_rail` integer,
	`expand_app_rail_on_hover` integer,
	`folders_collapsed` integer,
	`confirm_snippet_execution` integer,
	`disable_update_check` integer,
	`confirm_tab_close` integer,
	`hidden_rail_tabs` text,
	`compact_host_view` integer,
	`status_color_scheme` text,
	`custom_themes` text,
	`custom_keybindings` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`role_id` integer NOT NULL,
	`granted_by` text,
	`granted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_roles_user_role` ON `user_roles` (`user_id`,`role_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`is_oidc` integer DEFAULT false NOT NULL,
	`oidc_identifier` text,
	`sso_provider_id` integer,
	`client_id` text,
	`client_secret` text,
	`issuer_url` text,
	`authorization_url` text,
	`token_url` text,
	`identifier_path` text,
	`name_path` text,
	`scopes` text DEFAULT 'openid email profile',
	`totp_secret` text,
	`totp_enabled` integer DEFAULT false NOT NULL,
	`totp_backup_codes` text,
	`registered_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`donation_modal_dismissed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vault_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`folder` text,
	`tags` text,
	`vault_addr` text NOT NULL,
	`vault_namespace` text,
	`oidc_mount` text,
	`oidc_role` text,
	`ssh_mount` text,
	`ssh_role` text NOT NULL,
	`valid_principals` text,
	`key_type` text,
	`shared` integer DEFAULT false NOT NULL,
	`sync_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vault_profiles_sync_id_unique` ON `vault_profiles` (`sync_id`);--> statement-breakpoint
CREATE TABLE `vault_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`profile_id` integer NOT NULL,
	`ssh_cert` text(8192) NOT NULL,
	`private_key` text(8192) NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`last_used` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `vault_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vault_tokens_user_profile` ON `vault_tokens` (`user_id`,`profile_id`);--> statement-breakpoint
CREATE TABLE `webauthn_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`device_type` text,
	`backed_up` integer DEFAULT false NOT NULL,
	`transports` text,
	`user_verification` text DEFAULT 'preferred' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
