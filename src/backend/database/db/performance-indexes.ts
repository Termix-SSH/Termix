import { databaseLogger } from "../../utils/logger.js";

/**
 * Indexes for the columns the app filters, joins and sorts on.
 *
 * Most tables here are scoped per user or per host and were previously reached
 * with a full table scan on every read: the foreign keys existed, but SQLite
 * does not index the child side of a foreign key on its own. That is fine for a
 * home install with a handful of hosts and invisible in testing; on an install
 * with thousands of hosts and a large audit trail it is the dominant cost of a
 * request.
 *
 * Ordering within a composite matters: the equality column comes first and the
 * range/sort column second, so the same index serves both the filter and the
 * ORDER BY.
 */
export interface PerformanceIndex {
  name: string;
  table: string;
  columns: string;
  /** Enforces a constraint as well as serving reads, e.g. one row per key. */
  unique?: boolean;
}

export const PERFORMANCE_INDEXES: PerformanceIndex[] = [
  // Host list: the single hottest read in the app.
  { name: "idx_ssh_data_user_id", table: "ssh_data", columns: "user_id" },
  {
    name: "idx_ssh_data_parent_host",
    table: "ssh_data",
    columns: "parent_host_id",
  },
  {
    name: "idx_ssh_data_credential",
    table: "ssh_data",
    columns: "credential_id",
  },

  // Sharing: resolved for every host list request and every permission check.
  { name: "idx_host_access_user_id", table: "host_access", columns: "user_id" },
  { name: "idx_host_access_role_id", table: "host_access", columns: "role_id" },
  { name: "idx_host_access_host_id", table: "host_access", columns: "host_id" },
  {
    name: "idx_host_access_expires_at",
    table: "host_access",
    columns: "expires_at",
  },

  // Audit log: grows without bound and is always read newest-first.
  {
    name: "idx_audit_logs_timestamp",
    table: "audit_logs",
    columns: "timestamp",
  },
  {
    name: "idx_audit_logs_user_ts",
    table: "audit_logs",
    columns: "user_id, timestamp",
  },
  {
    name: "idx_audit_logs_action_ts",
    table: "audit_logs",
    columns: "action, timestamp",
  },
  {
    name: "idx_audit_logs_resource_ts",
    table: "audit_logs",
    columns: "resource_type, timestamp",
  },

  // Auth hot path: touched on every authenticated request.
  { name: "idx_sessions_user_id", table: "sessions", columns: "user_id" },
  { name: "idx_sessions_expires_at", table: "sessions", columns: "expires_at" },
  { name: "idx_user_roles_user_id", table: "user_roles", columns: "user_id" },
  { name: "idx_user_roles_role_id", table: "user_roles", columns: "role_id" },
  {
    name: "idx_trusted_devices_user_id",
    table: "trusted_devices",
    columns: "user_id",
  },
  { name: "idx_api_keys_user_id", table: "api_keys", columns: "user_id" },

  // Credentials and folders.
  {
    name: "idx_ssh_credentials_user_id",
    table: "ssh_credentials",
    columns: "user_id",
  },
  { name: "idx_ssh_folders_user_id", table: "ssh_folders", columns: "user_id" },
  {
    name: "idx_ssh_credential_usage_credential",
    table: "ssh_credential_usage",
    columns: "credential_id",
  },
  {
    name: "idx_ssh_credential_usage_user",
    table: "ssh_credential_usage",
    columns: "user_id",
  },

  // Snippets.
  { name: "idx_snippets_user_id", table: "snippets", columns: "user_id" },
  {
    name: "idx_snippet_access_user_id",
    table: "snippet_access",
    columns: "user_id",
  },
  {
    name: "idx_snippet_access_snippet_id",
    table: "snippet_access",
    columns: "snippet_id",
  },
  {
    name: "idx_snippet_access_role_id",
    table: "snippet_access",
    columns: "role_id",
  },

  // Per-user history and file manager surfaces.
  {
    name: "idx_recent_activity_user_ts",
    table: "recent_activity",
    columns: "user_id, timestamp",
  },
  {
    name: "idx_command_history_user_host",
    table: "command_history",
    columns: "user_id, host_id",
  },
  {
    name: "idx_file_manager_recent_user",
    table: "file_manager_recent",
    columns: "user_id, host_id",
  },
  {
    name: "idx_file_manager_pinned_user",
    table: "file_manager_pinned",
    columns: "user_id, host_id",
  },
  {
    name: "idx_file_manager_shortcuts_user",
    table: "file_manager_shortcuts",
    columns: "user_id, host_id",
  },
  {
    name: "idx_transfer_recent_user",
    table: "transfer_recent",
    columns: "user_id",
  },
  {
    name: "idx_user_open_tabs_user_id",
    table: "user_open_tabs",
    columns: "user_id",
  },
  {
    name: "idx_user_workspaces_user_id",
    table: "user_workspaces",
    columns: "user_id",
  },
  {
    name: "idx_homepage_items_user_id",
    table: "homepage_items",
    columns: "user_id",
  },
  {
    name: "idx_dismissed_alerts_user_id",
    table: "dismissed_alerts",
    columns: "user_id",
  },

  // Recordings and live session sharing.
  {
    name: "idx_session_recordings_user_started",
    table: "session_recordings",
    columns: "user_id, started_at",
  },
  {
    name: "idx_session_recordings_host",
    table: "session_recordings",
    columns: "host_id",
  },
  {
    name: "idx_session_shares_session_id",
    table: "session_shares",
    columns: "session_id",
  },
  {
    name: "idx_session_shares_host_id",
    table: "session_shares",
    columns: "host_id",
  },

  // Fleets.
  {
    name: "idx_fleet_members_fleet",
    table: "fleet_members",
    columns: "fleet_id",
  },
  {
    name: "idx_fleet_members_host",
    table: "fleet_members",
    columns: "host_id",
  },
  {
    name: "idx_fleet_inventory_user",
    table: "fleet_inventory",
    columns: "user_id",
  },

  // Alerting.
  {
    name: "idx_alert_firings_rule",
    table: "alert_firings",
    columns: "rule_id, fired_at",
  },
  {
    name: "idx_alert_firings_host",
    table: "alert_firings",
    columns: "host_id",
  },

  // Automations.
  {
    name: "idx_automations_user",
    table: "automations",
    columns: "user_id, enabled",
  },
  {
    name: "idx_automation_trigger_state_key",
    table: "automation_trigger_state",
    columns: "automation_id, state_key",
    unique: true,
  },
  {
    name: "idx_automation_schedules_automation",
    table: "automation_schedules",
    columns: "automation_id",
    unique: true,
  },
  {
    name: "idx_automation_schedules_due",
    table: "automation_schedules",
    columns: "next_due_at",
  },
  {
    name: "idx_automation_runs_automation",
    table: "automation_runs",
    columns: "automation_id, started_at",
  },
  {
    name: "idx_automation_runs_user",
    table: "automation_runs",
    columns: "user_id, started_at",
  },
  {
    name: "idx_automation_run_steps_run",
    table: "automation_run_steps",
    columns: "run_id, step_index",
  },
  {
    name: "idx_automation_channels_pair",
    table: "automation_channels",
    columns: "automation_id, channel_id",
    unique: true,
  },

  // AI assistant.
  {
    name: "idx_ai_providers_user_label",
    table: "ai_providers",
    columns: "user_id, label",
    unique: true,
  },
  {
    name: "idx_ai_conversations_user",
    table: "ai_conversations",
    columns: "user_id, updated_at",
  },
  {
    name: "idx_ai_messages_conversation",
    table: "ai_messages",
    columns: "conversation_id, created_at",
  },
  {
    name: "idx_ai_proposals_user",
    table: "ai_proposals",
    columns: "user_id, status",
  },
  {
    name: "idx_ai_proposals_conversation",
    table: "ai_proposals",
    columns: "conversation_id",
  },
];

interface IndexableDatabase {
  exec(sql: string): unknown;
}

export interface IndexCreationSummary {
  created: number;
  skipped: number;
  failed: number;
}

/**
 * Creates any missing index, leaving existing ones untouched.
 *
 * A failure here is logged and skipped rather than thrown: an index is a pure
 * optimisation, and a table that a given install has not created yet (or a
 * column an older schema is missing) must not stop the server from booting.
 */
export function createPerformanceIndexes(
  db: IndexableDatabase,
  indexes: PerformanceIndex[] = PERFORMANCE_INDEXES,
): IndexCreationSummary {
  const summary: IndexCreationSummary = { created: 0, skipped: 0, failed: 0 };
  const startedAt = Date.now();

  for (const index of indexes) {
    try {
      db.exec(
        `CREATE ${index.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${index.name} ON ${index.table}(${index.columns})`,
      );
      summary.created++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A missing table or column means this install does not have that
      // feature's schema; nothing to index and nothing to warn loudly about.
      if (/no such table|no such column/i.test(message)) {
        summary.skipped++;
        continue;
      }
      summary.failed++;
      databaseLogger.warn(`Could not create index ${index.name}: ${message}`, {
        operation: "performance_index_create",
        index: index.name,
        table: index.table,
      });
    }
  }

  databaseLogger.info(
    `Performance indexes ready in ${Date.now() - startedAt}ms`,
    {
      operation: "performance_index_create",
      ...summary,
    },
  );

  return summary;
}
