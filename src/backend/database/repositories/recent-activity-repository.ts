import { eq, inArray } from "drizzle-orm";
import { recentActivity } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

export class RecentActivityRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

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
