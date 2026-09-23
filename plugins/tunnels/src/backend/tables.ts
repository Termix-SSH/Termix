import {
  adoptLegacyTable,
  defineTable,
  id,
  refUser,
  text,
  timestamp,
} from "@termix/plugin-sdk/db";

/**
 * Client tunnel presets the desktop app saves per user.
 *
 * Adopted from core's c2s_tunnel_presets, so the column names are the legacy
 * ones and the rename carries every existing row across. Core never indexed
 * it, so there is no legacy index to keep.
 */
export const presets = adoptLegacyTable(
  "c2s_tunnel_presets",
  defineTable("presets", {
    id: id(),
    userId: refUser(),
    name: text().notNull(),
    // JSON: TunnelConnection[]
    config: text().notNull(),
    platform: text(),
    computerName: text(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  }),
);

export const tables = [presets];
