import {
  adoptLegacyTable,
  defineTable,
  id,
  refUser,
  text,
  timestamp,
} from "@termix/plugin-sdk/db";

/**
 * One row per user, holding their saved graph as a JSON blob.
 *
 * Adopted from core's network_topology, so the column names are the legacy
 * ones: the rename carries the existing rows across.
 */
export const graphs = adoptLegacyTable(
  "network_topology",
  defineTable("graphs", {
    id: id(),
    userId: refUser(),
    topology: text(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  }),
);

export const tables = [graphs];
