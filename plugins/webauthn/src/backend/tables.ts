import {
  adoptLegacyTable,
  boolean,
  defineTable,
  integer,
  refUser,
  text,
  timestamp,
  varchar,
} from "@termix/plugin-sdk/db";

/**
 * Adopted from core's webauthn_credentials, so the column names are the
 * legacy ones and the rename carries every passkey across.
 */
export const credentials = adoptLegacyTable(
  "webauthn_credentials",
  defineTable("credentials", {
    id: varchar().primaryKey(),
    userId: refUser(),
    name: text().notNull(),
    credentialId: varchar().notNull().unique(),
    publicKey: text().notNull(),
    counter: integer().notNull().default(0),
    deviceType: text(),
    backedUp: boolean().notNull().default(false),
    transports: text(),
    userVerification: text().notNull().default("preferred"),
    createdAt: timestamp().notNull().defaultNow(),
    lastUsedAt: timestamp(),
  }),
);

export const tables = [credentials];
