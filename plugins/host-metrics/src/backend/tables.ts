import {
  adoptLegacyTable,
  boolean,
  defineTable,
  id,
  integer,
  real,
  refHost,
  refUser,
  text,
  timestamp,
  varchar,
} from "@termix/plugin-sdk/db";

/** One card layout per user per host, as JSON. */
export const hostMetricsPreferences = adoptLegacyTable(
  "host_metrics_preferences",
  defineTable(
    "host_metrics_preferences",
    {
      id: id(),
      userId: refUser(),
      hostId: refHost(),
      layout: text().notNull(),
      createdAt: timestamp().notNull().defaultNow(),
      updatedAt: timestamp().notNull().defaultNow(),
    },
    {
      uniques: [
        {
          name: "idx_host_metrics_prefs_user_host",
          columns: ["userId", "hostId"],
        },
      ],
    },
  ),
);

/** A user's health checks for a host, as a JSON array. */
export const hostHealthChecks = adoptLegacyTable(
  "host_health_checks",
  defineTable(
    "host_health_checks",
    {
      id: id(),
      userId: refUser(),
      hostId: refHost(),
      checks: text().notNull(),
      intervalSeconds: integer().notNull().default(300),
      createdAt: timestamp().notNull().defaultNow(),
      updatedAt: timestamp().notNull().defaultNow(),
    },
    {
      uniques: [
        {
          name: "idx_host_health_checks_user_host",
          columns: ["userId", "hostId"],
        },
      ],
    },
  ),
);

export const hostHealthHistory = adoptLegacyTable(
  "host_health_history",
  defineTable(
    "host_health_history",
    {
      id: id(),
      userId: refUser(),
      hostId: refHost(),
      checkId: varchar().notNull(),
      ts: timestamp().notNull().defaultNow(),
      ok: boolean().notNull(),
      latencyMs: integer(),
      detail: text(),
    },
    {
      indexes: [
        {
          name: "idx_host_health_history_lookup",
          columns: ["userId", "hostId", "checkId", "ts"],
        },
      ],
    },
  ),
);

/** One row per metrics sample, pruned to the retention setting. */
export const hostMetricsHistory = adoptLegacyTable(
  "host_metrics_history",
  defineTable(
    "host_metrics_history",
    {
      id: id(),
      hostId: refHost(),
      ts: timestamp().notNull().defaultNow(),
      cpuPercent: real(),
      memPercent: real(),
      diskPercent: real(),
      netRxBytes: integer(),
      netTxBytes: integer(),
    },
    {
      indexes: [
        {
          name: "idx_host_metrics_history_host_ts",
          columns: ["hostId", "ts"],
        },
      ],
    },
  ),
);

export const tables = [
  hostMetricsPreferences,
  hostHealthChecks,
  hostHealthHistory,
  hostMetricsHistory,
];
