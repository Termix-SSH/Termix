import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { fleets, fleetMembers, hosts } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import {
  deleteReturning,
  insertReturning,
  updateReturning,
} from "./returning.js";

export type FleetRecord = typeof fleets.$inferSelect;
export type FleetMemberHostRecord = typeof hosts.$inferSelect;

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

export class FleetRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listByUser(userId: string): Promise<FleetRecord[]> {
    return this.context.drizzle
      .select()
      .from(fleets)
      .where(eq(fleets.userId, userId));
  }

  async findById(userId: string, fleetId: number): Promise<FleetRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(fleets)
      .where(and(eq(fleets.id, fleetId), eq(fleets.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(
    userId: string,
    input: FleetCreateInput,
    now = new Date().toISOString(),
  ): Promise<FleetRecord> {
    const [created] = await insertReturning(this.context, fleets, {
      userId,
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? null,
      icon: input.icon ?? null,
      tagRules: input.tagRules ? JSON.stringify(input.tagRules) : null,
      syncId: randomUUID(),
      createdAt: now,
      updatedAt: now,
    });

    await this.afterWrite();
    return created;
  }

  async update(
    userId: string,
    fleetId: number,
    input: FleetUpdateInput,
    now = new Date().toISOString(),
  ): Promise<FleetRecord | null> {
    const existing = await this.findById(userId, fleetId);
    if (!existing) return null;

    const [updated] = await updateReturning(
      this.context,
      fleets,
      {
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
      },
      and(eq(fleets.id, fleetId), eq(fleets.userId, userId)),
    );

    await this.afterWrite();
    return updated ?? null;
  }

  async delete(userId: string, fleetId: number): Promise<boolean> {
    const deleted = await deleteReturning(
      this.context,
      fleets,
      and(eq(fleets.id, fleetId), eq(fleets.userId, userId)),
    );

    if (deleted.length > 0) {
      await this.afterWrite();
      return true;
    }
    return false;
  }

  async addMember(
    fleetId: number,
    hostId: number,
    now = new Date().toISOString(),
  ): Promise<void> {
    const existing = await this.context.drizzle
      .select({ id: fleetMembers.id })
      .from(fleetMembers)
      .where(
        and(eq(fleetMembers.fleetId, fleetId), eq(fleetMembers.hostId, hostId)),
      )
      .limit(1);

    if (existing.length > 0) return;

    await this.context.drizzle.insert(fleetMembers).values({
      fleetId,
      hostId,
      addedAt: now,
    });

    await this.afterWrite();
  }

  async removeMember(fleetId: number, hostId: number): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(fleetMembers)
      .where(
        and(eq(fleetMembers.fleetId, fleetId), eq(fleetMembers.hostId, hostId)),
      );

    const affected = rowsAffected(result) > 0;
    if (affected) await this.afterWrite();
    return affected;
  }

  async listStaticMemberIds(fleetId: number): Promise<number[]> {
    const rows = await this.context.drizzle
      .select({ hostId: fleetMembers.hostId })
      .from(fleetMembers)
      .where(eq(fleetMembers.fleetId, fleetId));
    return rows.map((r) => r.hostId);
  }

  /**
   * Effective membership = static fleetMembers rows union hosts whose
   * comma-separated tags string intersects any tag in the fleet's tagRules.
   * Both sets are scoped to the fleet owner's hosts and deduplicated by id.
   */
  async listEffectiveMembers(
    userId: string,
    fleetId: number,
  ): Promise<FleetMemberHostRecord[]> {
    const fleet = await this.findById(userId, fleetId);
    if (!fleet) return [];

    const staticIds = await this.listStaticMemberIds(fleetId);
    const tagRules = parseTagRules(fleet.tagRules);

    const ownedHosts = await this.context.drizzle
      .select()
      .from(hosts)
      .where(eq(hosts.userId, userId));

    const byId = new Map<number, FleetMemberHostRecord>();

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

    // Static members can reference hosts the fleet owner no longer owns
    // (rare, but the FK cascade only fires on host delete, not transfer) -
    // filter those out rather than surface a partial/foreign row.
    return Array.from(byId.values());
  }

  async deleteByUserId(userId: string): Promise<number> {
    const userFleets = await this.listByUser(userId);
    const result = await this.context.drizzle
      .delete(fleets)
      .where(eq(fleets.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }
    return userFleets.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
