import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { PluginDatabase, PluginHosts } from "@termix/plugin-sdk/backend";

/* eslint-disable @typescript-eslint/no-explicit-any */
// The tables come from ctx.db.define, which the SDK hands back untyped, and
// the drizzle handle is the server's own. Typed at this module's edge instead.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface FleetRecord {
  id: number;
  userId: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  tagRules: string | null;
  syncId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FleetCreateInput {
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  tagRules?: string[];
}

export interface FleetUpdateInput {
  name?: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  tagRules?: string[];
}

export interface FleetInventoryRecord {
  id: number;
  hostId: number;
  userId: string;
  osPrettyName: string | null;
  kernel: string | null;
  architecture: string | null;
  hostname: string | null;
  uptimeSeconds: number | null;
  ip: string | null;
  packageManager: string | null;
  collectedAt: string;
}

export interface FleetInventoryInput {
  osPrettyName: string | null;
  kernel: string | null;
  architecture: string | null;
  hostname: string | null;
  uptimeSeconds: number | null;
  ip: string | null;
  packageManager: string | null;
}

function parseTagRules(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}

export type FleetRepository = ReturnType<typeof createFleetRepository>;

/**
 * Fleets, membership and inventory, written without RETURNING so it runs the
 * same on all three engines: an insert is read back by its sync id, an
 * update by its own id.
 */
export function createFleetRepository(
  db: PluginDatabase,
  hosts: PluginHosts,
  fleetsTable: Table,
  membersTable: Table,
  inventoryTable: Table,
) {
  const client = () => db.client<Drizzle>();

  async function findById(
    userId: string,
    fleetId: number,
  ): Promise<FleetRecord | null> {
    const drizzle = await client();
    const rows = await drizzle
      .select()
      .from(fleetsTable)
      .where(and(eq(fleetsTable.id, fleetId), eq(fleetsTable.userId, userId)))
      .limit(1);
    return (rows[0] as FleetRecord) ?? null;
  }

  async function findBySyncId(syncId: string): Promise<FleetRecord> {
    const drizzle = await client();
    const rows = await drizzle
      .select()
      .from(fleetsTable)
      .where(eq(fleetsTable.syncId, syncId))
      .limit(1);
    return rows[0] as FleetRecord;
  }

  async function listStaticMemberIds(fleetId: number): Promise<number[]> {
    const drizzle = await client();
    const rows = await drizzle
      .select({ hostId: membersTable.hostId })
      .from(membersTable)
      .where(eq(membersTable.fleetId, fleetId));
    return rows.map((r: { hostId: number }) => r.hostId);
  }

  return {
    async listByUser(userId: string): Promise<FleetRecord[]> {
      const drizzle = await client();
      return drizzle
        .select()
        .from(fleetsTable)
        .where(eq(fleetsTable.userId, userId));
    },

    findById,
    listStaticMemberIds,

    async create(
      userId: string,
      input: FleetCreateInput,
      now = new Date().toISOString(),
    ): Promise<FleetRecord> {
      const syncId = randomUUID();
      const drizzle = await client();
      await drizzle.insert(fleetsTable).values({
        userId,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? null,
        icon: input.icon ?? null,
        tagRules: input.tagRules ? JSON.stringify(input.tagRules) : null,
        syncId,
        createdAt: now,
        updatedAt: now,
      });
      await db.persist();
      return findBySyncId(syncId);
    },

    async update(
      userId: string,
      fleetId: number,
      input: FleetUpdateInput,
      now = new Date().toISOString(),
    ): Promise<FleetRecord | null> {
      const existing = await findById(userId, fleetId);
      if (!existing) return null;

      const drizzle = await client();
      await drizzle
        .update(fleetsTable)
        .set({
          name: input.name ?? existing.name,
          description:
            input.description === undefined
              ? existing.description
              : input.description,
          color: input.color === undefined ? existing.color : input.color,
          icon: input.icon === undefined ? existing.icon : input.icon,
          tagRules:
            input.tagRules === undefined
              ? existing.tagRules
              : JSON.stringify(input.tagRules),
          updatedAt: now,
        })
        .where(
          and(eq(fleetsTable.id, fleetId), eq(fleetsTable.userId, userId)),
        );
      await db.persist();
      return findById(userId, fleetId);
    },

    async delete(userId: string, fleetId: number): Promise<boolean> {
      const existing = await findById(userId, fleetId);
      if (!existing) return false;
      const drizzle = await client();
      await drizzle
        .delete(fleetsTable)
        .where(
          and(eq(fleetsTable.id, fleetId), eq(fleetsTable.userId, userId)),
        );
      await db.persist();
      return true;
    },

    async addMember(
      fleetId: number,
      hostId: number,
      now = new Date().toISOString(),
    ): Promise<void> {
      const drizzle = await client();
      const existing = await drizzle
        .select({ id: membersTable.id })
        .from(membersTable)
        .where(
          and(
            eq(membersTable.fleetId, fleetId),
            eq(membersTable.hostId, hostId),
          ),
        )
        .limit(1);
      if (existing.length > 0) return;

      await drizzle
        .insert(membersTable)
        .values({ fleetId, hostId, addedAt: now });
      await db.persist();
    },

    async removeMember(fleetId: number, hostId: number): Promise<boolean> {
      const drizzle = await client();
      const existing = await drizzle
        .select({ id: membersTable.id })
        .from(membersTable)
        .where(
          and(
            eq(membersTable.fleetId, fleetId),
            eq(membersTable.hostId, hostId),
          ),
        )
        .limit(1);
      if (existing.length === 0) return false;

      await drizzle
        .delete(membersTable)
        .where(
          and(
            eq(membersTable.fleetId, fleetId),
            eq(membersTable.hostId, hostId),
          ),
        );
      await db.persist();
      return true;
    },

    /**
     * Effective membership = static members rows union hosts whose
     * comma-separated tags string intersects any tag in the fleet's
     * tagRules. Both sets are scoped to hosts the fleet owner can see
     * (ctx.hosts.list already resolves owner-only, since a fleet only holds
     * one user's hosts) and deduplicated by id.
     */
    async listEffectiveMembers(userId: string, fleetId: number) {
      const fleet = await findById(userId, fleetId);
      if (!fleet) return [];

      const staticIds = await listStaticMemberIds(fleetId);
      const tagRules = parseTagRules(fleet.tagRules);

      const ownedHosts = (await hosts.list()).filter(
        (host) => host.userId === userId,
      );

      const byId = new Map<number, (typeof ownedHosts)[number]>();
      for (const host of ownedHosts) {
        if (staticIds.includes(host.id)) {
          byId.set(host.id, host);
          continue;
        }
        if (tagRules.length === 0) continue;
        const hostTags = (host.tags ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        if (hostTags.some((tag) => tagRules.includes(tag))) {
          byId.set(host.id, host);
        }
      }

      return Array.from(byId.values());
    },

    async deleteByUserId(userId: string): Promise<number> {
      const drizzle = await client();
      const userFleets = await drizzle
        .select({ id: fleetsTable.id })
        .from(fleetsTable)
        .where(eq(fleetsTable.userId, userId));
      if (userFleets.length === 0) return 0;
      await drizzle.delete(fleetsTable).where(eq(fleetsTable.userId, userId));
      await db.persist();
      return userFleets.length;
    },

    async upsertInventory(
      userId: string,
      hostId: number,
      input: FleetInventoryInput,
      now = new Date().toISOString(),
    ): Promise<FleetInventoryRecord> {
      const drizzle = await client();
      const existing = await drizzle
        .select()
        .from(inventoryTable)
        .where(
          and(
            eq(inventoryTable.hostId, hostId),
            eq(inventoryTable.userId, userId),
          ),
        )
        .limit(1);

      if (existing[0]) {
        await drizzle
          .update(inventoryTable)
          .set({ ...input, collectedAt: now })
          .where(eq(inventoryTable.id, existing[0].id));
        await db.persist();
        const [updated] = await drizzle
          .select()
          .from(inventoryTable)
          .where(eq(inventoryTable.id, existing[0].id))
          .limit(1);
        return updated as FleetInventoryRecord;
      }

      await drizzle
        .insert(inventoryTable)
        .values({ userId, hostId, ...input, collectedAt: now });
      await db.persist();
      const [created] = await drizzle
        .select()
        .from(inventoryTable)
        .where(
          and(
            eq(inventoryTable.hostId, hostId),
            eq(inventoryTable.userId, userId),
          ),
        )
        .limit(1);
      return created as FleetInventoryRecord;
    },

    async listInventoryForHosts(
      userId: string,
      hostIds: number[],
    ): Promise<FleetInventoryRecord[]> {
      if (hostIds.length === 0) return [];
      const drizzle = await client();
      return drizzle
        .select()
        .from(inventoryTable)
        .where(
          and(
            eq(inventoryTable.userId, userId),
            inArray(inventoryTable.hostId, hostIds),
          ),
        );
    },
  };
}
