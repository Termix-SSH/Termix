import { and, asc, eq } from "drizzle-orm";
import { termixIdentities, termixIdentityKeys } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export type TermixIdentityRecord = typeof termixIdentities.$inferSelect;
export type NewTermixIdentityRecord = typeof termixIdentities.$inferInsert;
export type TermixIdentityUpdate = Partial<
  Pick<NewTermixIdentityRecord, "handle" | "description" | "updatedAt">
>;

export type TermixIdentityKeyRecord = typeof termixIdentityKeys.$inferSelect;
export type NewTermixIdentityKeyRecord = typeof termixIdentityKeys.$inferInsert;
export type TermixIdentityKeyUpdate = Partial<
  Pick<NewTermixIdentityKeyRecord, "enabled" | "label">
>;

export class TermixIdentityRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async findIdentityForUser(
    userId: string,
  ): Promise<TermixIdentityRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(termixIdentities)
      .where(eq(termixIdentities.userId, userId))
      .limit(1);

    return rows[0] ?? null;
  }

  async findIdentityByHandle(
    handle: string,
  ): Promise<TermixIdentityRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(termixIdentities)
      .where(eq(termixIdentities.handle, handle))
      .limit(1);

    return rows[0] ?? null;
  }

  async isHandleTaken(handle: string): Promise<boolean> {
    const rows = await this.context.drizzle
      .select({ id: termixIdentities.id })
      .from(termixIdentities)
      .where(eq(termixIdentities.handle, handle))
      .limit(1);

    return rows.length > 0;
  }

  async createIdentity(
    identity: NewTermixIdentityRecord,
  ): Promise<TermixIdentityRecord> {
    const rows = await this.context.drizzle
      .insert(termixIdentities)
      .values(identity)
      .returning();

    await this.afterWrite();
    return rows[0];
  }

  async updateIdentityForUser(
    userId: string,
    update: TermixIdentityUpdate,
  ): Promise<TermixIdentityRecord | null> {
    const rows = await this.context.drizzle
      .update(termixIdentities)
      .set(update)
      .where(eq(termixIdentities.userId, userId))
      .returning();

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows[0] ?? null;
  }

  async deleteIdentityForUser(userId: string): Promise<boolean> {
    const rows = await this.context.drizzle
      .delete(termixIdentities)
      .where(eq(termixIdentities.userId, userId))
      .returning({ id: termixIdentities.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length > 0;
  }

  async deleteByUserId(userId: string): Promise<{
    identitiesDeleted: number;
    keysDeleted: number;
  }> {
    const keyRows = await this.context.drizzle
      .delete(termixIdentityKeys)
      .where(eq(termixIdentityKeys.userId, userId))
      .returning({ id: termixIdentityKeys.id });

    const identityRows = await this.context.drizzle
      .delete(termixIdentities)
      .where(eq(termixIdentities.userId, userId))
      .returning({ id: termixIdentities.id });

    if (keyRows.length > 0 || identityRows.length > 0) {
      await this.afterWrite();
    }

    return {
      identitiesDeleted: identityRows.length,
      keysDeleted: keyRows.length,
    };
  }

  async listKeysByIdentityId(
    identityId: number,
  ): Promise<TermixIdentityKeyRecord[]> {
    return this.context.drizzle
      .select()
      .from(termixIdentityKeys)
      .where(eq(termixIdentityKeys.identityId, identityId))
      .orderBy(asc(termixIdentityKeys.id));
  }

  async listEnabledKeysByIdentityId(
    identityId: number,
  ): Promise<TermixIdentityKeyRecord[]> {
    return this.context.drizzle
      .select()
      .from(termixIdentityKeys)
      .where(
        and(
          eq(termixIdentityKeys.identityId, identityId),
          eq(termixIdentityKeys.enabled, true),
        ),
      )
      .orderBy(asc(termixIdentityKeys.id));
  }

  async listLinkedCredentialIds(identityId: number): Promise<number[]> {
    const rows = await this.context.drizzle
      .select({ credentialId: termixIdentityKeys.credentialId })
      .from(termixIdentityKeys)
      .where(
        and(
          eq(termixIdentityKeys.identityId, identityId),
          eq(termixIdentityKeys.enabled, true),
        ),
      );

    return Array.from(
      new Set(
        rows
          .map((row) => row.credentialId)
          .filter(
            (credentialId): credentialId is number => credentialId !== null,
          ),
      ),
    );
  }

  async createKey(
    key: NewTermixIdentityKeyRecord,
  ): Promise<TermixIdentityKeyRecord> {
    const rows = await this.context.drizzle
      .insert(termixIdentityKeys)
      .values(key)
      .returning();

    await this.afterWrite();
    return rows[0];
  }

  async updateKeyForUser(
    userId: string,
    id: number,
    update: TermixIdentityKeyUpdate,
  ): Promise<TermixIdentityKeyRecord | null> {
    const rows = await this.context.drizzle
      .update(termixIdentityKeys)
      .set(update)
      .where(
        and(
          eq(termixIdentityKeys.id, id),
          eq(termixIdentityKeys.userId, userId),
        ),
      )
      .returning();

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows[0] ?? null;
  }

  async deleteKeyForUser(userId: string, id: number): Promise<boolean> {
    const rows = await this.context.drizzle
      .delete(termixIdentityKeys)
      .where(
        and(
          eq(termixIdentityKeys.id, id),
          eq(termixIdentityKeys.userId, userId),
        ),
      )
      .returning({ id: termixIdentityKeys.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length > 0;
  }

  async findKeyForUser(
    userId: string,
    id: number,
  ): Promise<TermixIdentityKeyRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(termixIdentityKeys)
      .where(
        and(
          eq(termixIdentityKeys.id, id),
          eq(termixIdentityKeys.userId, userId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
