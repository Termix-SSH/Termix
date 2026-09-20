import { and, eq, inArray } from "drizzle-orm";
import { credentialAccess, sharedCredentialSecrets } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export type SharedCredentialSecretRecord =
  typeof sharedCredentialSecrets.$inferSelect;
export type NewSharedCredentialSecretRecord =
  typeof sharedCredentialSecrets.$inferInsert;

export class SharedCredentialSecretsRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async upsert(record: NewSharedCredentialSecretRecord): Promise<void> {
    const existing = await this.context.drizzle
      .select({ id: sharedCredentialSecrets.id })
      .from(sharedCredentialSecrets)
      .where(
        and(
          eq(
            sharedCredentialSecrets.credentialAccessId,
            record.credentialAccessId,
          ),
          eq(sharedCredentialSecrets.targetUserId, record.targetUserId),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await this.context.drizzle
        .update(sharedCredentialSecrets)
        .set({ ...record, updatedAt: new Date().toISOString() })
        .where(eq(sharedCredentialSecrets.id, existing[0].id));
    } else {
      await this.context.drizzle.insert(sharedCredentialSecrets).values(record);
    }
    await this.afterWrite();
  }

  /** The recipient's snapshot for a credential, whichever grant produced it. */
  async findForCredentialUser(
    credentialId: number,
    targetUserId: string,
  ): Promise<SharedCredentialSecretRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(sharedCredentialSecrets)
      .where(
        and(
          eq(sharedCredentialSecrets.credentialId, credentialId),
          eq(sharedCredentialSecrets.targetUserId, targetUserId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async deleteForRoleMember(
    roleId: number,
    targetUserId: string,
  ): Promise<void> {
    const grants = await this.context.drizzle
      .select({ id: credentialAccess.id })
      .from(credentialAccess)
      .where(eq(credentialAccess.roleId, roleId));
    if (grants.length === 0) return;
    await this.context.drizzle.delete(sharedCredentialSecrets).where(
      and(
        inArray(
          sharedCredentialSecrets.credentialAccessId,
          grants.map((g) => g.id),
        ),
        eq(sharedCredentialSecrets.targetUserId, targetUserId),
      ),
    );
    await this.afterWrite();
  }

  async deleteByTargetUserId(userId: string): Promise<void> {
    await this.context.drizzle
      .delete(sharedCredentialSecrets)
      .where(eq(sharedCredentialSecrets.targetUserId, userId));
    await this.afterWrite();
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
