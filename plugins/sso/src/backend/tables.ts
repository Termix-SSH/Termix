import {
  adoptLegacyTable,
  boolean,
  defineTable,
  id,
  integer,
  text,
  timestamp,
} from "@termix/plugin-sdk/db";

/**
 * Adopted from core's sso_providers, so the column names are the legacy ones
 * and the rename carries every provider across. LDAP rows are moved out to
 * the ldap plugin by core's boot migration; until then they are ignored here.
 */
export const providers = adoptLegacyTable(
  "sso_providers",
  defineTable("providers", {
    id: id(),
    name: text().notNull(),
    type: text().notNull(),
    enabled: boolean().notNull().default(true),
    displayOrder: integer().notNull().default(0),
    config: text().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
    // Providers from before 2.9 keep sending the old redirect URI.
    legacyCallback: boolean().notNull().default(false),
  }),
);

export const tables = [providers];
