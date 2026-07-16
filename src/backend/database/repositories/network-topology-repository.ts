import { eq } from "drizzle-orm";
import { networkTopology } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export type NetworkTopologyRecord = typeof networkTopology.$inferSelect;

export class NetworkTopologyRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async findByUserId(userId: string): Promise<NetworkTopologyRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(networkTopology)
      .where(eq(networkTopology.userId, userId))
      .limit(1);

    return rows[0] ?? null;
  }

  async upsertForUser(
    userId: string,
    topology: string,
    updatedAt = new Date().toISOString(),
  ): Promise<void> {
    const existing = await this.findByUserId(userId);

    if (existing) {
      await this.context.drizzle
        .update(networkTopology)
        .set({ topology, updatedAt })
        .where(eq(networkTopology.userId, userId));
      await this.afterWrite();
      return;
    }

    await this.context.drizzle.insert(networkTopology).values({
      userId,
      topology,
      updatedAt,
    });
    await this.afterWrite();
  }

  async deleteByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(networkTopology)
      .where(eq(networkTopology.userId, userId))
      .returning({ id: networkTopology.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
