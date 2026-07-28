import { eq } from "drizzle-orm";
import { userPreferences } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { updateReturning } from "./returning.js";

export type UserPreferenceRecord = typeof userPreferences.$inferSelect;
export type NewUserPreferenceRecord = typeof userPreferences.$inferInsert;
export type UserPreferenceUpdate = Partial<
  Omit<NewUserPreferenceRecord, "userId">
>;

export class UserPreferenceRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async findByUserId(userId: string): Promise<UserPreferenceRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    return rows[0] ?? null;
  }

  async upsert(
    userId: string,
    update: UserPreferenceUpdate,
  ): Promise<UserPreferenceRecord> {
    const existing = await this.findByUserId(userId);

    if (!existing) {
      const rows = await this.context.drizzle
        .insert(userPreferences)
        .values({ userId, ...update })
        .returning();
      await this.afterWrite();
      return rows[0];
    }

    const rows = await updateReturning(
      this.context,
      userPreferences,
      update,
      eq(userPreferences.userId, userId),
    );
    await this.afterWrite();
    return rows[0];
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(userPreferences)
      .where(eq(userPreferences.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
