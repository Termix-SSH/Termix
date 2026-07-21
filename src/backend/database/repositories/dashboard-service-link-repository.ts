import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dashboardServiceLinks } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export type DashboardServiceLinkRecord =
  typeof dashboardServiceLinks.$inferSelect;

export type DashboardServiceLinkUpdate = Partial<{
  label: string;
  url: string;
}>;

export class DashboardServiceLinkRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listByUserId(userId: string): Promise<DashboardServiceLinkRecord[]> {
    return this.context.drizzle
      .select()
      .from(dashboardServiceLinks)
      .where(eq(dashboardServiceLinks.userId, userId))
      .orderBy(asc(dashboardServiceLinks.order), asc(dashboardServiceLinks.id));
  }

  async createForUser(
    userId: string,
    input: { label: string; url: string },
    createdAt = new Date().toISOString(),
  ): Promise<DashboardServiceLinkRecord> {
    const existing = await this.context.drizzle
      .select({ order: dashboardServiceLinks.order })
      .from(dashboardServiceLinks)
      .where(eq(dashboardServiceLinks.userId, userId))
      .orderBy(asc(dashboardServiceLinks.order));
    const nextOrder =
      existing.length > 0 ? existing[existing.length - 1].order + 1 : 0;

    const [created] = await this.context.drizzle
      .insert(dashboardServiceLinks)
      .values({
        syncId: randomUUID(),
        userId,
        label: input.label,
        url: input.url,
        order: nextOrder,
        createdAt,
        updatedAt: createdAt,
      })
      .returning();
    await this.afterWrite();
    return created;
  }

  async findByIdForUser(
    userId: string,
    id: number,
  ): Promise<DashboardServiceLinkRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(dashboardServiceLinks)
      .where(
        and(
          eq(dashboardServiceLinks.id, id),
          eq(dashboardServiceLinks.userId, userId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async updateForUser(
    userId: string,
    id: number,
    updates: DashboardServiceLinkUpdate,
  ): Promise<DashboardServiceLinkRecord | null> {
    const [updated] = await this.context.drizzle
      .update(dashboardServiceLinks)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(dashboardServiceLinks.id, id),
          eq(dashboardServiceLinks.userId, userId),
        ),
      )
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
      .delete(dashboardServiceLinks)
      .where(
        and(
          eq(dashboardServiceLinks.id, id),
          eq(dashboardServiceLinks.userId, userId),
        ),
      )
      .returning({ syncId: dashboardServiceLinks.syncId });

    if (rows.length === 0) return null;
    await this.afterWrite();
    return rows[0];
  }

  async deleteByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(dashboardServiceLinks)
      .where(eq(dashboardServiceLinks.userId, userId))
      .returning({ id: dashboardServiceLinks.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
