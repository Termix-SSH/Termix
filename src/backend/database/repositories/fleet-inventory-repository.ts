import { and, eq, inArray } from "drizzle-orm";
import { fleetInventory } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { insertReturning, updateReturning } from "./returning.js";

export type FleetInventoryRecord = typeof fleetInventory.$inferSelect;

export interface FleetInventoryInput {
  osPrettyName: string | null;
  kernel: string | null;
  architecture: string | null;
  hostname: string | null;
  uptimeSeconds: number | null;
  ip: string | null;
  packageManager: string | null;
}

export class FleetInventoryRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async upsert(
    userId: string,
    hostId: number,
    input: FleetInventoryInput,
    now = new Date().toISOString(),
  ): Promise<FleetInventoryRecord> {
    const existing = await this.findOne(userId, hostId);

    if (existing) {
      const [updated] = await updateReturning(
        this.context,
        fleetInventory,
        { ...input, collectedAt: now },
        eq(fleetInventory.id, existing.id),
      );
      await this.afterWrite();
      return updated;
    }

    const [created] = await insertReturning(this.context, fleetInventory, {
      userId,
      hostId,
      ...input,
      collectedAt: now,
    });

    await this.afterWrite();
    return created;
  }

  async findOne(
    userId: string,
    hostId: number,
  ): Promise<FleetInventoryRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(fleetInventory)
      .where(
        and(
          eq(fleetInventory.userId, userId),
          eq(fleetInventory.hostId, hostId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listForHosts(
    userId: string,
    hostIds: number[],
  ): Promise<FleetInventoryRecord[]> {
    if (hostIds.length === 0) return [];
    return this.context.drizzle
      .select()
      .from(fleetInventory)
      .where(
        and(
          eq(fleetInventory.userId, userId),
          inArray(fleetInventory.hostId, hostIds),
        ),
      );
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
