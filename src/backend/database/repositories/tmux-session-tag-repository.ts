import { and, eq } from "drizzle-orm";
import { tmuxSessionTags } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";

export type TmuxSessionTagRecord = typeof tmuxSessionTags.$inferSelect;

export interface TmuxSessionTagInput {
  userId: string;
  hostId: number;
  sessionName: string;
  tag: string;
}

export class TmuxSessionTagRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listByUserAndHost(
    userId: string,
    hostId: number,
  ): Promise<Map<string, string[]>> {
    const rows = await this.context.drizzle
      .select()
      .from(tmuxSessionTags)
      .where(
        and(
          eq(tmuxSessionTags.userId, userId),
          eq(tmuxSessionTags.hostId, hostId),
        ),
      );

    const bySession = new Map<string, string[]>();
    for (const row of rows) {
      const tags = bySession.get(row.sessionName) ?? [];
      tags.push(row.tag);
      bySession.set(row.sessionName, tags);
    }
    return bySession;
  }

  async renameSessionForHost(
    hostId: number,
    sessionName: string,
    newSessionName: string,
  ): Promise<number> {
    const result = await this.context.drizzle
      .update(tmuxSessionTags)
      .set({ sessionName: newSessionName })
      .where(
        and(
          eq(tmuxSessionTags.hostId, hostId),
          eq(tmuxSessionTags.sessionName, sessionName),
        ),
      );

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  async deleteSessionForHost(
    hostId: number,
    sessionName: string,
  ): Promise<number> {
    const result = await this.context.drizzle
      .delete(tmuxSessionTags)
      .where(
        and(
          eq(tmuxSessionTags.hostId, hostId),
          eq(tmuxSessionTags.sessionName, sessionName),
        ),
      );

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  async replaceForUserHostSession(
    userId: string,
    hostId: number,
    sessionName: string,
    tags: string[],
  ): Promise<number> {
    const result = await this.context.drizzle
      .delete(tmuxSessionTags)
      .where(
        and(
          eq(tmuxSessionTags.userId, userId),
          eq(tmuxSessionTags.hostId, hostId),
          eq(tmuxSessionTags.sessionName, sessionName),
        ),
      );

    if (tags.length > 0) {
      await this.context.drizzle.insert(tmuxSessionTags).values(
        tags.map((tag) => ({
          userId,
          hostId,
          sessionName,
          tag,
        })),
      );
    }

    const changedRows = rowsAffected(result) + tags.length;
    if (changedRows > 0) {
      await this.afterWrite();
    }

    return changedRows;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(tmuxSessionTags)
      .where(eq(tmuxSessionTags.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
