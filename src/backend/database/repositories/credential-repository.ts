import { and, eq, sql } from "drizzle-orm";
import { sshCredentials, sshCredentialUsage } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

export type CredentialRecord = typeof sshCredentials.$inferSelect;
export type NewCredentialRecord = typeof sshCredentials.$inferInsert;
export type CredentialUpdate = Partial<
  Omit<NewCredentialRecord, "id" | "userId">
>;

export class CredentialRepository {
  constructor(private readonly context: DatabaseContext) {}

  async create(credential: NewCredentialRecord): Promise<CredentialRecord> {
    const rows = await this.context.drizzle
      .insert(sshCredentials)
      .values(credential)
      .returning();
    return rows[0];
  }

  async findByIdForUser(
    userId: string,
    credentialId: number,
  ): Promise<CredentialRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(sshCredentials)
      .where(
        and(
          eq(sshCredentials.id, credentialId),
          eq(sshCredentials.userId, userId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async listByUserId(userId: string): Promise<CredentialRecord[]> {
    return this.context.drizzle
      .select()
      .from(sshCredentials)
      .where(eq(sshCredentials.userId, userId));
  }

  async listFolders(userId: string): Promise<string[]> {
    const rows = await this.context.drizzle
      .select({ folder: sshCredentials.folder })
      .from(sshCredentials)
      .where(eq(sshCredentials.userId, userId));

    return [...new Set(rows.map((row) => row.folder).filter(Boolean))].sort();
  }

  async updateForUser(
    userId: string,
    credentialId: number,
    update: CredentialUpdate,
  ): Promise<CredentialRecord | null> {
    const rows = await this.context.drizzle
      .update(sshCredentials)
      .set(update)
      .where(
        and(
          eq(sshCredentials.id, credentialId),
          eq(sshCredentials.userId, userId),
        ),
      )
      .returning();

    return rows[0] ?? null;
  }

  async deleteForUser(userId: string, credentialId: number): Promise<boolean> {
    const rows = await this.context.drizzle
      .delete(sshCredentials)
      .where(
        and(
          eq(sshCredentials.id, credentialId),
          eq(sshCredentials.userId, userId),
        ),
      )
      .returning({ id: sshCredentials.id });

    return rows.length > 0;
  }

  async recordUsage(
    userId: string,
    credentialId: number,
    hostId: number,
    usedAt = new Date().toISOString(),
  ): Promise<void> {
    await this.context.drizzle.insert(sshCredentialUsage).values({
      credentialId,
      hostId,
      userId,
      usedAt,
    });

    await this.context.drizzle
      .update(sshCredentials)
      .set({
        lastUsed: usedAt,
        usageCount: sql`${sshCredentials.usageCount} + 1`,
      })
      .where(
        and(
          eq(sshCredentials.id, credentialId),
          eq(sshCredentials.userId, userId),
        ),
      );
  }
}
