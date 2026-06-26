import { and, eq } from "drizzle-orm";
import { hostMetricsPreferences } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

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
      const [updated] = await this.context.drizzle
        .update(hostMetricsPreferences)
        .set({ layout, updatedAt: now })
        .where(eq(hostMetricsPreferences.id, existing.id))
        .returning();

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

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
