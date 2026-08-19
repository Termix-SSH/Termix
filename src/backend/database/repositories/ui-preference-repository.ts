import { eq } from "drizzle-orm";
import { uiPreferences } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturningWhere, updateReturning } from "./returning.js";

export type UiPreferenceRecord = typeof uiPreferences.$inferSelect;

export class UiPreferenceRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async findByUserId(userId: string): Promise<UiPreferenceRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(uiPreferences)
      .where(eq(uiPreferences.userId, userId))
      .limit(1);

    return rows[0] ?? null;
  }

  async upsert(
    userId: string,
    data: string,
    now = new Date().toISOString(),
  ): Promise<UiPreferenceRecord> {
    const existing = await this.findByUserId(userId);

    if (!existing) {
      const rows = await insertReturningWhere(
        this.context,
        uiPreferences,
        { userId, data, updatedAt: now },
        eq(uiPreferences.userId, userId),
      );
      await this.afterWrite();
      return rows[0];
    }

    const rows = await updateReturning(
      this.context,
      uiPreferences,
      { data, updatedAt: now },
      eq(uiPreferences.userId, userId),
    );
    await this.afterWrite();
    return rows[0];
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(uiPreferences)
      .where(eq(uiPreferences.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
