import {
  adoptLegacyTable,
  boolean,
  defineTable,
  id,
  refUser,
  text,
  timestamp,
  varchar,
} from "@termix/plugin-sdk/db";

/**
 * Saved tab arrangements, one row per workspace plus one "last_session" row
 * per user that the frontend keeps current.
 *
 * Adopted from core's user_workspaces, so the column and index names are the
 * legacy ones: the rename carries the existing rows and index across.
 */
export const workspaces = adoptLegacyTable(
  "user_workspaces",
  defineTable(
    "workspaces",
    {
      id: id(),
      userId: refUser(),
      name: text().notNull(),
      color: text(),
      icon: text(),
      // "manual" | "last_session"
      kind: text().notNull().default("manual"),
      isDefault: boolean().notNull().default(false),
      // JSON: the shell layout from app.tabs.getLayout
      payload: text().notNull().default("{}"),
      syncId: varchar().unique(),
      createdAt: timestamp().notNull().defaultNow(),
      updatedAt: timestamp().notNull().defaultNow(),
      lastUsedAt: timestamp(),
    },
    {
      indexes: [{ name: "idx_user_workspaces_user_id", columns: ["userId"] }],
    },
  ),
);

export const tables = [workspaces];
