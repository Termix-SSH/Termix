import { and, desc, eq, inArray, or } from "drizzle-orm";
import { transferRecent } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

export type TransferRecentRecord = typeof transferRecent.$inferSelect;

export interface TransferRecentDestinationInput {
  sourceHostId: number;
  destHostId: number;
  destPath: string;
  destPathLabel?: string | null;
}

export class TransferRecentRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listByUserId(userId: string): Promise<TransferRecentRecord[]> {
    return this.context.drizzle
      .select()
      .from(transferRecent)
      .where(eq(transferRecent.userId, userId));
  }

  async listBySourceHost(
    userId: string,
    sourceHostId: number,
    limit = 10,
  ): Promise<TransferRecentRecord[]> {
    return this.context.drizzle
      .select()
      .from(transferRecent)
      .where(
        and(
          eq(transferRecent.userId, userId),
          eq(transferRecent.sourceHostId, sourceHostId),
        ),
      )
      .orderBy(desc(transferRecent.lastUsed))
      .limit(limit);
  }

  async upsertForDestination(
    userId: string,
    input: TransferRecentDestinationInput,
    lastUsed = new Date().toISOString(),
  ): Promise<void> {
    const [existing] = await this.context.drizzle
      .select({ id: transferRecent.id })
      .from(transferRecent)
      .where(
        and(
          eq(transferRecent.userId, userId),
          eq(transferRecent.sourceHostId, input.sourceHostId),
          eq(transferRecent.destHostId, input.destHostId),
          eq(transferRecent.destPath, input.destPath),
        ),
      )
      .limit(1);

    if (existing) {
      await this.context.drizzle
        .update(transferRecent)
        .set({ lastUsed })
        .where(eq(transferRecent.id, existing.id));
    } else {
      await this.context.drizzle.insert(transferRecent).values({
        userId,
        sourceHostId: input.sourceHostId,
        destHostId: input.destHostId,
        destPath: input.destPath,
        destPathLabel: input.destPathLabel || input.destPath,
        lastUsed,
      });
    }

    await this.afterWrite();
  }

  async pruneSourceHost(
    userId: string,
    sourceHostId: number,
    keep = 10,
  ): Promise<number> {
    const rows = await this.context.drizzle
      .select({ id: transferRecent.id })
      .from(transferRecent)
      .where(
        and(
          eq(transferRecent.userId, userId),
          eq(transferRecent.sourceHostId, sourceHostId),
        ),
      )
      .orderBy(desc(transferRecent.lastUsed));

    const idsToDelete = rows.slice(keep).map((row) => row.id);
    if (idsToDelete.length === 0) {
      return 0;
    }

    const deleted = await this.context.drizzle
      .delete(transferRecent)
      .where(inArray(transferRecent.id, idsToDelete))
      .returning({ id: transferRecent.id });

    if (deleted.length > 0) {
      await this.afterWrite();
    }

    return deleted.length;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(transferRecent)
      .where(eq(transferRecent.userId, userId))
      .returning({ id: transferRecent.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async deleteByHostId(hostId: number): Promise<number> {
    const rows = await this.context.drizzle
      .delete(transferRecent)
      .where(
        or(
          eq(transferRecent.sourceHostId, hostId),
          eq(transferRecent.destHostId, hostId),
        ),
      )
      .returning({ id: transferRecent.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async deleteByHostIds(hostIds: number[]): Promise<number> {
    if (hostIds.length === 0) {
      return 0;
    }

    const rows = await this.context.drizzle
      .delete(transferRecent)
      .where(
        or(
          inArray(transferRecent.sourceHostId, hostIds),
          inArray(transferRecent.destHostId, hostIds),
        ),
      )
      .returning({ id: transferRecent.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
