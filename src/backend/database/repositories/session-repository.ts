import crypto from "crypto";
import { and, eq, inArray, lte, ne, notLike } from "drizzle-orm";
import { sessions } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturning } from "./returning.js";
import {
  endSocketSession,
  endUserSocketSessions,
} from "../../auth/socket-sessions.js";

export type SessionRecord = typeof sessions.$inferSelect;
export type NewSessionRecord = typeof sessions.$inferInsert;

const SESSION_ACTIVITY_PERSIST_INTERVAL_MS = 60_000;
const TOKEN_HASH_PREFIX = "sha256:";

/**
 * Sessions are looked up by id, so the token itself is never needed again.
 * Only a hash is kept, so a database copy holds no working logins.
 */
export function hashSessionToken(token: string): string {
  if (token.startsWith(TOKEN_HASH_PREFIX)) return token;
  return (
    TOKEN_HASH_PREFIX + crypto.createHash("sha256").update(token).digest("hex")
  );
}

export class SessionRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
    private readonly onActivity:
      (() => void | Promise<void>) | undefined = onWrite,
  ) {}

  async create(session: NewSessionRecord): Promise<SessionRecord> {
    const rows = await insertReturning(this.context, sessions, {
      ...session,
      jwtToken: hashSessionToken(session.jwtToken),
    });
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

  async findManyByIds(ids: string[]): Promise<SessionRecord[]> {
    if (ids.length === 0) return [];
    return this.context.drizzle
      .select()
      .from(sessions)
      .where(inArray(sessions.id, ids));
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
    minIntervalMs = SESSION_ACTIVITY_PERSIST_INTERVAL_MS,
  ): Promise<boolean> {
    const cutoff = new Date(
      new Date(lastActiveAt).getTime() - minIntervalMs,
    ).toISOString();
    const result = await this.context.drizzle
      .update(sessions)
      .set({ lastActiveAt })
      .where(and(eq(sessions.id, id), lte(sessions.lastActiveAt, cutoff)));

    if (rowsAffected(result) === 0) return false;
    await this.onActivity?.();
    return true;
  }

  async clearRestrictionForUser(userId: string): Promise<void> {
    await this.context.drizzle
      .update(sessions)
      .set({ restriction: null })
      .where(eq(sessions.userId, userId));
    await this.afterWrite();
  }

  async updateToken(
    id: string,
    jwtToken: string,
    lastActiveAt = new Date().toISOString(),
  ): Promise<void> {
    await this.context.drizzle
      .update(sessions)
      .set({ jwtToken: hashSessionToken(jwtToken), lastActiveAt })
      .where(eq(sessions.id, id));
    await this.afterWrite();
  }

  /** Moves a session's expiry, for an API key carrier while its socket is open. */
  async extendExpiry(id: string, expiresAt: string): Promise<void> {
    await this.context.drizzle
      .update(sessions)
      .set({ expiresAt })
      .where(eq(sessions.id, id));
    await this.onActivity?.();
  }

  /** Replaces tokens saved before only hashes were kept. Returns how many. */
  async hashStoredTokens(): Promise<number> {
    const rows = await this.context.drizzle
      .select({ id: sessions.id, jwtToken: sessions.jwtToken })
      .from(sessions)
      .where(notLike(sessions.jwtToken, `${TOKEN_HASH_PREFIX}%`));
    for (const row of rows) {
      await this.context.drizzle
        .update(sessions)
        .set({ jwtToken: hashSessionToken(row.jwtToken) })
        .where(eq(sessions.id, row.id));
    }
    if (rows.length > 0) await this.afterWrite();
    return rows.length;
  }

  async revoke(id: string): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(sessions)
      .where(eq(sessions.id, id));

    endSocketSession(id);
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

    endUserSocketSessions(userId, exceptSessionId);
    await this.afterWrite();
    return rowsAffected(result);
  }

  /** Ends every session on the server except one. Returns how many ended. */
  async revokeAll(exceptSessionId?: string): Promise<number> {
    const rows = await this.context.drizzle
      .select({ id: sessions.id })
      .from(sessions)
      .where(exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined);
    const ids = rows.map((row) => row.id);
    for (let at = 0; at < ids.length; at += 500) {
      await this.context.drizzle
        .delete(sessions)
        .where(inArray(sessions.id, ids.slice(at, at + 500)));
    }
    for (const id of ids) endSocketSession(id);
    if (ids.length > 0) await this.afterWrite();
    return ids.length;
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
