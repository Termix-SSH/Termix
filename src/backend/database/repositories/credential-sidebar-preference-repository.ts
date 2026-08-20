import { eq } from "drizzle-orm";
import { credentialSidebarPreferences } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturningWhere, updateReturning } from "./returning.js";

export type CredentialSidebarPreferenceRecord =
  typeof credentialSidebarPreferences.$inferSelect;

export class CredentialSidebarPreferenceRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async findByUserId(
    userId: string,
  ): Promise<CredentialSidebarPreferenceRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(credentialSidebarPreferences)
      .where(eq(credentialSidebarPreferences.userId, userId))
      .limit(1);

    return rows[0] ?? null;
  }

  async upsert(
    userId: string,
    data: string,
    now = new Date().toISOString(),
  ): Promise<CredentialSidebarPreferenceRecord> {
    const existing = await this.findByUserId(userId);

    if (!existing) {
      const rows = await insertReturningWhere(
        this.context,
        credentialSidebarPreferences,
        { userId, data, updatedAt: now },
        eq(credentialSidebarPreferences.userId, userId),
      );
      await this.afterWrite();
      return rows[0];
    }

    const rows = await updateReturning(
      this.context,
      credentialSidebarPreferences,
      { data, updatedAt: now },
      eq(credentialSidebarPreferences.userId, userId),
    );
    await this.afterWrite();
    return rows[0];
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(credentialSidebarPreferences)
      .where(eq(credentialSidebarPreferences.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
