import {
  adoptLegacyTable,
  boolean,
  defineTable,
  refUser,
  text,
  timestamp,
  varchar,
} from "@termix/plugin-sdk/db";

/**
 * Adopted from core's secret_sources, so column and index names are the
 * legacy ones and the rename carries every row across.
 *
 * The access token is not a column here: it lives in ctx.secrets under
 * "source:<id>", the same move the ai plugin made for provider API keys. A
 * 2.8 database still has a token column, which the boot migration empties
 * after moving the value.
 */
export const sources = adoptLegacyTable(
  "secret_sources",
  defineTable(
    "sources",
    {
      id: varchar().primaryKey(),
      userId: refUser(),
      name: text().notNull(),
      // "onepassword-connect" for now; the reference syntax is per kind.
      kind: text().notNull().default("onepassword-connect"),
      baseUrl: text().notNull(),
      // Visible to every user; the token still decrypts with the owner's key.
      shared: boolean().notNull().default(false),
      createdAt: timestamp().notNull().defaultNow(),
      updatedAt: timestamp().notNull().defaultNow(),
    },
    {
      indexes: [{ name: "idx_secret_sources_user", columns: ["userId"] }],
    },
  ),
);

export const tables = [sources];
