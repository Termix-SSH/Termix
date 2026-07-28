import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { auditLogs } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { sqlTimestampDaysAgo } from "./sql-timestamp.js";
import { databaseLogger } from "../../utils/logger.js";

export type AuditLogRecord = typeof auditLogs.$inferSelect;
export type NewAuditLogRecord = typeof auditLogs.$inferInsert;

export type AuditLogFilters = {
  userId?: string;
  action?: string;
  resourceType?: string;
  success?: boolean;
  startDate?: string;
  endDate?: string;
};

export type AuditLogPage = {
  logs: AuditLogRecord[];
  total: number;
};

export const AUDIT_RETENTION_DAYS_ENV = "AUDIT_LOG_RETENTION_DAYS";
export const AUDIT_MAX_ENTRIES_ENV = "AUDIT_LOG_MAX_ENTRIES";

const DEFAULT_MAX_ENTRIES = 10000;
const PRUNE_TARGET_RATIO = 0.9;

function positiveIntEnv(key: string, env: NodeJS.ProcessEnv): number | null {
  const raw = Number(env[key]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
}

/**
 * How long entries are kept. Unset means "no time limit", in which case only
 * the row cap applies.
 */
export function auditRetentionDays(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  return positiveIntEnv(AUDIT_RETENTION_DAYS_ENV, env);
}

/** Hard ceiling on stored entries, so a busy install cannot fill the disk. */
export function auditMaxEntries(env: NodeJS.ProcessEnv = process.env): number {
  return positiveIntEnv(AUDIT_MAX_ENTRIES_ENV, env) ?? DEFAULT_MAX_ENTRIES;
}

export class AuditLogRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async create(entry: NewAuditLogRecord): Promise<void> {
    await this.context.drizzle.insert(auditLogs).values(entry);
    await this.pruneIfNeeded();
    await this.afterWrite();
  }

  async listPage(input: {
    filters: AuditLogFilters;
    limit: number;
    offset: number;
  }): Promise<AuditLogPage> {
    const whereClause = this.buildWhere(input.filters);

    const [logs, totalResult] = await Promise.all([
      this.context.drizzle
        .select()
        .from(auditLogs)
        .where(whereClause)
        .orderBy(desc(auditLogs.timestamp))
        .limit(input.limit)
        .offset(input.offset),
      this.context.drizzle
        .select({ count: sql<number>`COUNT(*)` })
        .from(auditLogs)
        .where(whereClause),
    ]);

    return {
      logs,
      total: totalResult[0]?.count ?? 0,
    };
  }

  /**
   * Reads matching entries in ascending time order for export.
   *
   * Paged rather than fetched whole so an export cannot pull an unbounded
   * result set into memory, and ascending so a resumed or appended export
   * continues where the previous one stopped.
   */
  async listForExport(input: {
    filters: AuditLogFilters;
    limit: number;
    offset: number;
  }): Promise<AuditLogRecord[]> {
    return this.context.drizzle
      .select()
      .from(auditLogs)
      .where(this.buildWhere(input.filters))
      .orderBy(asc(auditLogs.timestamp), asc(auditLogs.id))
      .limit(input.limit)
      .offset(input.offset);
  }

  async listDistinctActions(): Promise<string[]> {
    const rows = await this.context.drizzle
      .selectDistinct({ action: auditLogs.action })
      .from(auditLogs)
      .orderBy(asc(auditLogs.action));

    return rows.map((row) => row.action);
  }

  /**
   * Detaches entries from a user being deleted instead of removing them.
   *
   * The schema already relaxed this foreign key to ON DELETE SET NULL, but the
   * account-deletion path deletes the rows explicitly, which undoes that. An
   * audit trail that vanishes with the account it recorded cannot answer the
   * question it exists for, and offboarding is exactly when that question gets
   * asked. `username` is denormalised, so the entry stays attributable.
   */
  async anonymizeByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .update(auditLogs)
      .set({ userId: null })
      .where(eq(auditLogs.userId, userId))
      .returning({ id: auditLogs.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(auditLogs)
      .where(eq(auditLogs.userId, userId))
      .returning({ id: auditLogs.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  private buildWhere(filters: AuditLogFilters) {
    const conditions = [];

    if (filters.userId) conditions.push(eq(auditLogs.userId, filters.userId));
    if (filters.action) conditions.push(eq(auditLogs.action, filters.action));
    if (filters.resourceType) {
      conditions.push(eq(auditLogs.resourceType, filters.resourceType));
    }
    if (filters.success !== undefined) {
      conditions.push(eq(auditLogs.success, filters.success));
    }
    if (filters.startDate) {
      conditions.push(gte(auditLogs.timestamp, filters.startDate));
    }
    if (filters.endDate) {
      conditions.push(lte(auditLogs.timestamp, filters.endDate));
    }

    return conditions.length > 0 ? and(...conditions) : undefined;
  }

  private async pruneIfNeeded(): Promise<void> {
    await this.pruneExpired();
    await this.pruneOverflow();
  }

  /** Drops entries past the configured retention window. */
  private async pruneExpired(): Promise<void> {
    const days = auditRetentionDays();
    if (days === null) return;

    const cutoff = sqlTimestampDaysAgo(days);
    const rows = await this.context.drizzle
      .delete(auditLogs)
      .where(lt(auditLogs.timestamp, cutoff))
      .returning({ id: auditLogs.id });

    if (rows.length > 0) {
      databaseLogger.info(
        `Pruned ${rows.length} audit entries past retention`,
        {
          operation: "audit_retention_prune",
          removed: rows.length,
          retentionDays: days,
          cutoff,
        },
      );
    }
  }

  /**
   * Enforces the row cap. Unlike retention this discards entries that are still
   * within the window, so it is reported as a warning: it means the ceiling is
   * too low for how much this install audits, and evidence is being lost.
   */
  private async pruneOverflow(): Promise<void> {
    const max = auditMaxEntries();
    const countResult = await this.context.drizzle
      .select({ count: sql<number>`COUNT(*)` })
      .from(auditLogs);
    const count = countResult[0]?.count ?? 0;

    if (count < max) return;

    const deleteCount = count - Math.floor(max * PRUNE_TARGET_RATIO);
    const rows = await this.context.drizzle
      .select({ id: auditLogs.id, timestamp: auditLogs.timestamp })
      .from(auditLogs)
      .orderBy(asc(auditLogs.timestamp))
      .limit(deleteCount);
    if (rows.length === 0) return;

    await this.context.drizzle.delete(auditLogs).where(
      inArray(
        auditLogs.id,
        rows.map((row) => row.id),
      ),
    );

    databaseLogger.warn(
      `Audit log hit its ${max}-entry cap; discarded ${rows.length} entries`,
      {
        operation: "audit_overflow_prune",
        removed: rows.length,
        maxEntries: max,
        oldestRemoved: rows[0]?.timestamp,
        newestRemoved: rows[rows.length - 1]?.timestamp,
        hint: `Raise ${AUDIT_MAX_ENTRIES_ENV}, or set ${AUDIT_RETENTION_DAYS_ENV} and export older entries before they are dropped.`,
      },
    );
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
