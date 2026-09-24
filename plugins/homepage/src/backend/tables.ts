import {
  adoptLegacyTable,
  defineTable,
  id,
  integer,
  refUser,
  text,
  timestamp,
  varchar,
} from "@termix/plugin-sdk/db";

/** One homepage widget tile. folderId points at another row when it sits in a folder. */
export const homepageItems = adoptLegacyTable(
  "homepage_items",
  defineTable(
    "homepage_items",
    {
      id: id(),
      userId: refUser(),
      typeId: text().notNull(),
      title: text(),
      config: text().notNull().default("{}"),
      folderId: integer(),
      syncId: varchar().unique(),
      createdAt: timestamp().notNull().defaultNow(),
      updatedAt: timestamp().notNull().defaultNow(),
    },
    {
      indexes: [{ name: "idx_homepage_items_user_id", columns: ["userId"] }],
    },
  ),
);

/** One canvas layout (widget positions, pan, zoom) per user. */
export const homepageLayouts = adoptLegacyTable(
  "homepage_layouts",
  defineTable("homepage_layouts", {
    id: id(),
    userId: refUser().unique(),
    layout: text().notNull().default("{}"),
    updatedAt: timestamp().notNull().defaultNow(),
  }),
);

/** Clickable dashboard service link buttons. */
export const dashboardServiceLinks = adoptLegacyTable(
  "dashboard_service_links",
  defineTable(
    "dashboard_service_links",
    {
      id: id(),
      userId: refUser(),
      label: text().notNull(),
      url: text().notNull(),
      order: integer().notNull().default(0),
      syncId: varchar().unique(),
      createdAt: timestamp().notNull().defaultNow(),
      updatedAt: timestamp().notNull().defaultNow(),
    },
    {
      indexes: [
        { name: "idx_dashboard_service_links_user_id", columns: ["userId"] },
      ],
    },
  ),
);

export const tables = [homepageItems, homepageLayouts, dashboardServiceLinks];
