import { eq, and } from "drizzle-orm";
import { apiKeys, users } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

export type ApiKeyRecord = typeof apiKeys.$inferSelect;
export type NewApiKeyRecord = typeof apiKeys.$inferInsert;

export interface ApiKeyListRecord {
  id: string;
  name: string;
  userId: string;
  username: string | null;
  tokenPrefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  isActive: boolean;
}

export class ApiKeyRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async create(apiKey: NewApiKeyRecord): Promise<ApiKeyRecord> {
    const rows = await this.context.drizzle
      .insert(apiKeys)
      .values(apiKey)
      .returning();
    await this.afterWrite();
    return rows[0];
  }

  async listAllWithUsers(): Promise<ApiKeyListRecord[]> {
    return this.context.drizzle
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        userId: apiKeys.userId,
        username: users.username,
        tokenPrefix: apiKeys.tokenPrefix,
        createdAt: apiKeys.createdAt,
        expiresAt: apiKeys.expiresAt,
        lastUsedAt: apiKeys.lastUsedAt,
        isActive: apiKeys.isActive,
      })
      .from(apiKeys)
      .leftJoin(users, eq(apiKeys.userId, users.id))
      .orderBy(apiKeys.createdAt);
  }

  async findById(id: string): Promise<ApiKeyRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, id))
      .limit(1);

    return rows[0] ?? null;
  }

  async listActiveByTokenPrefix(tokenPrefix: string): Promise<ApiKeyRecord[]> {
    return this.context.drizzle
      .select()
      .from(apiKeys)
      .where(
        and(eq(apiKeys.tokenPrefix, tokenPrefix), eq(apiKeys.isActive, true)),
      );
  }

  async updateLastUsedAt(id: string, lastUsedAt: string): Promise<void> {
    await this.context.drizzle
      .update(apiKeys)
      .set({ lastUsedAt })
      .where(eq(apiKeys.id, id));
    await this.afterWrite();
  }

  async delete(id: string): Promise<ApiKeyRecord | null> {
    const rows = await this.context.drizzle
      .delete(apiKeys)
      .where(eq(apiKeys.id, id))
      .returning();

    await this.afterWrite();
    return rows[0] ?? null;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .returning({ id: apiKeys.id });

    await this.afterWrite();
    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
