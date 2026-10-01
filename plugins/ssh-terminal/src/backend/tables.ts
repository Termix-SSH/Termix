import {
  adoptLegacyTable,
  defineTable,
  id,
  refHost,
  refUser,
  text,
  timestamp,
} from "@termix/plugin-sdk/db";

/**
 * Commands typed into terminal sessions, per user and host.
 *
 * Adopted from core's command_history, so the column and index names are the
 * legacy ones: the rename carries the existing rows and index across.
 */
export const commandHistory = adoptLegacyTable(
  "command_history",
  defineTable(
    "command_history",
    {
      id: id(),
      userId: refUser(),
      hostId: refHost(),
      command: text().notNull(),
      executedAt: timestamp().notNull().defaultNow(),
    },
    {
      indexes: [
        {
          name: "idx_command_history_user_host",
          columns: ["userId", "hostId"],
        },
      ],
    },
  ),
);

export const tables = [commandHistory];
