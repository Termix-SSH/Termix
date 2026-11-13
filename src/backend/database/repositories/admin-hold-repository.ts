import { and, desc, eq, lte } from "drizzle-orm";
import { adminHolds } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";

export type AdminHoldRecord = typeof adminHolds.$inferSelect;
export type NewAdminHoldRecord = typeof adminHolds.$inferInsert;

export type AdminHoldStatus =
  "pending" | "applying" | "applied" | "cancelled" | "failed";

export class AdminHoldRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async create(hold: NewAdminHoldRecord): Promise<void> {
    await this.context.drizzle.insert(adminHolds).values(hold);
    await this.onWrite?.();
  }

  async findById(id: string): Promise<AdminHoldRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(adminHolds)
      .where(eq(adminHolds.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Newest first. */
  async list(limit = 100): Promise<AdminHoldRecord[]> {
    return this.context.drizzle
      .select()
      .from(adminHolds)
      .orderBy(desc(adminHolds.requestedAt))
      .limit(limit);
  }

  async listDue(now: string): Promise<AdminHoldRecord[]> {
    return this.context.drizzle
      .select()
      .from(adminHolds)
      .where(and(eq(adminHolds.status, "pending"), lte(adminHolds.runsAt, now)))
      .orderBy(adminHolds.runsAt);
  }

  /**
   * Moves a hold from one status to another only if it is still in the first
   * one, so two servers or a cancel racing the runner can't both win.
   */
  async transition(
    id: string,
    from: AdminHoldStatus,
    to: AdminHoldStatus,
    fields: {
      decidedBy?: string | null;
      decidedAt?: string;
      error?: string | null;
    } = {},
  ): Promise<boolean> {
    const result = await this.context.drizzle
      .update(adminHolds)
      .set({ status: to, ...fields })
      .where(and(eq(adminHolds.id, id), eq(adminHolds.status, from)));
    const changed = rowsAffected(result) > 0;
    if (changed) await this.onWrite?.();
    return changed;
  }
}
