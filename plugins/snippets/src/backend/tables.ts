import {
  adoptLegacyTable,
  boolean,
  defineTable,
  id,
  integer,
  refUser,
  text,
  timestamp,
  varchar,
} from "@termix/plugin-sdk/db";

export const snippets = adoptLegacyTable(
  "snippets",
  defineTable(
    "snippets",
    {
      id: id(),
      userId: refUser(),
      name: text().notNull(),
      content: text().notNull(),
      description: text(),
      folder: text(),
      order: integer().notNull().default(0),
      syncId: varchar().unique(),
      createdAt: timestamp().notNull().defaultNow(),
      updatedAt: timestamp().notNull().defaultNow(),
      hostFilter: text(),
      isNote: boolean().notNull().default(false),
    },
    { indexes: [{ name: "idx_snippets_user_id", columns: ["userId"] }] },
  ),
);

export const snippetFolders = adoptLegacyTable(
  "snippet_folders",
  defineTable("snippet_folders", {
    id: id(),
    userId: refUser(),
    name: text().notNull(),
    color: text(),
    icon: text(),
    syncId: varchar().unique(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  }),
);

export const snippetAccess = adoptLegacyTable(
  "snippet_access",
  defineTable(
    "snippet_access",
    {
      id: id(),
      snippetId: integer().notNull(),
      userId: varchar(),
      roleId: integer(),
      grantedBy: refUser(),
      permissionLevel: text().notNull().default("view"),
      expiresAt: timestamp(),
      createdAt: timestamp().notNull().defaultNow(),
    },
    {
      indexes: [
        { name: "idx_snippet_access_user_id", columns: ["userId"] },
        { name: "idx_snippet_access_snippet_id", columns: ["snippetId"] },
        { name: "idx_snippet_access_role_id", columns: ["roleId"] },
      ],
    },
  ),
);

export const tables = [snippets, snippetFolders, snippetAccess];
