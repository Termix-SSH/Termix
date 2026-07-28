import { and, eq } from "drizzle-orm";
import { hostMetricsPreferences, hosts } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { updateReturning } from "./returning.js";

export type HostMetricsPreferenceRecord =
  typeof hostMetricsPreferences.$inferSelect;

export class HostMetricsPreferenceRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async findByUserAndHost(
    userId: string,
    hostId: number,
  ): Promise<HostMetricsPreferenceRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(hostMetricsPreferences)
      .where(
        and(
          eq(hostMetricsPreferences.userId, userId),
          eq(hostMetricsPreferences.hostId, hostId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async upsertLayout(
    userId: string,
    hostId: number,
    layout: string,
    now = new Date().toISOString(),
  ): Promise<HostMetricsPreferenceRecord> {
    const existing = await this.findByUserAndHost(userId, hostId);
    if (existing) {
      const [updated] = await updateReturning(
        this.context,
        hostMetricsPreferences,
        { layout, updatedAt: now },
        eq(hostMetricsPreferences.id, existing.id),
      );

      await this.afterWrite();
      return updated;
    }

    const [created] = await this.context.drizzle
      .insert(hostMetricsPreferences)
      .values({
        userId,
        hostId,
        layout,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await this.afterWrite();
    return created;
  }

  async updateHostStatsConfig(
    userId: string,
    hostId: number,
    statsConfig: string,
  ): Promise<boolean> {
    const result = await this.context.drizzle
      .update(hosts)
      .set({ statsConfig })
      .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId)));

    if (rowsAffected(result) === 0) return false;
    await this.afterWrite();
    return true;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(hostMetricsPreferences)
      .where(eq(hostMetricsPreferences.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
