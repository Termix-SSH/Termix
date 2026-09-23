import {
  adoptLegacyTable,
  defineTable,
  id,
  integer,
  refHost,
  refUser,
  text,
} from "@termix/plugin-sdk/db";

/**
 * A fleet: a named group of hosts, by static membership or tag rules.
 *
 * Adopted from core's "fleets", so column and index names are the legacy
 * ones: the rename carries the existing rows across.
 */
export const fleets = adoptLegacyTable(
  "fleets",
  defineTable("fleets", {
    id: id(),
    userId: refUser(),
    name: text().notNull(),
    description: text(),
    color: text(),
    icon: text(),
    // JSON array of tag strings, unioned with static members at resolution
    // time. Kept to tag-equality matching for v1.
    tagRules: text(),
    syncId: text().unique(),
    createdAt: text().notNull().defaultNow(),
    updatedAt: text().notNull().defaultNow(),
  }),
);

/**
 * Static fleet membership. A host can also be an effective member through a
 * tag rule match, resolved in the repository rather than stored here.
 *
 * fleetId has no declared refUser/refHost FK: the SDK's referenceable targets
 * are core's users and ssh_data tables only, not another table this same
 * plugin owns. The legacy foreign key to fleets(id) is preserved by the
 * adoption migration's CREATE TABLE, which is why the migration file keeps
 * the FOREIGN KEY clause the generator does not emit for this column.
 */
export const fleetMembers = adoptLegacyTable(
  "fleet_members",
  defineTable(
    "members",
    {
      id: id(),
      fleetId: integer().notNull(),
      hostId: refHost(),
      addedAt: text().notNull().defaultNow(),
    },
    {
      // fleetId leads the unique pair, so listing a fleet's hosts is already
      // served. Finding the fleets a host belongs to starts from hostId.
      uniques: [
        {
          name: "idx_fleet_members_fleet_host",
          columns: ["fleetId", "hostId"],
        },
      ],
      indexes: [{ name: "idx_fleet_members_host", columns: ["hostId"] }],
    },
  ),
);

// Latest-only inventory snapshot per host, overwritten on each refresh - no
// historical log, matching the "latest snapshot only" scope decision.
export const fleetInventory = adoptLegacyTable(
  "fleet_inventory",
  defineTable(
    "inventory",
    {
      id: id(),
      hostId: refHost(),
      userId: refUser(),
      osPrettyName: text(),
      kernel: text(),
      architecture: text(),
      hostname: text(),
      uptimeSeconds: integer(),
      ip: text(),
      packageManager: text(),
      collectedAt: text().notNull().defaultNow(),
    },
    {
      // hostId leads the unique pair; a user's whole inventory reads by userId.
      uniques: [
        { name: "idx_fleet_inventory_host", columns: ["hostId", "userId"] },
      ],
      indexes: [{ name: "idx_fleet_inventory_user", columns: ["userId"] }],
    },
  ),
);

export const tables = [fleets, fleetMembers, fleetInventory];
