import { and, eq, lte, ne } from "drizzle-orm";
import { sessions } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturning } from "./returning.js";

export type SessionRecord = typeof sessions.$inferSelect;
export type NewSessionRecord = typeof sessions.$inferInsert;

export class SessionRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async create(session: NewSessionRecord): Promise<SessionRecord> {
    const rows = await insertReturning(this.context, sessions, session);
    await this.afterWrite();
    return rows[0];
  }

  async listAll(): Promise<SessionRecord[]> {
    return this.context.drizzle.select().from(sessions);
  }

  async findById(id: string): Promise<SessionRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);

    return rows[0] ?? null;
  }

  async listByUserId(userId: string): Promise<SessionRecord[]> {
    return this.context.drizzle
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId));
  }

  async listExpired(now = new Date()): Promise<SessionRecord[]> {
    return this.context.drizzle
      .select()
      .from(sessions)
      .where(lte(sessions.expiresAt, now.toISOString()));
  }

  async touch(
    id: string,
    lastActiveAt = new Date().toISOString(),
  ): Promise<void> {
    await this.context.drizzle
      .update(sessions)
      .set({ lastActiveAt })
      .where(eq(sessions.id, id));
    await this.afterWrite();
  }

  async updateToken(
    id: string,
    jwtToken: string,
    lastActiveAt = new Date().toISOString(),
  ): Promise<void> {
    await this.context.drizzle
      .update(sessions)
      .set({ jwtToken, lastActiveAt })
      .where(eq(sessions.id, id));
    await this.afterWrite();
  }

  async revoke(id: string): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(sessions)
      .where(eq(sessions.id, id));

    await this.afterWrite();
    return rowsAffected(result) > 0;
  }

  async revokeAllForUser(
    userId: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const where = exceptSessionId
      ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId))
      : eq(sessions.userId, userId);

    const result = await this.context.drizzle.delete(sessions).where(where);

    await this.afterWrite();
    return rowsAffected(result);
  }

  async deleteExpired(now = new Date()): Promise<number> {
    const result = await this.context.drizzle
      .delete(sessions)
      .where(lte(sessions.expiresAt, now.toISOString()));

    await this.afterWrite();
    return rowsAffected(result);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
