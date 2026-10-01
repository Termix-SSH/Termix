import {
  boolean,
  defineTable,
  id,
  integer,
  text,
  timestamp,
} from "@termix/plugin-sdk/db";

/**
 * LDAP directories. Rows from 2.8 are copied in from sso_providers by core's
 * boot migration, keeping their ids, because identities point at them.
 */
export const providers = defineTable("providers", {
  id: id(),
  name: text().notNull(),
  enabled: boolean().notNull().default(true),
  displayOrder: integer().notNull().default(0),
  config: text().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
});

export const tables = [providers];
