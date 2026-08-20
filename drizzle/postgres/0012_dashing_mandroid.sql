CREATE TABLE "ai_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"title" text,
	"provider_id" integer,
	"model" text,
	"created_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"tool_calls" text,
	"created_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"kind" text NOT NULL,
	"summary" text,
	"payload" text DEFAULT '{}' NOT NULL,
	"status" varchar(255) DEFAULT 'pending' NOT NULL,
	"applied_at" text,
	"result_summary" text,
	"created_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"provider_type" text NOT NULL,
	"label" varchar(255) NOT NULL,
	"base_url" text,
	"api_key" text,
	"api_key_prefix" text,
	"default_model" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"automation_id" integer NOT NULL,
	"channel_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_run_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"step_index" integer NOT NULL,
	"step_id" text NOT NULL,
	"step_type" text NOT NULL,
	"status" varchar(255) NOT NULL,
	"started_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"finished_at" text,
	"output" text,
	"error" text,
	"truncated" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"automation_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_context" text,
	"status" varchar(255) NOT NULL,
	"started_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"finished_at" text,
	"duration_ms" integer,
	"error" text,
	"dry_run" boolean DEFAULT false NOT NULL,
	"parent_run_id" integer
);
--> statement-breakpoint
CREATE TABLE "automation_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"automation_id" integer NOT NULL,
	"cron" text,
	"interval_seconds" integer,
	"timezone" text,
	"next_due_at" varchar(255),
	"last_tick_at" text
);
--> statement-breakpoint
CREATE TABLE "automation_trigger_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"automation_id" integer NOT NULL,
	"state_key" varchar(255) NOT NULL,
	"breach_started_at" text,
	"last_fired_at" text,
	"last_value" double precision,
	"last_observed_state" text,
	"updated_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"definition" text NOT NULL,
	"definition_version" integer DEFAULT 1 NOT NULL,
	"concurrency_policy" text DEFAULT 'skip' NOT NULL,
	"max_run_seconds" integer DEFAULT 300 NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"last_run_at" text,
	"last_run_status" text,
	"created_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" varchar(255) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_rules" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "alert_rules" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "alert_rules" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "alert_rules" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "c2s_tunnel_presets" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "c2s_tunnel_presets" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "c2s_tunnel_presets" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "c2s_tunnel_presets" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "credential_sidebar_preferences" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "credential_sidebar_preferences" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "dashboard_service_links" ALTER COLUMN "label" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "dashboard_service_links" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "dashboard_service_links" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "dashboard_service_links" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "dashboard_service_links" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "file_manager_shortcuts" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "file_manager_shortcuts" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "fleets" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "fleets" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "fleets" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "fleets" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "homepage_items" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "homepage_items" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "homepage_items" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "homepage_items" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "homepage_layouts" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "homepage_layouts" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "host_access" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "host_access" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "host_health_checks" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "host_health_checks" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "host_health_checks" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "host_health_checks" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "host_metrics_preferences" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "host_metrics_preferences" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "host_metrics_preferences" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "host_metrics_preferences" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "host_sidebar_preferences" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "host_sidebar_preferences" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "ssh_data" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "ssh_data" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "ssh_data" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "ssh_data" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "network_topology" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "network_topology" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "network_topology" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "network_topology" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "notification_channels" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "notification_channels" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "opkssh_tokens" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "opkssh_tokens" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "proxmox_stats_preferences" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "proxmox_stats_preferences" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "proxmox_stats_preferences" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "proxmox_stats_preferences" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "session_shares" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "session_shares" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "shared_host_auth_overrides" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "shared_host_auth_overrides" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "shared_host_auth_overrides" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "shared_host_auth_overrides" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "shared_host_secrets" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "shared_host_secrets" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "shared_host_secrets" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "shared_host_secrets" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "snippet_access" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "snippet_access" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "snippet_folders" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "snippet_folders" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "snippet_folders" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "snippet_folders" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "snippets" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "snippets" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "snippets" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "snippets" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "ssh_credentials" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "ssh_credentials" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "ssh_credentials" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "ssh_credentials" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "ssh_folders" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "ssh_folders" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "ssh_folders" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "ssh_folders" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "sso_providers" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "sso_providers" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "sso_providers" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "sso_providers" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "termix_identities" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "termix_identities" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "termix_identities" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "termix_identities" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "termix_identity_ca" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "termix_identity_ca" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "termix_identity_ca" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "termix_identity_ca" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "termix_identity_keys" ALTER COLUMN "label" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "termix_identity_keys" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "termix_identity_keys" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "tmux_session_tags" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "tmux_session_tags" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "trusted_devices" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "trusted_devices" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "ui_preferences" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "ui_preferences" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "user_open_tabs" ALTER COLUMN "label" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "user_open_tabs" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "user_open_tabs" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "user_open_tabs" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "user_open_tabs" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "user_preferences" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "user_preferences" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "user_workspaces" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "user_workspaces" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "user_workspaces" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "user_workspaces" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "vault_profiles" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "vault_profiles" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "vault_profiles" ALTER COLUMN "updated_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "vault_profiles" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "vault_tokens" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "vault_tokens" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ALTER COLUMN "created_at" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "ai_assistant_enabled" boolean;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "ai_read_only_commands" boolean;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_channels" ADD CONSTRAINT "automation_channels_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_channels" ADD CONSTRAINT "automation_channels_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run_steps" ADD CONSTRAINT "automation_run_steps_run_id_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."automation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_schedules" ADD CONSTRAINT "automation_schedules_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_trigger_state" ADD CONSTRAINT "automation_trigger_state_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_conversations_user" ON "ai_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_ai_messages_conversation" ON "ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_proposals_user" ON "ai_proposals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_ai_proposals_conversation" ON "ai_proposals" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ai_providers_user_label" ON "ai_providers" USING btree ("user_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_automation_channels_pair" ON "automation_channels" USING btree ("automation_id","channel_id");--> statement-breakpoint
CREATE INDEX "idx_automation_run_steps_run" ON "automation_run_steps" USING btree ("run_id","step_index");--> statement-breakpoint
CREATE INDEX "idx_automation_runs_automation" ON "automation_runs" USING btree ("automation_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_automation_runs_user" ON "automation_runs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_automation_schedules_automation" ON "automation_schedules" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "idx_automation_schedules_due" ON "automation_schedules" USING btree ("next_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_automation_trigger_state_key" ON "automation_trigger_state" USING btree ("automation_id","state_key");--> statement-breakpoint
CREATE INDEX "idx_automations_user" ON "automations" USING btree ("user_id","enabled");