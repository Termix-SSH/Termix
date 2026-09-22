import { and, eq } from "drizzle-orm";
import { syncTombstones } from "../db/schema.js";
import { timestampAtOrAfter } from "../sync-timestamp.js";
import type { DatabaseContext } from "./database-context.js";

export type SyncTombstoneRecord = typeof syncTombstones.$inferSelect;

/**
 * The wire name of a synced entity.
 *
 * A string rather than a union: the set is whatever core and the installed
 * plugins have registered, so it cannot be known at compile time. The column
 * was already free-form text with no enum constraint, so nothing in the
 * database changes. sync.ts validates a name through the registry before it
 * reaches a query.
 */
export type SyncEntityType = string;

export class SyncTombstoneRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async record(
    userId: string,
    entityType: SyncEntityType,
    syncId: string,
  ): Promise<void> {
    if (!syncId) return;
    await this.context.drizzle.insert(syncTombstones).values({
      userId,
      entityType,
      syncId,
    });
    await this.afterWrite();
  }

  async recordMany(
    userId: string,
    entityType: SyncEntityType,
    syncIds: string[],
  ): Promise<void> {
    const rows = syncIds.filter(Boolean);
    if (rows.length === 0) return;
    await this.context.drizzle
      .insert(syncTombstones)
      .values(rows.map((syncId) => ({ userId, entityType, syncId })));
    await this.afterWrite();
  }

  async listSince(
    userId: string,
    entityType: SyncEntityType,
    since: string | null,
  ): Promise<SyncTombstoneRecord[]> {
    const conditions = [
      eq(syncTombstones.userId, userId),
      eq(syncTombstones.entityType, entityType),
    ];
    if (since)
      conditions.push(timestampAtOrAfter(syncTombstones.deletedAt, since));

    return this.context.drizzle
      .select()
      .from(syncTombstones)
      .where(and(...conditions));
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
