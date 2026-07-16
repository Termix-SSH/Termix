import { and, eq } from "drizzle-orm";
import { sharedCredentials } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

export type SharedCredentialRecord = typeof sharedCredentials.$inferSelect;
export type NewSharedCredentialRecord = typeof sharedCredentials.$inferInsert;
export type SharedCredentialUpdate = Partial<
  Omit<NewSharedCredentialRecord, "id">
>;

export class SharedCredentialRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async existsForHostAccessAndTargetUser(
    hostAccessId: number,
    targetUserId: string,
  ): Promise<boolean> {
    const rows = await this.context.drizzle
      .select({ id: sharedCredentials.id })
      .from(sharedCredentials)
      .where(
        and(
          eq(sharedCredentials.hostAccessId, hostAccessId),
          eq(sharedCredentials.targetUserId, targetUserId),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  async create(
    sharedCredential: NewSharedCredentialRecord,
  ): Promise<SharedCredentialRecord> {
    const rows = await this.context.drizzle
      .insert(sharedCredentials)
      .values(sharedCredential)
      .returning();

    await this.afterWrite();
    return rows[0];
  }

  async findById(id: number): Promise<SharedCredentialRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(sharedCredentials)
      .where(eq(sharedCredentials.id, id))
      .limit(1);

    return rows[0] ?? null;
  }

  async listByOriginalCredentialId(
    credentialId: number,
  ): Promise<SharedCredentialRecord[]> {
    return this.context.drizzle
      .select()
      .from(sharedCredentials)
      .where(eq(sharedCredentials.originalCredentialId, credentialId));
  }

  async listPendingByTargetUserId(
    userId: string,
  ): Promise<SharedCredentialRecord[]> {
    return this.context.drizzle
      .select()
      .from(sharedCredentials)
      .where(
        and(
          eq(sharedCredentials.targetUserId, userId),
          eq(sharedCredentials.needsReEncryption, true),
        ),
      );
  }

  async updateById(
    id: number,
    update: SharedCredentialUpdate,
  ): Promise<SharedCredentialRecord | null> {
    const rows = await this.context.drizzle
      .update(sharedCredentials)
      .set(update)
      .where(eq(sharedCredentials.id, id))
      .returning();

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows[0] ?? null;
  }

  async markNeedsReEncryptionByOriginalCredentialId(
    credentialId: number,
  ): Promise<number> {
    const rows = await this.context.drizzle
      .update(sharedCredentials)
      .set({ needsReEncryption: true })
      .where(eq(sharedCredentials.originalCredentialId, credentialId))
      .returning({ id: sharedCredentials.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async deleteByOriginalCredentialId(credentialId: number): Promise<number> {
    const rows = await this.context.drizzle
      .delete(sharedCredentials)
      .where(eq(sharedCredentials.originalCredentialId, credentialId))
      .returning({ id: sharedCredentials.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async deleteByTargetUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(sharedCredentials)
      .where(eq(sharedCredentials.targetUserId, userId))
      .returning({ id: sharedCredentials.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
