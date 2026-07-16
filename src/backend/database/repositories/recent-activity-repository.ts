import { desc, eq, inArray } from "drizzle-orm";
import { recentActivity } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

export type RecentActivityRecord = typeof recentActivity.$inferSelect;
export type NewRecentActivityRecord = typeof recentActivity.$inferInsert;

export class RecentActivityRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listByUserId(
    userId: string,
    limit: number,
  ): Promise<RecentActivityRecord[]> {
    return this.context.drizzle
      .select()
      .from(recentActivity)
      .where(eq(recentActivity.userId, userId))
      .orderBy(desc(recentActivity.timestamp))
      .limit(limit);
  }

  async create(
    activity: NewRecentActivityRecord,
  ): Promise<RecentActivityRecord> {
    const rows = await this.context.drizzle
      .insert(recentActivity)
      .values(activity)
      .returning();

    await this.afterWrite();
    return rows[0];
  }

  async trimUserActivity(userId: string, keepCount: number): Promise<number> {
    const rows = await this.context.drizzle
      .select({ id: recentActivity.id })
      .from(recentActivity)
      .where(eq(recentActivity.userId, userId))
      .orderBy(desc(recentActivity.timestamp));

    const idsToDelete = rows
      .slice(keepCount)
      .map((row) => row.id)
      .filter((id) => typeof id === "number");

    if (idsToDelete.length === 0) {
      return 0;
    }

    const deletedRows = await this.context.drizzle
      .delete(recentActivity)
      .where(inArray(recentActivity.id, idsToDelete))
      .returning({ id: recentActivity.id });

    if (deletedRows.length > 0) {
      await this.afterWrite();
    }

    return deletedRows.length;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(recentActivity)
      .where(eq(recentActivity.userId, userId))
      .returning({ id: recentActivity.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async deleteByHostId(hostId: number): Promise<number> {
    const rows = await this.context.drizzle
      .delete(recentActivity)
      .where(eq(recentActivity.hostId, hostId))
      .returning({ id: recentActivity.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async deleteByHostIds(hostIds: number[]): Promise<number> {
    if (hostIds.length === 0) {
      return 0;
    }

    const rows = await this.context.drizzle
      .delete(recentActivity)
      .where(inArray(recentActivity.hostId, hostIds))
      .returning({ id: recentActivity.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
