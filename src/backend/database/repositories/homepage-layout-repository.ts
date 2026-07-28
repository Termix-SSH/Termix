import { eq } from "drizzle-orm";
import { homepageLayouts } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";

export type HomepageLayoutRecord = typeof homepageLayouts.$inferSelect;

export class HomepageLayoutRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async findByUserId(userId: string): Promise<HomepageLayoutRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(homepageLayouts)
      .where(eq(homepageLayouts.userId, userId))
      .limit(1);

    return rows[0] ?? null;
  }

  async upsertForUser(
    userId: string,
    layout: string,
    updatedAt = new Date().toISOString(),
  ): Promise<HomepageLayoutRecord> {
    const existing = await this.findByUserId(userId);

    if (!existing) {
      const [created] = await this.context.drizzle
        .insert(homepageLayouts)
        .values({ userId, layout, updatedAt })
        .returning();
      await this.afterWrite();
      return created;
    }

    const [updated] = await this.context.drizzle
      .update(homepageLayouts)
      .set({ layout, updatedAt })
      .where(eq(homepageLayouts.userId, userId))
      .returning();
    await this.afterWrite();
    return updated;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(homepageLayouts)
      .where(eq(homepageLayouts.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
