import {
  adoptLegacyTable,
  boolean,
  defineTable,
  id,
  integer,
  real,
  refUser,
  text,
  timestamp,
  varchar,
} from "@termix/plugin-sdk/db";

/*
 * Adopted from core's automation tables, so column and index names are the
 * legacy ones and the rename carries every row across.
 *
 * The links between these tables are plain integers here: the SDK only
 * references users and ssh_data. The adoption migrations keep the legacy
 * FOREIGN KEY clauses by hand, so deleting an automation still cascades. A
 * channel id points into the alerts plugin's table and has no foreign key.
 */

export const automations = adoptLegacyTable(
  "automations",
  defineTable(
    "automations",
    {
      id: id(),
      userId: refUser(),
      name: text().notNull(),
      description: text(),
      enabled: boolean().notNull().default(true),
      // The whole trigger and steps graph, read and written as a unit.
      definition: text().notNull(),
      definitionVersion: integer().notNull().default(1),
      concurrencyPolicy: text().notNull().default("skip"),
      maxRunSeconds: integer().notNull().default(300),
      dryRun: boolean().notNull().default(false),
      lastRunAt: text(),
      lastRunStatus: text(),
      createdAt: timestamp().notNull().defaultNow(),
      updatedAt: timestamp().notNull().defaultNow(),
    },
    {
      indexes: [
        { name: "idx_automations_user", columns: ["userId", "enabled"] },
      ],
    },
  ),
);

/**
 * Durable per-target trigger state, so cooldowns and dwell windows survive a
 * restart. state_key scopes it to what the trigger watches ("<hostId>",
 * "<hostId>:/data", "<hostId>:<container>").
 */
export const triggerState = adoptLegacyTable(
  "automation_trigger_state",
  defineTable(
    "trigger_state",
    {
      id: id(),
      automationId: integer().notNull(),
      stateKey: varchar().notNull(),
      breachStartedAt: text(),
      lastFiredAt: text(),
      lastValue: real(),
      lastObservedState: text(),
      updatedAt: timestamp().notNull().defaultNow(),
    },
    {
      uniques: [
        {
          name: "idx_automation_trigger_state_key",
          columns: ["automationId", "stateKey"],
        },
      ],
    },
  ),
);

export const schedules = adoptLegacyTable(
  "automation_schedules",
  defineTable(
    "schedules",
    {
      id: id(),
      automationId: integer().notNull(),
      cron: text(),
      intervalSeconds: integer(),
      timezone: text(),
      nextDueAt: timestamp(),
      lastTickAt: text(),
    },
    {
      uniques: [
        {
          name: "idx_automation_schedules_automation",
          columns: ["automationId"],
        },
      ],
      indexes: [
        { name: "idx_automation_schedules_due", columns: ["nextDueAt"] },
      ],
    },
  ),
);

export const runs = adoptLegacyTable(
  "automation_runs",
  defineTable(
    "runs",
    {
      id: id(),
      automationId: integer().notNull(),
      userId: refUser(),
      triggerType: text().notNull(),
      triggerContext: text(),
      status: text().notNull(),
      startedAt: timestamp().notNull().defaultNow(),
      finishedAt: text(),
      durationMs: integer(),
      error: text(),
      dryRun: boolean().notNull().default(false),
      // Set when one automation invoked another, so a chain can be traced.
      parentRunId: integer(),
    },
    {
      indexes: [
        {
          name: "idx_automation_runs_automation",
          columns: ["automationId", "startedAt"],
        },
        { name: "idx_automation_runs_user", columns: ["userId", "startedAt"] },
      ],
    },
  ),
);

export const runSteps = adoptLegacyTable(
  "automation_run_steps",
  defineTable(
    "run_steps",
    {
      id: id(),
      runId: integer().notNull(),
      stepIndex: integer().notNull(),
      stepId: text().notNull(),
      stepType: text().notNull(),
      status: text().notNull(),
      startedAt: timestamp().notNull().defaultNow(),
      finishedAt: text(),
      output: text(),
      error: text(),
      truncated: boolean().notNull().default(false),
    },
    {
      indexes: [
        {
          name: "idx_automation_run_steps_run",
          columns: ["runId", "stepIndex"],
        },
      ],
    },
  ),
);

/** Which alert channels an automation is linked to. */
export const channels = adoptLegacyTable(
  "automation_channels",
  defineTable(
    "channels",
    {
      id: id(),
      automationId: integer().notNull(),
      channelId: integer().notNull(),
    },
    {
      uniques: [
        {
          name: "idx_automation_channels_pair",
          columns: ["automationId", "channelId"],
        },
      ],
    },
  ),
);

export const tables = [
  automations,
  triggerState,
  schedules,
  runs,
  runSteps,
  channels,
];
