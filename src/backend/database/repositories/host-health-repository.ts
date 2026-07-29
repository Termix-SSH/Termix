import { and, desc, eq, notInArray } from "drizzle-orm";
import { hostHealthChecks, hostHealthHistory } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturning, updateReturning } from "./returning.js";

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
      const [updated] = await updateReturning(
        this.context,
        hostHealthChecks,
        { checks, intervalSeconds, updatedAt: now },
        eq(hostHealthChecks.id, existing.id),
      );

      await this.afterWrite();
      return updated;
    }

    const [created] = await insertReturning(this.context, hostHealthChecks, {
      userId,
      hostId,
      checks,
      intervalSeconds,
      createdAt: now,
      updatedAt: now,
    });

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

    await this.pruneHistory(userId, hostId, keep);
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
    const historyResult = await this.context.drizzle
      .delete(hostHealthHistory)
      .where(eq(hostHealthHistory.userId, userId));

    const result = await this.context.drizzle
      .delete(hostHealthChecks)
      .where(eq(hostHealthChecks.userId, userId));

    if (rowsAffected(historyResult) > 0 || rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return {
      checksDeleted: rowsAffected(result),
      historyDeleted: rowsAffected(historyResult),
    };
  }

  /** Keeps the newest `keep` rows for the host and drops the rest. */
  private async pruneHistory(
    userId: string,
    hostId: number,
    keep: number,
  ): Promise<void> {
    const scope = and(
      eq(hostHealthHistory.userId, userId),
      eq(hostHealthHistory.hostId, hostId),
    );

    const retained = await this.context.drizzle
      .select({ id: hostHealthHistory.id })
      .from(hostHealthHistory)
      .where(scope)
      .orderBy(desc(hostHealthHistory.ts))
      .limit(keep);

    // Nothing retained means nothing to keep back, so the scope alone is the
    // delete condition.
    await this.context.drizzle.delete(hostHealthHistory).where(
      retained.length
        ? and(
            scope,
            notInArray(
              hostHealthHistory.id,
              retained.map((row) => row.id),
            ),
          )
        : scope,
    );
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
