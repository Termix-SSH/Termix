import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import {
  operationApprovals,
  operationEvents,
  operationRuns,
} from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { countValue, rowsAffected } from "./mutation-result.js";

export type OperationRunRecord = typeof operationRuns.$inferSelect;
export type NewOperationRunRecord = typeof operationRuns.$inferInsert;
export type OperationApprovalRecord = typeof operationApprovals.$inferSelect;
export type NewOperationApprovalRecord = typeof operationApprovals.$inferInsert;
export type OperationEventRecord = typeof operationEvents.$inferSelect;
export type NewOperationEventRecord = typeof operationEvents.$inferInsert;

export interface OperationRunFilters {
  userId?: string;
  /** Rows also visible because the viewer owns the host. */
  orHostIds?: number[];
  hostId?: number;
  actionId?: string;
  status?: string;
  batchId?: string;
  before?: string;
}

const MAX_PAGE = 200;

export class OperationRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async insertRun(run: NewOperationRunRecord): Promise<void> {
    await this.context.drizzle.insert(operationRuns).values(run);
    await this.onWrite?.();
  }

  async findRun(id: string): Promise<OperationRunRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(operationRuns)
      .where(eq(operationRuns.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByIdempotencyKey(
    userId: string,
    key: string,
  ): Promise<OperationRunRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(operationRuns)
      .where(
        and(
          eq(operationRuns.userId, userId),
          eq(operationRuns.idempotencyKey, key),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listRuns(
    filters: OperationRunFilters,
    limit = 50,
  ): Promise<OperationRunRecord[]> {
    const owner = filters.userId
      ? filters.orHostIds?.length
        ? or(
            eq(operationRuns.userId, filters.userId),
            inArray(operationRuns.hostId, filters.orHostIds),
          )
        : eq(operationRuns.userId, filters.userId)
      : undefined;
    const conditions = [
      owner,
      filters.hostId !== undefined
        ? eq(operationRuns.hostId, filters.hostId)
        : undefined,
      filters.actionId
        ? eq(operationRuns.actionId, filters.actionId)
        : undefined,
      filters.status ? eq(operationRuns.status, filters.status) : undefined,
      filters.batchId ? eq(operationRuns.batchId, filters.batchId) : undefined,
      filters.before ? lt(operationRuns.createdAt, filters.before) : undefined,
    ].filter((condition) => condition !== undefined);
    return this.context.drizzle
      .select()
      .from(operationRuns)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(operationRuns.createdAt))
      .limit(Math.min(Math.max(limit, 1), MAX_PAGE));
  }

  /** Moves a run on only from the status given, so two writers cannot race. */
  async updateRunFrom(
    id: string,
    fromStatus: string,
    patch: Partial<NewOperationRunRecord>,
  ): Promise<boolean> {
    const result = await this.context.drizzle
      .update(operationRuns)
      .set(patch)
      .where(
        and(eq(operationRuns.id, id), eq(operationRuns.status, fromStatus)),
      );
    await this.onWrite?.();
    return rowsAffected(result) > 0;
  }

  /** Anything still running when the server stopped has an unknown outcome. */
  async markRunningInterrupted(finishedAt: string): Promise<number> {
    const result = await this.context.drizzle
      .update(operationRuns)
      .set({
        status: "interrupted",
        finishedAt,
        sealedInput: null,
        error: "The server stopped during this run. Check the host.",
      })
      .where(eq(operationRuns.status, "running"));
    await this.onWrite?.();
    return rowsAffected(result);
  }

  async insertApproval(approval: NewOperationApprovalRecord): Promise<void> {
    await this.context.drizzle.insert(operationApprovals).values(approval);
    await this.onWrite?.();
  }

  async findApproval(id: string): Promise<OperationApprovalRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(operationApprovals)
      .where(eq(operationApprovals.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findApprovalForRun(
    runId: string,
  ): Promise<OperationApprovalRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(operationApprovals)
      .where(eq(operationApprovals.runId, runId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listPendingApprovals(limit = 100): Promise<OperationApprovalRecord[]> {
    return this.context.drizzle
      .select()
      .from(operationApprovals)
      .where(eq(operationApprovals.status, "pending"))
      .orderBy(desc(operationApprovals.createdAt))
      .limit(Math.min(Math.max(limit, 1), MAX_PAGE));
  }

  /** One shot: only the first decision on a pending row wins. */
  async decideApproval(
    id: string,
    status: "approved" | "rejected" | "expired",
    decidedBy: string | null,
    comment: string | null,
    decidedAt: string,
  ): Promise<boolean> {
    const result = await this.context.drizzle
      .update(operationApprovals)
      .set({ status, decidedBy, comment, decidedAt })
      .where(
        and(
          eq(operationApprovals.id, id),
          eq(operationApprovals.status, "pending"),
        ),
      );
    await this.onWrite?.();
    return rowsAffected(result) > 0;
  }

  async listExpiredApprovals(now: string): Promise<OperationApprovalRecord[]> {
    return this.context.drizzle
      .select()
      .from(operationApprovals)
      .where(
        and(
          eq(operationApprovals.status, "pending"),
          lt(operationApprovals.expiresAt, now),
        ),
      )
      .limit(MAX_PAGE);
  }

  async insertEvent(event: NewOperationEventRecord): Promise<void> {
    await this.context.drizzle.insert(operationEvents).values(event);
    await this.onWrite?.();
  }

  async listEvents(
    filters: { hostId?: number; before?: string },
    limit = 50,
  ): Promise<OperationEventRecord[]> {
    const conditions = [
      filters.hostId !== undefined
        ? eq(operationEvents.hostId, filters.hostId)
        : undefined,
      filters.before
        ? lt(operationEvents.createdAt, filters.before)
        : undefined,
    ].filter((condition) => condition !== undefined);
    return this.context.drizzle
      .select()
      .from(operationEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(operationEvents.createdAt))
      .limit(Math.min(Math.max(limit, 1), MAX_PAGE));
  }

  /** Drops rows older than the cutoff, finished runs only. */
  async prune(before: string): Promise<number> {
    const runs = await this.context.drizzle
      .delete(operationRuns)
      .where(
        and(
          lt(operationRuns.createdAt, before),
          sql`${operationRuns.status} NOT IN ('running', 'pending_approval')`,
        ),
      );
    const events = await this.context.drizzle
      .delete(operationEvents)
      .where(lt(operationEvents.createdAt, before));
    await this.onWrite?.();
    return rowsAffected(runs) + rowsAffected(events);
  }

  async countRuns(): Promise<number> {
    const rows = await this.context.drizzle
      .select({ value: sql<number>`count(*)` })
      .from(operationRuns);
    return countValue(rows[0]?.value);
  }

  /** History outlives the account, but the name goes with it. */
  async anonymizeUser(userId: string): Promise<void> {
    await this.context.drizzle
      .update(operationRuns)
      .set({ username: "deleted user" })
      .where(eq(operationRuns.userId, userId));
    await this.onWrite?.();
  }
}
