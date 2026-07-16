import { and, desc, eq } from "drizzle-orm";
import { hostHealthChecks, hostHealthHistory } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

export type HostHealthCheckRecord = typeof hostHealthChecks.$inferSelect;
export type HostHealthHistoryRecord = typeof hostHealthHistory.$inferSelect;

export interface HostHealthResultInput {
  checkId: string;
  ok: boolean;
  latencyMs: number | null;
  detail: string;
}

export class HostHealthRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async findChecksByUserAndHost(
    userId: string,
    hostId: number,
  ): Promise<HostHealthCheckRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(hostHealthChecks)
      .where(
        and(
          eq(hostHealthChecks.userId, userId),
          eq(hostHealthChecks.hostId, hostId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async upsertChecks(
    userId: string,
    hostId: number,
    checks: string,
    intervalSeconds: number,
    now = new Date().toISOString(),
  ): Promise<HostHealthCheckRecord> {
    const existing = await this.findChecksByUserAndHost(userId, hostId);
    if (existing) {
      const [updated] = await this.context.drizzle
        .update(hostHealthChecks)
        .set({ checks, intervalSeconds, updatedAt: now })
        .where(eq(hostHealthChecks.id, existing.id))
        .returning();

      await this.afterWrite();
      return updated;
    }

    const [created] = await this.context.drizzle
      .insert(hostHealthChecks)
      .values({
        userId,
        hostId,
        checks,
        intervalSeconds,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await this.afterWrite();
    return created;
  }

  async recordHistory(
    userId: string,
    hostId: number,
    results: HostHealthResultInput[],
    keep: number,
    now = new Date().toISOString(),
  ): Promise<number> {
    if (results.length === 0) {
      return 0;
    }

    await this.context.drizzle.insert(hostHealthHistory).values(
      results.map((result) => ({
        userId,
        hostId,
        checkId: result.checkId,
        ts: now,
        ok: result.ok,
        latencyMs: result.latencyMs,
        detail: result.detail,
      })),
    );

    this.pruneHistory(userId, hostId, keep);
    await this.afterWrite();
    return results.length;
  }

  async listHistory(
    userId: string,
    hostId: number,
    limit: number,
  ): Promise<HostHealthHistoryRecord[]> {
    return this.context.drizzle
      .select()
      .from(hostHealthHistory)
      .where(
        and(
          eq(hostHealthHistory.userId, userId),
          eq(hostHealthHistory.hostId, hostId),
        ),
      )
      .orderBy(desc(hostHealthHistory.ts))
      .limit(limit);
  }

  async deleteByUserId(userId: string): Promise<{
    checksDeleted: number;
    historyDeleted: number;
  }> {
    const historyRows = await this.context.drizzle
      .delete(hostHealthHistory)
      .where(eq(hostHealthHistory.userId, userId))
      .returning({ id: hostHealthHistory.id });

    const checkRows = await this.context.drizzle
      .delete(hostHealthChecks)
      .where(eq(hostHealthChecks.userId, userId))
      .returning({ id: hostHealthChecks.id });

    if (historyRows.length > 0 || checkRows.length > 0) {
      await this.afterWrite();
    }

    return {
      checksDeleted: checkRows.length,
      historyDeleted: historyRows.length,
    };
  }

  private pruneHistory(userId: string, hostId: number, keep: number): void {
    this.context.sqlite
      ?.prepare(
        `DELETE FROM host_health_history
         WHERE id IN (
           SELECT id FROM host_health_history
           WHERE user_id = ? AND host_id = ?
           AND id NOT IN (
             SELECT id FROM host_health_history
             WHERE user_id = ? AND host_id = ?
             ORDER BY ts DESC LIMIT ?
           )
         )`,
      )
      .run(userId, hostId, userId, hostId, keep);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
