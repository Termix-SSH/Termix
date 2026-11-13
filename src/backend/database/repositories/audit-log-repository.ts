import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  gt,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  sql,
} from "drizzle-orm";
import { auditLogs, settings } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { formatSqlTimestamp, sqlTimestampDaysAgo } from "./sql-timestamp.js";
import { databaseLogger } from "../../utils/logger.js";
import { countValue, insertedId, rowsAffected } from "./mutation-result.js";
import {
  AUDIT_CHAIN_ANCHOR_KEY,
  AUDIT_CHAIN_GENESIS,
  AUDIT_CHAIN_HEAD_KEY,
  auditRowHash,
  parseChainPoint,
  type AuditChainPoint,
} from "../../utils/audit-chain-hash.js";

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

// 2.9.1 logged these on every background plugin query and pushed real
// entries out of the capped log. They are now audited once per activation.
export const ROUTINE_PLUGIN_AUDIT_ACTIONS = [
  "plugin_db_client",
  "plugin_db_refs",
  "plugin_kv_get",
  "plugin_kv_list",
  "plugin_files_data_dir",
  "plugin_settings_read_core",
];
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
  /**
   * Cached row count backing the cap check. Static because the factory builds
   * a repository per call, so a per-instance count would never survive to be
   * reused. Null means "unknown, re-read", which is also how any path that
   * deletes rows invalidates it.
   */
  private static cachedCount: number | null = null;

  /** Writes in this process run one at a time so each sees the last hash. */
  private static writeQueue: Promise<unknown> = Promise.resolve();

  /** Drops the cached count so a test starts from a known state. */
  static resetPruneThrottleForTests(): void {
    AuditLogRepository.cachedCount = null;
  }

  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async create(
    entry: NewAuditLogRecord,
  ): Promise<{ id: number; hash: string; prevHash: string }> {
    const row = {
      ...entry,
      timestamp: entry.timestamp ?? formatSqlTimestamp(new Date()),
    };
    const run = AuditLogRepository.writeQueue.then(() =>
      this.insertChained(row),
    );
    AuditLogRepository.writeQueue = run.catch(() => undefined);
    const stored = await run;
    await this.pruneIfDue();
    await this.afterWrite();
    return stored;
  }

  /**
   * Inserts one row linked to the newest one. The head settings row is read
   * and written in the same transaction; on Postgres and MySQL the update
   * takes its row lock first, so two servers on one database can't fork the
   * chain.
   */
  private async insertChained(
    row: NewAuditLogRecord & { timestamp: string },
  ): Promise<{ id: number; hash: string; prevHash: string }> {
    const build = (headRaw: string | null) => {
      const prevHash = parseChainPoint(headRaw)?.hash ?? AUDIT_CHAIN_GENESIS;
      return { ...row, prevHash, hash: auditRowHash(prevHash, row) };
    };
    const headValue = (id: number, hash: string) =>
      JSON.stringify({ id, hash, timestamp: row.timestamp });

    if (this.context.dialect === "sqlite") {
      return this.context.drizzle.transaction((tx) => {
        const head = tx
          .select({ value: settings.value })
          .from(settings)
          .where(eq(settings.key, AUDIT_CHAIN_HEAD_KEY))
          .get();
        const values = build(head?.value ?? null);
        const id = insertedId(tx.insert(auditLogs).values(values).run());
        if (id === null) throw new Error("audit insert returned no id");
        const value = headValue(id, values.hash);
        if (head) {
          tx.update(settings)
            .set({ value })
            .where(eq(settings.key, AUDIT_CHAIN_HEAD_KEY))
            .run();
        } else {
          tx.insert(settings)
            .values({ key: AUDIT_CHAIN_HEAD_KEY, value })
            .run();
        }
        return { id, hash: values.hash, prevHash: values.prevHash };
      });
    }

    return this.context.drizzle.transaction(async (tx) => {
      const locked = await tx
        .update(settings)
        .set({ value: sql`${settings.value}` })
        .where(eq(settings.key, AUDIT_CHAIN_HEAD_KEY));
      const exists = rowsAffected(locked) > 0;
      const head = exists
        ? await tx
            .select({ value: settings.value })
            .from(settings)
            .where(eq(settings.key, AUDIT_CHAIN_HEAD_KEY))
            .limit(1)
        : [];
      const values = build(head[0]?.value ?? null);
      let id: number | null;
      if (this.context.dialect === "postgres") {
        // Postgres only branch: RETURNING is fine here, MySQL takes the else.
        // eslint-disable-next-line no-restricted-syntax
        const inserted = await tx
          .insert(auditLogs)
          .values(values)
          .returning({ id: auditLogs.id });
        id = inserted[0]?.id ?? null;
      } else {
        id = insertedId(await tx.insert(auditLogs).values(values));
      }
      if (id === null) throw new Error("audit insert returned no id");
      const value = headValue(id, values.hash);
      if (exists) {
        await tx
          .update(settings)
          .set({ value })
          .where(eq(settings.key, AUDIT_CHAIN_HEAD_KEY));
      } else {
        await tx.insert(settings).values({ key: AUDIT_CHAIN_HEAD_KEY, value });
      }
      return { id, hash: values.hash, prevHash: values.prevHash };
    });
  }

  /** The newest chained row and the last pruned one, as stored. */
  async readChainPoints(): Promise<{
    head: AuditChainPoint | null;
    anchor: AuditChainPoint | null;
  }> {
    const rows = await this.context.drizzle
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(
        inArray(settings.key, [AUDIT_CHAIN_HEAD_KEY, AUDIT_CHAIN_ANCHOR_KEY]),
      );
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    return {
      head: parseChainPoint(byKey.get(AUDIT_CHAIN_HEAD_KEY)),
      anchor: parseChainPoint(byKey.get(AUDIT_CHAIN_ANCHOR_KEY)),
    };
  }

  /** Rows after an id in id order, for walking the chain. */
  async listChainBatch(
    afterId: number,
    limit: number,
  ): Promise<AuditLogRecord[]> {
    return this.context.drizzle
      .select()
      .from(auditLogs)
      .where(gt(auditLogs.id, afterId))
      .orderBy(asc(auditLogs.id))
      .limit(limit);
  }

  async findById(id: number): Promise<AuditLogRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.id, id))
      .limit(1);
    return rows[0] ?? null;
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
      total: countValue(totalResult[0]?.count),
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
    const result = await this.context.drizzle
      .update(auditLogs)
      .set({ userId: null })
      .where(eq(auditLogs.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  async deleteRoutinePluginNoise(): Promise<number> {
    AuditLogRepository.cachedCount = null;
    const result = await this.context.drizzle.delete(auditLogs).where(
      and(
        isNull(auditLogs.userId),
        // Chained rows are never removed from the middle.
        isNull(auditLogs.hash),
        inArray(auditLogs.action, ROUTINE_PLUGIN_AUDIT_ACTIONS),
      ),
    );

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
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

  /**
   * Keeps the two prune passes off the per-write hot path without letting the
   * row cap go unenforced.
   *
   * Both passes used to run inline on every insert: a retention DELETE plus a
   * COUNT over the whole table, thousands of times an hour on a busy install,
   * almost always to find nothing to do, and audit writes sit in the request
   * path of the actions they record.
   *
   * They are split by what they cost and what they guarantee. Retention is
   * time-based, so nothing is lost by checking it on an interval. The row cap
   * is a disk-space guard that has to react to inserts, so it is still checked
   * on the write that crosses it, but against a cached count, so the common
   * case is an integer compare rather than a COUNT.
   */
  private async pruneIfDue(): Promise<void> {
    try {
      // Retention only costs anything on installs that configure it, and the
      // DELETE is driven by idx_audit_logs_timestamp, so it stays on the write
      // path where its "nothing older than N days survives" guarantee holds.
      await this.pruneExpired();
      await this.pruneOverflowIfOverCap();
    } catch (error) {
      // Pruning is maintenance; never fail the write that triggered it.
      databaseLogger.warn("Audit log prune failed", {
        operation: "audit_prune_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Enforces the cap using a cached row count, so a steady stream of writes
   * costs one COUNT to prime and then nothing until the cap is next reached.
   */
  private async pruneOverflowIfOverCap(): Promise<void> {
    const max = auditMaxEntries();

    if (AuditLogRepository.cachedCount === null) {
      AuditLogRepository.cachedCount = await this.countAll();
    } else {
      AuditLogRepository.cachedCount += 1;
    }

    if (AuditLogRepository.cachedCount < max) return;

    // At the cap: re-read for real, since the cached value can drift if rows
    // were deleted by another path (user deletion, manual cleanup).
    AuditLogRepository.cachedCount = await this.countAll();
    if (AuditLogRepository.cachedCount < max) return;

    await this.pruneOverflow();
    AuditLogRepository.cachedCount = await this.countAll();
  }

  private async countAll(): Promise<number> {
    const result = await this.context.drizzle
      .select({ count: sql<number>`COUNT(*)` })
      .from(auditLogs);
    return countValue(result[0]?.count);
  }

  /** Runs the prune regardless of the interval. Exposed for tests and startup. */
  async pruneNow(): Promise<void> {
    await this.pruneExpired();
    await this.pruneOverflow();
    AuditLogRepository.cachedCount = null;
  }

  /** Drops entries past the configured retention window. */
  private async pruneExpired(): Promise<void> {
    const days = auditRetentionDays();
    if (days === null) return;

    const cutoff = sqlTimestampDaysAgo(days);
    // Pruned by id so only the front of the chain ever goes.
    const [last] = await this.context.drizzle
      .select({ id: max(auditLogs.id) })
      .from(auditLogs)
      .where(lt(auditLogs.timestamp, cutoff));
    const lastId = last?.id == null ? null : Number(last.id);
    if (lastId === null) return;
    await this.saveAnchor(lastId);
    const result = await this.context.drizzle
      .delete(auditLogs)
      .where(lte(auditLogs.id, lastId));

    if (rowsAffected(result) > 0) {
      databaseLogger.info(
        `Pruned ${rowsAffected(result)} audit entries past retention`,
        {
          operation: "audit_retention_prune",
          removed: rowsAffected(result),
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
    const count = countValue(countResult[0]?.count);

    if (count < max) return;

    const deleteCount = count - Math.floor(max * PRUNE_TARGET_RATIO);
    const rows = await this.context.drizzle
      .select({ id: auditLogs.id, timestamp: auditLogs.timestamp })
      .from(auditLogs)
      .orderBy(asc(auditLogs.id))
      .limit(deleteCount);
    if (rows.length === 0) return;

    const lastId = rows[rows.length - 1].id;
    await this.saveAnchor(lastId);
    await this.context.drizzle
      .delete(auditLogs)
      .where(lte(auditLogs.id, lastId));

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

  /**
   * Remembers the last row about to be pruned, so the chain still checks out
   * from the first row that stays.
   */
  private async saveAnchor(lastId: number): Promise<void> {
    const [row] = await this.context.drizzle
      .select({ id: auditLogs.id, hash: auditLogs.hash })
      .from(auditLogs)
      .where(and(lte(auditLogs.id, lastId), isNotNull(auditLogs.hash)))
      .orderBy(desc(auditLogs.id))
      .limit(1);
    if (!row?.hash) return;
    const value = JSON.stringify({ id: row.id, hash: row.hash });
    const updated = await this.context.drizzle
      .update(settings)
      .set({ value })
      .where(eq(settings.key, AUDIT_CHAIN_ANCHOR_KEY));
    if (rowsAffected(updated) === 0) {
      await this.context.drizzle
        .insert(settings)
        .values({ key: AUDIT_CHAIN_ANCHOR_KEY, value });
    }
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
