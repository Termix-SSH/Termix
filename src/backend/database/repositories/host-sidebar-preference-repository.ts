import { eq } from "drizzle-orm";
import { hostSidebarPreferences } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturningWhere, updateReturning } from "./returning.js";

export type HostSidebarPreferenceRecord =
  typeof hostSidebarPreferences.$inferSelect;

export class HostSidebarPreferenceRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async findByUserId(
    userId: string,
  ): Promise<HostSidebarPreferenceRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(hostSidebarPreferences)
      .where(eq(hostSidebarPreferences.userId, userId))
      .limit(1);

    return rows[0] ?? null;
  }

  async upsert(
    userId: string,
    data: string,
    now = new Date().toISOString(),
  ): Promise<HostSidebarPreferenceRecord> {
    const existing = await this.findByUserId(userId);

    if (!existing) {
      const rows = await insertReturningWhere(
        this.context,
        hostSidebarPreferences,
        { userId, data, updatedAt: now },
        eq(hostSidebarPreferences.userId, userId),
      );
      await this.afterWrite();
      return rows[0];
    }

    const rows = await updateReturning(
      this.context,
      hostSidebarPreferences,
      { data, updatedAt: now },
      eq(hostSidebarPreferences.userId, userId),
    );
    await this.afterWrite();
    return rows[0];
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(hostSidebarPreferences)
      .where(eq(hostSidebarPreferences.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
