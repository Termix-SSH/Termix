import { eq } from "drizzle-orm";
import { userPreferences } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

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

    const rows = await this.context.drizzle
      .update(userPreferences)
      .set(update)
      .where(eq(userPreferences.userId, userId))
      .returning();
    await this.afterWrite();
    return rows[0];
  }

  async deleteByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .returning({ userId: userPreferences.userId });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
