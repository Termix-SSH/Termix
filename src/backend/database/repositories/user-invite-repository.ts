import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { userInvites, users } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturning } from "./returning.js";

export type UserInviteRecord = typeof userInvites.$inferSelect;
export type NewUserInviteRecord = typeof userInvites.$inferInsert;

export interface UserInviteListRecord {
  id: string;
  note: string | null;
  roleIds: string | null;
  makeAdmin: boolean;
  maxUses: number;
  uses: number;
  createdBy: string | null;
  createdByUsername: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export class UserInviteRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async create(invite: NewUserInviteRecord): Promise<UserInviteRecord> {
    const rows = await insertReturning(this.context, userInvites, invite);
    await this.afterWrite();
    return rows[0];
  }

  /** Every invite, newest first, without token hashes. */
  async list(): Promise<UserInviteListRecord[]> {
    return this.context.drizzle
      .select({
        id: userInvites.id,
        note: userInvites.note,
        roleIds: userInvites.roleIds,
        makeAdmin: userInvites.makeAdmin,
        maxUses: userInvites.maxUses,
        uses: userInvites.uses,
        createdBy: userInvites.createdBy,
        createdByUsername: users.username,
        createdAt: userInvites.createdAt,
        expiresAt: userInvites.expiresAt,
        revokedAt: userInvites.revokedAt,
      })
      .from(userInvites)
      .leftJoin(users, eq(userInvites.createdBy, users.id))
      .orderBy(desc(userInvites.createdAt));
  }

  async findById(id: string): Promise<UserInviteRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(userInvites)
      .where(eq(userInvites.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByTokenHash(tokenHash: string): Promise<UserInviteRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(userInvites)
      .where(eq(userInvites.tokenHash, tokenHash))
      .limit(1);
    return rows[0] ?? null;
  }

  async revoke(id: string, now = new Date().toISOString()): Promise<boolean> {
    const result = await this.context.drizzle
      .update(userInvites)
      .set({ revokedAt: now })
      .where(and(eq(userInvites.id, id), isNull(userInvites.revokedAt)));
    const changed = rowsAffected(result) > 0;
    if (changed) await this.afterWrite();
    return changed;
  }

  /**
   * Takes one use of the invite. The count only moves while uses are left,
   * so two people racing for the last use can't both get it.
   */
  async claimUse(id: string): Promise<boolean> {
    const result = await this.context.drizzle
      .update(userInvites)
      .set({ uses: sql`${userInvites.uses} + 1` })
      .where(
        and(
          eq(userInvites.id, id),
          isNull(userInvites.revokedAt),
          lt(userInvites.uses, userInvites.maxUses),
        ),
      );
    const claimed = rowsAffected(result) > 0;
    if (claimed) await this.afterWrite();
    return claimed;
  }

  /** Gives a use back when the account could not be made after all. */
  async releaseUse(id: string): Promise<void> {
    await this.context.drizzle
      .update(userInvites)
      .set({ uses: sql`${userInvites.uses} - 1` })
      .where(eq(userInvites.id, id));
    await this.afterWrite();
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
