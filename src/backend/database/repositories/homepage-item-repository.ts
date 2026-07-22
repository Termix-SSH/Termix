import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { homepageItems } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export type HomepageItemRecord = typeof homepageItems.$inferSelect;

export interface HomepageItemCreateInput {
  typeId: string;
  title: string | null;
  config: string;
}

export type HomepageItemUpdateInput = Partial<{
  title: string | null;
  config: string;
}>;

export class HomepageItemRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listByUserId(userId: string): Promise<HomepageItemRecord[]> {
    return this.context.drizzle
      .select()
      .from(homepageItems)
      .where(eq(homepageItems.userId, userId))
      .orderBy(asc(homepageItems.id));
  }

  async createForUser(
    userId: string,
    input: HomepageItemCreateInput,
    now = new Date().toISOString(),
  ): Promise<HomepageItemRecord> {
    const [created] = await this.context.drizzle
      .insert(homepageItems)
      .values({
        syncId: randomUUID(),
        userId,
        typeId: input.typeId,
        title: input.title,
        config: input.config,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await this.afterWrite();
    return created;
  }

  async findByIdForUser(
    userId: string,
    id: number,
  ): Promise<HomepageItemRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(homepageItems)
      .where(and(eq(homepageItems.id, id), eq(homepageItems.userId, userId)))
      .limit(1);

    return rows[0] ?? null;
  }

  async updateForUser(
    userId: string,
    id: number,
    updates: HomepageItemUpdateInput,
    updatedAt = new Date().toISOString(),
  ): Promise<HomepageItemRecord | null> {
    const [updated] = await this.context.drizzle
      .update(homepageItems)
      .set({ ...updates, updatedAt })
      .where(and(eq(homepageItems.id, id), eq(homepageItems.userId, userId)))
      .returning();

    if (updated) {
      await this.afterWrite();
    }

    return updated ?? null;
  }

  async deleteForUser(
    userId: string,
    id: number,
  ): Promise<{ syncId: string | null } | null> {
    const rows = await this.context.drizzle
      .delete(homepageItems)
      .where(and(eq(homepageItems.id, id), eq(homepageItems.userId, userId)))
      .returning({ syncId: homepageItems.syncId });

    if (rows.length === 0) return null;
    await this.afterWrite();
    return rows[0];
  }

  async deleteByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(homepageItems)
      .where(eq(homepageItems.userId, userId))
      .returning({ id: homepageItems.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
