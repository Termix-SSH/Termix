import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { auditLogs } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

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

const PRUNE_MAX = 10000;
const PRUNE_TARGET = 9000;

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

  async listDistinctActions(): Promise<string[]> {
    const rows = await this.context.drizzle
      .selectDistinct({ action: auditLogs.action })
      .from(auditLogs)
      .orderBy(asc(auditLogs.action));

    return rows.map((row) => row.action);
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
    const countResult = await this.context.drizzle
      .select({ count: sql<number>`COUNT(*)` })
      .from(auditLogs);
    const count = countResult[0]?.count ?? 0;

    if (count < PRUNE_MAX) {
      return;
    }

    const deleteCount = count - PRUNE_TARGET;
    const rows = await this.context.drizzle
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .orderBy(asc(auditLogs.timestamp))
      .limit(deleteCount);
    const ids = rows.map((row) => row.id);

    if (ids.length > 0) {
      await this.context.drizzle
        .delete(auditLogs)
        .where(inArray(auditLogs.id, ids));
    }
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
