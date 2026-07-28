import { eq, inArray } from "drizzle-orm";
import { users } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected, supportsReturning } from "./mutation-result.js";
import { insertReturning, updateReturning } from "./returning.js";

export type UserRecord = typeof users.$inferSelect;
export type NewUserRecord = typeof users.$inferInsert;
export type UserUpdate = Partial<Omit<NewUserRecord, "id">>;
export type NewFirstLocalUserRecord = Omit<NewUserRecord, "isAdmin">;

export class UserRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listAll(): Promise<UserRecord[]> {
    return this.context.drizzle.select().from(users);
  }

  async findById(id: string): Promise<UserRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return rows[0] ?? null;
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    return rows[0] ?? null;
  }

  async findByOidcIdentifier(
    oidcIdentifier: string,
  ): Promise<UserRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(users)
      .where(eq(users.oidcIdentifier, oidcIdentifier))
      .limit(1);

    return rows[0] ?? null;
  }

  async listByIds(ids: string[]): Promise<UserRecord[]> {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) {
      return [];
    }

    return this.context.drizzle
      .select()
      .from(users)
      .where(inArray(users.id, uniqueIds));
  }

  async create(user: NewUserRecord): Promise<UserRecord> {
    const rows = await insertReturning(this.context, users, user);
    await this.afterWrite();
    return rows[0];
  }

  async createFirstLocalUser(
    user: NewFirstLocalUserRecord,
  ): Promise<{ user: UserRecord; isFirstUser: boolean }> {
    const result = await this.createCheckingIfFirst((isFirstUser) => ({
      ...user,
      isAdmin: isFirstUser,
    }));

    await this.afterWrite();
    return result;
  }

  async createFirstSsoUser(
    user: NewUserRecord,
  ): Promise<{ user: UserRecord; isFirstUser: boolean }> {
    const result = await this.createCheckingIfFirst((isFirstUser) => ({
      ...user,
      isAdmin: isFirstUser || Boolean(user.isAdmin),
    }));

    await this.afterWrite();
    return result;
  }

  /**
   * Creates a user, making them an admin if the table was empty.
   *
   * The check and the insert have to be one transaction: two people signing up
   * at once would otherwise both see an empty table and both become admin.
   *
   * The two branches are not a style choice. better-sqlite3 is synchronous and
   * rejects an async transaction callback outright — "Transaction function
   * cannot return a promise" — so a single body cannot serve both. It fails
   * loudly rather than silently skipping the write, which is the one mercy here.
   */
  private async createCheckingIfFirst(
    build: (isFirstUser: boolean) => NewUserRecord,
  ): Promise<{ user: UserRecord; isFirstUser: boolean }> {
    if (this.context.dialect === "sqlite") {
      return this.context.drizzle.transaction((tx) => {
        const isFirstUser =
          tx.select({ id: users.id }).from(users).all().length === 0;
        const rows = tx
          .insert(users)
          .values(build(isFirstUser))
          .returning()
          .all();
        return { user: rows[0], isFirstUser };
      });
    }

    return this.context.drizzle.transaction(async (tx) => {
      const existing = await tx.select({ id: users.id }).from(users);
      const isFirstUser = existing.length === 0;
      const values = build(isFirstUser);

      if (supportsReturning(this.context.dialect)) {
        const rows = await tx.insert(users).values(values).returning();
        return { user: rows[0], isFirstUser };
      }

      // users is keyed by a text id the caller supplies, so there is something
      // to read back by even without RETURNING.
      await tx.insert(users).values(values);
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, values.id));
      return { user, isFirstUser };
    });
  }

  async update(id: string, update: UserUpdate): Promise<UserRecord | null> {
    const rows = await updateReturning(
      this.context,
      users,
      update,
      eq(users.id, id),
    );

    await this.afterWrite();
    return rows[0] ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(users)
      .where(eq(users.id, id));

    await this.afterWrite();
    return rowsAffected(result) > 0;
  }

  async countAdmins(): Promise<number> {
    const rows = await this.context.drizzle
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isAdmin, true));

    return rows.length;
  }

  async countTotpEnabled(): Promise<number> {
    const rows = await this.context.drizzle
      .select({ id: users.id })
      .from(users)
      .where(eq(users.totpEnabled, true));

    return rows.length;
  }

  async countAll(): Promise<number> {
    const rows = await this.context.drizzle
      .select({ id: users.id })
      .from(users);

    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
