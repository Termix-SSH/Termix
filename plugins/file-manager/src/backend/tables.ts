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
 * The paths and hosts a user recently opened in the file manager.
 *
 * Adopted from core's file_manager_recent, so the column and index names are
 * the legacy ones: the rename carries the existing rows and index across.
 */
export const recent = adoptLegacyTable(
  "file_manager_recent",
  defineTable(
    "recent",
    {
      id: id(),
      userId: refUser(),
      hostId: refHost(),
      name: text().notNull(),
      path: text().notNull(),
      lastOpened: timestamp().notNull().defaultNow(),
    },
    {
      indexes: [
        { name: "idx_file_manager_recent_user", columns: ["userId", "hostId"] },
      ],
    },
  ),
);

/** Paths a user pinned for quick access on a host. */
export const pinned = adoptLegacyTable(
  "file_manager_pinned",
  defineTable(
    "pinned",
    {
      id: id(),
      userId: refUser(),
      hostId: refHost(),
      name: text().notNull(),
      path: text().notNull(),
      pinnedAt: timestamp().notNull().defaultNow(),
    },
    {
      indexes: [
        {
          name: "idx_file_manager_pinned_user",
          columns: ["userId", "hostId"],
        },
      ],
    },
  ),
);

/** Named folder shortcuts a user saved on a host. */
export const shortcuts = adoptLegacyTable(
  "file_manager_shortcuts",
  defineTable(
    "shortcuts",
    {
      id: id(),
      userId: refUser(),
      hostId: refHost(),
      name: text().notNull(),
      path: text().notNull(),
      createdAt: timestamp().notNull().defaultNow(),
    },
    {
      indexes: [
        {
          name: "idx_file_manager_shortcuts_user",
          columns: ["userId", "hostId"],
        },
      ],
    },
  ),
);

/** Recently used destinations for host-to-host transfers. */
export const transferRecent = adoptLegacyTable(
  "transfer_recent",
  defineTable(
    "transfer_recent",
    {
      id: id(),
      userId: refUser(),
      sourceHostId: refHost(),
      destHostId: refHost(),
      destPath: text().notNull(),
      destPathLabel: text().notNull(),
      lastUsed: timestamp().notNull().defaultNow(),
    },
    {
      indexes: [{ name: "idx_transfer_recent_user", columns: ["userId"] }],
    },
  ),
);

export const tables = [recent, pinned, shortcuts, transferRecent];
