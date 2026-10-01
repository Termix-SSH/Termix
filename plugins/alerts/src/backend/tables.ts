import {
  adoptLegacyTable,
  boolean,
  defineTable,
  encryptedText,
  id,
  refUser,
  text,
  timestamp,
  varchar,
} from "@termix/plugin-sdk/db";

/**
 * Where a user's alerts go. The config holds webhook URLs, ntfy tokens and
 * email addresses, sealed with ctx.secrets.seal so an alert sent with no
 * acting user (a certificate that failed to renew at night) can still read it.
 * 2.8 kept channels in core's notification_channels; the upgrade copies them
 * here with their ids, which automations' notify steps still name.
 */
export const channels = defineTable(
  "channels",
  {
    id: id(),
    userId: refUser(),
    name: text().notNull(),
    type: varchar(32).notNull(),
    config: encryptedText(),
    enabled: boolean().notNull().default(true),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  { indexes: [{ name: "idx_alerts_channels_user", columns: ["userId"] }] },
);

/** The inbox. One row per recipient, so read state is per user. */
export const items = defineTable(
  "items",
  {
    id: id(),
    userId: refUser(),
    // The plugin that sent it, or "termix" for an announcement.
    source: varchar(64).notNull(),
    category: varchar(128).notNull(),
    severity: varchar(16).notNull(),
    title: text().notNull(),
    body: text(),
    link: text(),
    context: text(),
    dedupeKey: varchar(),
    // What each channel said when the alert was delivered.
    deliveries: text(),
    readAt: timestamp(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  {
    indexes: [
      { name: "idx_alerts_items_user", columns: ["userId", "createdAt"] },
      { name: "idx_alerts_items_unread", columns: ["userId", "readAt"] },
      { name: "idx_alerts_items_dedupe", columns: ["userId", "dedupeKey"] },
    ],
  },
);

/** Which alerts a user sends to which of their channels. */
export const rules = defineTable(
  "rules",
  {
    id: id(),
    userId: refUser(),
    name: text().notNull(),
    // A category pattern: "*", "automations.*" or an exact category.
    pattern: varchar(128).notNull().default("*"),
    minSeverity: varchar(16).notNull().default("warning"),
    channelIds: text().notNull(),
    enabled: boolean().notNull().default(true),
    createdAt: timestamp().notNull().defaultNow(),
  },
  { indexes: [{ name: "idx_alerts_rules_user", columns: ["userId"] }] },
);

/**
 * Announcements a user removed from their inbox, so they are not brought
 * back. Adopted from core's dismissed_alerts, which held the same thing.
 */
export const dismissed = adoptLegacyTable(
  "dismissed_alerts",
  defineTable(
    "dismissed",
    {
      id: id(),
      userId: refUser(),
      alertId: text().notNull(),
      dismissedAt: timestamp().notNull().defaultNow(),
    },
    {
      indexes: [{ name: "idx_dismissed_alerts_user_id", columns: ["userId"] }],
    },
  ),
);

export const tables = [channels, items, rules, dismissed];
