import { eq, inArray } from "drizzle-orm";
import { users } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

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
    const rows = await this.context.drizzle
      .insert(users)
      .values(user)
      .returning();
    await this.afterWrite();
    return rows[0];
  }

  async createFirstLocalUser(
    user: NewFirstLocalUserRecord,
  ): Promise<{ user: UserRecord; isFirstUser: boolean }> {
    const result = this.context.drizzle.transaction((tx) => {
      const existingUsers = tx.select({ id: users.id }).from(users).all();
      const isFirstUser = existingUsers.length === 0;
      const rows = tx
        .insert(users)
        .values({ ...user, isAdmin: isFirstUser })
        .returning()
        .all();

      return { user: rows[0], isFirstUser };
    });

    await this.afterWrite();
    return result;
  }

  async update(id: string, update: UserUpdate): Promise<UserRecord | null> {
    const rows = await this.context.drizzle
      .update(users)
      .set(update)
      .where(eq(users.id, id))
      .returning();

    await this.afterWrite();
    return rows[0] ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.context.drizzle
      .delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id });

    await this.afterWrite();
    return rows.length > 0;
  }

  async countAdmins(): Promise<number> {
    const rows = await this.context.drizzle
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isAdmin, true));

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
