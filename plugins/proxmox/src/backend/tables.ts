import {
  adoptLegacyTable,
  defineTable,
  id,
  integer,
  real,
  refHost,
  refUser,
  text,
  timestamp,
} from "@termix/plugin-sdk/db";

/**
 * Per-host historical node stats samples (CPU, memory, disk, network),
 * polled on an interval while a viewer has the Proxmox stats tab open.
 *
 * Adopted from core's proxmox_node_history, so the column and index names are
 * the legacy ones: the rename carries the existing rows across.
 */
export const proxmoxNodeHistory = adoptLegacyTable(
  "proxmox_node_history",
  defineTable("node_history", {
    id: id(),
    hostId: refHost(),
    ts: timestamp().notNull().defaultNow(),
    cpuPercent: real(),
    memPercent: real(),
    diskPercent: real(),
    netRxBytes: integer(),
    netTxBytes: integer(),
  }),
);

/**
 * One saved dashboard layout per user per host for the Proxmox stats tab.
 *
 * Adopted from core's proxmox_stats_preferences.
 */
export const proxmoxStatsPreferences = adoptLegacyTable(
  "proxmox_stats_preferences",
  defineTable(
    "stats_preferences",
    {
      id: id(),
      userId: refUser(),
      hostId: refHost(),
      // JSON-encoded layout. No secrets, so plain text.
      layout: text().notNull(),
      createdAt: timestamp().notNull().defaultNow(),
      updatedAt: timestamp().notNull().defaultNow(),
    },
    {
      indexes: [
        {
          name: "idx_proxmox_stats_prefs_user_host",
          columns: ["userId", "hostId"],
          unique: true,
        },
      ],
    },
  ),
);

export const tables = [proxmoxNodeHistory, proxmoxStatsPreferences];
