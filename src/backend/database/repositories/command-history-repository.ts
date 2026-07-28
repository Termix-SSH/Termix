import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { commandHistory } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";

export type CommandHistoryRecord = typeof commandHistory.$inferSelect;

export class CommandHistoryRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async create(
    userId: string,
    hostId: number,
    command: string,
    executedAt = new Date().toISOString(),
  ): Promise<CommandHistoryRecord> {
    const [created] = await this.context.drizzle
      .insert(commandHistory)
      .values({ userId, hostId, command, executedAt })
      .returning();
    await this.afterWrite();
    return created;
  }

  async listUniqueCommandsForHost(
    userId: string,
    hostId: number,
    limit = 500,
  ): Promise<string[]> {
    const rows = await this.context.drizzle
      .select({
        command: commandHistory.command,
        maxExecutedAt: sql<number>`MAX(${commandHistory.executedAt})`,
      })
      .from(commandHistory)
      .where(
        and(
          eq(commandHistory.userId, userId),
          eq(commandHistory.hostId, hostId),
        ),
      )
      .groupBy(commandHistory.command)
      .orderBy(desc(sql`MAX(${commandHistory.executedAt})`))
      .limit(limit);

    return rows.map((row) => row.command);
  }

  async listCommandsForHost(
    userId: string,
    hostId: number,
    limit = 200,
  ): Promise<string[]> {
    const rows = await this.context.drizzle
      .select({
        id: commandHistory.id,
        command: commandHistory.command,
      })
      .from(commandHistory)
      .where(
        and(
          eq(commandHistory.userId, userId),
          eq(commandHistory.hostId, hostId),
        ),
      )
      .orderBy(desc(commandHistory.executedAt))
      .limit(limit);

    return rows.map((row) => row.command);
  }

  async deleteCommandForHost(
    userId: string,
    hostId: number,
    command: string,
  ): Promise<number> {
    const result = await this.context.drizzle
      .delete(commandHistory)
      .where(
        and(
          eq(commandHistory.userId, userId),
          eq(commandHistory.hostId, hostId),
          eq(commandHistory.command, command),
        ),
      );

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  async deleteByUserAndHost(userId: string, hostId: number): Promise<number> {
    const result = await this.context.drizzle
      .delete(commandHistory)
      .where(
        and(
          eq(commandHistory.userId, userId),
          eq(commandHistory.hostId, hostId),
        ),
      );

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  async deleteByHostId(hostId: number): Promise<number> {
    const result = await this.context.drizzle
      .delete(commandHistory)
      .where(eq(commandHistory.hostId, hostId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  async deleteByHostIds(hostIds: number[]): Promise<number> {
    if (hostIds.length === 0) {
      return 0;
    }

    const result = await this.context.drizzle
      .delete(commandHistory)
      .where(inArray(commandHistory.hostId, hostIds));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(commandHistory)
      .where(eq(commandHistory.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
