import { and, eq, gt } from "drizzle-orm";
import { syncTombstones } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export type SyncTombstoneRecord = typeof syncTombstones.$inferSelect;

export type SyncEntityType =
  | "hosts"
  | "sshCredentials"
  | "sshFolders"
  | "snippets"
  | "snippetFolders"
  | "vaultProfiles"
  | "dashboardServiceLinks"
  | "homepageItems";

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
    if (since) conditions.push(gt(syncTombstones.deletedAt, since));

    return this.context.drizzle
      .select()
      .from(syncTombstones)
      .where(and(...conditions));
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
