CREATE TABLE "alert_firings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"rule_id" integer NOT NULL,
	"host_id" integer NOT NULL,
	"host_name" text NOT NULL,
	"fired_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"resolved_at" text,
	"value" double precision,
	"message" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rule_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" integer NOT NULL,
	"channel_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"host_id" integer,
	"name" varchar(255) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger_type" text NOT NULL,
	"threshold_value" double precision,
	"threshold_duration_seconds" integer,
	"cooldown_minutes" integer DEFAULT 15 NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" text,
	"last_used_at" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255),
	"username" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"resource_name" text,
	"details" text,
	"ip_address" text,
	"user_agent" text,
	"success" boolean NOT NULL,
	"error_message" text,
	"timestamp" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "c2s_tunnel_presets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"config" text NOT NULL,
	"platform" text,
	"computer_name" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"host_id" integer NOT NULL,
	"command" text NOT NULL,
	"executed_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_service_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"sync_id" varchar(255),
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "dashboard_service_links_sync_id_unique" UNIQUE("sync_id")
);
--> statement-breakpoint
CREATE TABLE "dismissed_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"alert_id" text NOT NULL,
	"dismissed_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_manager_pinned" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"host_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"path" text NOT NULL,
	"pinned_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_manager_recent" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"host_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"path" text NOT NULL,
	"last_opened" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_manager_shortcuts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"host_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"path" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homepage_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"type_id" text NOT NULL,
	"title" text,
	"config" text DEFAULT '{}' NOT NULL,
	"folder_id" integer,
	"sync_id" varchar(255),
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "homepage_items_sync_id_unique" UNIQUE("sync_id")
);
--> statement-breakpoint
CREATE TABLE "homepage_layouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"layout" text DEFAULT '{}' NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "homepage_layouts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "host_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_id" integer NOT NULL,
	"user_id" varchar(255),
	"role_id" integer,
	"granted_by" varchar(255) NOT NULL,
	"permission_level" text DEFAULT 'connect' NOT NULL,
	"expires_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"last_accessed_at" text,
	"access_count" integer DEFAULT 0 NOT NULL,
	"override_credential_id" integer
);
--> statement-breakpoint
CREATE TABLE "host_health_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"host_id" integer NOT NULL,
	"checks" text NOT NULL,
	"interval_seconds" integer DEFAULT 300 NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_health_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"host_id" integer NOT NULL,
	"check_id" text NOT NULL,
	"ts" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"ok" boolean NOT NULL,
	"latency_ms" integer,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "host_metrics_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_id" integer NOT NULL,
	"ts" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"cpu_percent" double precision,
	"mem_percent" double precision,
	"disk_percent" double precision,
	"net_rx_bytes" integer,
	"net_tx_bytes" integer
);
--> statement-breakpoint
CREATE TABLE "host_metrics_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"host_id" integer NOT NULL,
	"layout" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssh_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"connection_type" text DEFAULT 'ssh' NOT NULL,
	"name" varchar(255),
	"ip" text NOT NULL,
	"port" integer NOT NULL,
	"username" text NOT NULL,
	"folder" text,
	"tags" text,
	"pin" boolean DEFAULT false NOT NULL,
	"auth_type" text NOT NULL,
	"use_warpgate" boolean DEFAULT false NOT NULL,
	"force_keyboard_interactive" text,
	"password" text,
	"key" text,
	"key_password" text,
	"key_type" text,
	"sudo_password" text,
	"autostart_password" text,
	"autostart_key" text,
	"autostart_key_password" text,
	"credential_id" integer,
	"override_credential_username" boolean,
	"vault_profile_id" integer,
	"enable_terminal" boolean DEFAULT true NOT NULL,
	"enable_session_logging" boolean DEFAULT true NOT NULL,
	"allow_session_sharing" boolean DEFAULT true NOT NULL,
	"enable_command_history" boolean DEFAULT true NOT NULL,
	"enable_tunnel" boolean DEFAULT true NOT NULL,
	"tunnel_connections" text,
	"jump_hosts" text,
	"enable_file_manager" boolean DEFAULT true NOT NULL,
	"scp_legacy" boolean DEFAULT false NOT NULL,
	"enable_docker" boolean DEFAULT false NOT NULL,
	"enable_tmux_monitor" boolean DEFAULT false NOT NULL,
	"show_terminal_in_sidebar" boolean DEFAULT true NOT NULL,
	"show_file_manager_in_sidebar" boolean DEFAULT false NOT NULL,
	"show_tunnel_in_sidebar" boolean DEFAULT false NOT NULL,
	"show_docker_in_sidebar" boolean DEFAULT false NOT NULL,
	"show_server_stats_in_sidebar" boolean DEFAULT false NOT NULL,
	"default_path" text,
	"stats_config" text,
	"docker_config" text,
	"enable_proxmox" boolean DEFAULT false NOT NULL,
	"proxmox_config" text,
	"terminal_config" text,
	"quick_actions" text,
	"notes" text,
	"enable_ssh" boolean DEFAULT true NOT NULL,
	"enable_rdp" boolean DEFAULT false NOT NULL,
	"enable_vnc" boolean DEFAULT false NOT NULL,
	"enable_telnet" boolean DEFAULT false NOT NULL,
	"ssh_port" integer DEFAULT 22,
	"rdp_port" integer DEFAULT 3389,
	"vnc_port" integer DEFAULT 5900,
	"telnet_port" integer DEFAULT 23,
	"rdp_credential_id" integer,
	"rdp_user" text,
	"rdp_password" text,
	"rdp_domain" text,
	"rdp_security" text,
	"rdp_ignore_cert" boolean DEFAULT false,
	"vnc_credential_id" integer,
	"vnc_password" text,
	"vnc_user" text,
	"telnet_user" text,
	"telnet_password" text,
	"telnet_credential_id" integer,
	"rdp_auth_type" text,
	"vnc_auth_type" text,
	"telnet_auth_type" text,
	"domain" text,
	"security" text,
	"ignore_cert" boolean DEFAULT false,
	"guacamole_config" text,
	"use_socks5" boolean,
	"socks5_host" text,
	"socks5_port" integer,
	"socks5_username" text,
	"socks5_password" text,
	"socks5_proxy_chain" text,
	"connection_origin" text,
	"mac_address" text,
	"wol_broadcast_address" text,
	"port_knock_sequence" text,
	"host_key_fingerprint" text,
	"host_key_type" text,
	"host_key_algorithm" text DEFAULT 'sha256',
	"host_key_first_seen" text,
	"host_key_last_verified" text,
	"host_key_changed_count" integer DEFAULT 0,
	"sync_id" varchar(255),
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "ssh_data_sync_id_unique" UNIQUE("sync_id")
);
--> statement-breakpoint
CREATE TABLE "network_topology" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"topology" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" text NOT NULL,
	"config" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opkssh_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"host_id" integer NOT NULL,
	"ssh_cert" text NOT NULL,
	"private_key" text NOT NULL,
	"email" text,
	"sub" text,
	"issuer" text,
	"audience" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" text NOT NULL,
	"last_used" text
);
--> statement-breakpoint
CREATE TABLE "recent_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"type" text NOT NULL,
	"host_id" integer NOT NULL,
	"host_name" text,
	"timestamp" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"permissions" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "session_recordings" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_id" integer NOT NULL,
	"user_id" varchar(255),
	"username" text,
	"access_id" integer,
	"started_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"ended_at" text,
	"duration" integer,
	"commands" text,
	"dangerous_actions" text,
	"recording_path" text,
	"protocol" varchar(255) DEFAULT 'ssh' NOT NULL,
	"format" text DEFAULT 'text' NOT NULL,
	"terminated_by_owner" boolean DEFAULT false,
	"termination_reason" text
);
--> statement-breakpoint
CREATE TABLE "session_share_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"share_id" varchar(255) NOT NULL,
	"user_id" varchar(255),
	"guest_label" text,
	"joined_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"left_at" text
);
--> statement-breakpoint
CREATE TABLE "session_shares" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"host_id" integer NOT NULL,
	"owner_user_id" varchar(255) NOT NULL,
	"protocol" varchar(255) NOT NULL,
	"session_id" text NOT NULL,
	"tab_instance_id" text,
	"share_type" text NOT NULL,
	"target_user_id" varchar(255),
	"link_token" varchar(255),
	"permission_level" text DEFAULT 'read-only' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" text NOT NULL,
	"revoked_at" text,
	"last_joined_at" text,
	"join_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "session_shares_link_token_unique" UNIQUE("link_token")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"jwt_token" text NOT NULL,
	"device_type" text NOT NULL,
	"device_info" text NOT NULL,
	"oidc_sub" text,
	"oidc_sid" text,
	"sso_provider_id" integer,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" text NOT NULL,
	"last_active_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_host_secrets" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_access_id" integer NOT NULL,
	"target_user_id" varchar(255) NOT NULL,
	"protocol" varchar(255) DEFAULT 'ssh' NOT NULL,
	"source_type" text DEFAULT 'credential' NOT NULL,
	"original_credential_id" integer,
	"encrypted_username" text,
	"encrypted_auth_type" text,
	"encrypted_password" text,
	"encrypted_key" text,
	"encrypted_key_password" text,
	"encrypted_key_type" text,
	"encrypted_domain" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snippet_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"snippet_id" integer NOT NULL,
	"user_id" varchar(255),
	"role_id" integer,
	"granted_by" varchar(255) NOT NULL,
	"permission_level" text DEFAULT 'view' NOT NULL,
	"expires_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snippet_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"color" text,
	"icon" text,
	"sync_id" varchar(255),
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "snippet_folders_sync_id_unique" UNIQUE("sync_id")
);
--> statement-breakpoint
CREATE TABLE "snippets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"description" text,
	"folder" text,
	"order" integer DEFAULT 0 NOT NULL,
	"sync_id" varchar(255),
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"host_filter" text,
	CONSTRAINT "snippets_sync_id_unique" UNIQUE("sync_id")
);
--> statement-breakpoint
CREATE TABLE "ssh_credential_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"credential_id" integer NOT NULL,
	"host_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"used_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssh_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"folder" text,
	"tags" text,
	"auth_type" text NOT NULL,
	"username" text,
	"password" text,
	"key" text,
	"private_key" text,
	"public_key" text,
	"key_password" text,
	"key_type" text,
	"detected_key_type" text,
	"cert_public_key" text,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used" text,
	"sync_id" varchar(255),
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "ssh_credentials_sync_id_unique" UNIQUE("sync_id")
);
--> statement-breakpoint
CREATE TABLE "ssh_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"color" text,
	"icon" text,
	"credential_id" integer,
	"sync_id" varchar(255),
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "ssh_folders_sync_id_unique" UNIQUE("sync_id")
);
--> statement-breakpoint
CREATE TABLE "sso_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"config" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_tombstones" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"entity_type" text NOT NULL,
	"sync_id" varchar(255) NOT NULL,
	"deleted_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "termix_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"handle" varchar(255) NOT NULL,
	"description" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "termix_identities_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "termix_identities_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "termix_identity_ca" (
	"id" serial PRIMARY KEY NOT NULL,
	"identity_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"validity_days" integer DEFAULT 90 NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "termix_identity_ca_identity_id_unique" UNIQUE("identity_id")
);
--> statement-breakpoint
CREATE TABLE "termix_identity_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"identity_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"public_key" text NOT NULL,
	"key_type" text NOT NULL,
	"algorithm" text NOT NULL,
	"label" text,
	"comment" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"credential_id" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tmux_session_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"host_id" integer NOT NULL,
	"session_name" text NOT NULL,
	"tag" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_recent" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"source_host_id" integer NOT NULL,
	"dest_host_id" integer NOT NULL,
	"dest_path" text NOT NULL,
	"dest_path_label" text NOT NULL,
	"last_used" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trusted_devices" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"device_fingerprint" text NOT NULL,
	"device_type" text NOT NULL,
	"device_info" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" text NOT NULL,
	"last_used_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_open_tabs" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"tab_type" text NOT NULL,
	"host_id" integer,
	"label" text NOT NULL,
	"tab_order" integer DEFAULT 0 NOT NULL,
	"backend_session_id" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" varchar(255) PRIMARY KEY NOT NULL,
	"reopen_tabs_on_login" boolean DEFAULT false NOT NULL,
	"theme" text,
	"font_size" text,
	"accent_color" text,
	"language" text,
	"storage_mode" text,
	"command_autocomplete" boolean,
	"command_palette_enabled" boolean,
	"show_host_tags" boolean,
	"host_tray_on_click" boolean,
	"pin_app_rail" boolean,
	"expand_app_rail_on_hover" boolean,
	"folders_collapsed" boolean,
	"confirm_snippet_execution" boolean,
	"disable_update_check" boolean,
	"confirm_tab_close" boolean,
	"hidden_rail_tabs" text,
	"compact_host_view" boolean,
	"status_color_scheme" text,
	"custom_themes" text,
	"custom_keybindings" text,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"role_id" integer NOT NULL,
	"granted_by" varchar(255),
	"granted_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"is_oidc" boolean DEFAULT false NOT NULL,
	"oidc_identifier" text,
	"sso_provider_id" integer,
	"client_id" text,
	"client_secret" text,
	"issuer_url" text,
	"authorization_url" text,
	"token_url" text,
	"identifier_path" text,
	"name_path" text,
	"scopes" text DEFAULT 'openid email profile',
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"totp_backup_codes" text,
	"registered_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"donation_modal_dismissed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"folder" text,
	"tags" text,
	"vault_addr" text NOT NULL,
	"vault_namespace" text,
	"oidc_mount" text,
	"oidc_role" text,
	"ssh_mount" text,
	"ssh_role" text NOT NULL,
	"valid_principals" text,
	"key_type" text,
	"shared" boolean DEFAULT false NOT NULL,
	"sync_id" varchar(255),
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "vault_profiles_sync_id_unique" UNIQUE("sync_id")
);
--> statement-breakpoint
CREATE TABLE "vault_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"profile_id" integer NOT NULL,
	"ssh_cert" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" text NOT NULL,
	"last_used" text
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_type" text,
	"backed_up" boolean DEFAULT false NOT NULL,
	"transports" text,
	"user_verification" text DEFAULT 'preferred' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"last_used_at" text
);
--> statement-breakpoint
ALTER TABLE "alert_firings" ADD CONSTRAINT "alert_firings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_firings" ADD CONSTRAINT "alert_firings_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rule_channels" ADD CONSTRAINT "alert_rule_channels_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rule_channels" ADD CONSTRAINT "alert_rule_channels_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "c2s_tunnel_presets" ADD CONSTRAINT "c2s_tunnel_presets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_history" ADD CONSTRAINT "command_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_history" ADD CONSTRAINT "command_history_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_service_links" ADD CONSTRAINT "dashboard_service_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dismissed_alerts" ADD CONSTRAINT "dismissed_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_manager_pinned" ADD CONSTRAINT "file_manager_pinned_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_manager_pinned" ADD CONSTRAINT "file_manager_pinned_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_manager_recent" ADD CONSTRAINT "file_manager_recent_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_manager_recent" ADD CONSTRAINT "file_manager_recent_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_manager_shortcuts" ADD CONSTRAINT "file_manager_shortcuts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_manager_shortcuts" ADD CONSTRAINT "file_manager_shortcuts_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homepage_items" ADD CONSTRAINT "homepage_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homepage_layouts" ADD CONSTRAINT "homepage_layouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_access" ADD CONSTRAINT "host_access_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_access" ADD CONSTRAINT "host_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_access" ADD CONSTRAINT "host_access_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_access" ADD CONSTRAINT "host_access_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_access" ADD CONSTRAINT "host_access_override_credential_id_ssh_credentials_id_fk" FOREIGN KEY ("override_credential_id") REFERENCES "public"."ssh_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_health_checks" ADD CONSTRAINT "host_health_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_health_checks" ADD CONSTRAINT "host_health_checks_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_health_history" ADD CONSTRAINT "host_health_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_health_history" ADD CONSTRAINT "host_health_history_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_metrics_history" ADD CONSTRAINT "host_metrics_history_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_metrics_preferences" ADD CONSTRAINT "host_metrics_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_metrics_preferences" ADD CONSTRAINT "host_metrics_preferences_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_data" ADD CONSTRAINT "ssh_data_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_data" ADD CONSTRAINT "ssh_data_credential_id_ssh_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."ssh_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_data" ADD CONSTRAINT "ssh_data_vault_profile_id_vault_profiles_id_fk" FOREIGN KEY ("vault_profile_id") REFERENCES "public"."vault_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_data" ADD CONSTRAINT "ssh_data_rdp_credential_id_ssh_credentials_id_fk" FOREIGN KEY ("rdp_credential_id") REFERENCES "public"."ssh_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_data" ADD CONSTRAINT "ssh_data_vnc_credential_id_ssh_credentials_id_fk" FOREIGN KEY ("vnc_credential_id") REFERENCES "public"."ssh_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_data" ADD CONSTRAINT "ssh_data_telnet_credential_id_ssh_credentials_id_fk" FOREIGN KEY ("telnet_credential_id") REFERENCES "public"."ssh_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_topology" ADD CONSTRAINT "network_topology_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opkssh_tokens" ADD CONSTRAINT "opkssh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opkssh_tokens" ADD CONSTRAINT "opkssh_tokens_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_activity" ADD CONSTRAINT "recent_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_activity" ADD CONSTRAINT "recent_activity_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_access_id_host_access_id_fk" FOREIGN KEY ("access_id") REFERENCES "public"."host_access"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_share_participants" ADD CONSTRAINT "session_share_participants_share_id_session_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."session_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_share_participants" ADD CONSTRAINT "session_share_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_shares" ADD CONSTRAINT "session_shares_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_shares" ADD CONSTRAINT "session_shares_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_shares" ADD CONSTRAINT "session_shares_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_host_secrets" ADD CONSTRAINT "shared_host_secrets_host_access_id_host_access_id_fk" FOREIGN KEY ("host_access_id") REFERENCES "public"."host_access"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_host_secrets" ADD CONSTRAINT "shared_host_secrets_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_host_secrets" ADD CONSTRAINT "shared_host_secrets_original_credential_id_ssh_credentials_id_fk" FOREIGN KEY ("original_credential_id") REFERENCES "public"."ssh_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snippet_access" ADD CONSTRAINT "snippet_access_snippet_id_snippets_id_fk" FOREIGN KEY ("snippet_id") REFERENCES "public"."snippets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snippet_access" ADD CONSTRAINT "snippet_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snippet_access" ADD CONSTRAINT "snippet_access_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snippet_access" ADD CONSTRAINT "snippet_access_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snippet_folders" ADD CONSTRAINT "snippet_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snippets" ADD CONSTRAINT "snippets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_credential_usage" ADD CONSTRAINT "ssh_credential_usage_credential_id_ssh_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."ssh_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_credential_usage" ADD CONSTRAINT "ssh_credential_usage_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_credential_usage" ADD CONSTRAINT "ssh_credential_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_credentials" ADD CONSTRAINT "ssh_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_folders" ADD CONSTRAINT "ssh_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_folders" ADD CONSTRAINT "ssh_folders_credential_id_ssh_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."ssh_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_tombstones" ADD CONSTRAINT "sync_tombstones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termix_identities" ADD CONSTRAINT "termix_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termix_identity_ca" ADD CONSTRAINT "termix_identity_ca_identity_id_termix_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."termix_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termix_identity_ca" ADD CONSTRAINT "termix_identity_ca_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termix_identity_keys" ADD CONSTRAINT "termix_identity_keys_identity_id_termix_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."termix_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termix_identity_keys" ADD CONSTRAINT "termix_identity_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termix_identity_keys" ADD CONSTRAINT "termix_identity_keys_credential_id_ssh_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."ssh_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tmux_session_tags" ADD CONSTRAINT "tmux_session_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tmux_session_tags" ADD CONSTRAINT "tmux_session_tags_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_recent" ADD CONSTRAINT "transfer_recent_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_recent" ADD CONSTRAINT "transfer_recent_source_host_id_ssh_data_id_fk" FOREIGN KEY ("source_host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_recent" ADD CONSTRAINT "transfer_recent_dest_host_id_ssh_data_id_fk" FOREIGN KEY ("dest_host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_open_tabs" ADD CONSTRAINT "user_open_tabs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_open_tabs" ADD CONSTRAINT "user_open_tabs_host_id_ssh_data_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_profiles" ADD CONSTRAINT "vault_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_tokens" ADD CONSTRAINT "vault_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_tokens" ADD CONSTRAINT "vault_tokens_profile_id_vault_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."vault_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_host_health_checks_user_host" ON "host_health_checks" USING btree ("user_id","host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_host_metrics_prefs_user_host" ON "host_metrics_preferences" USING btree ("user_id","host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_opkssh_tokens_user_host" ON "opkssh_tokens" USING btree ("user_id","host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_shared_host_secrets_scope" ON "shared_host_secrets" USING btree ("host_access_id","target_user_id","protocol");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_roles_user_role" ON "user_roles" USING btree ("user_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_vault_tokens_user_profile" ON "vault_tokens" USING btree ("user_id","profile_id");