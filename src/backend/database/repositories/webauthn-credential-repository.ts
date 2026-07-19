import { and, eq } from "drizzle-orm";
import { webauthnCredentials } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export type WebauthnCredentialRecord = typeof webauthnCredentials.$inferSelect;
export type NewWebauthnCredentialRecord =
  typeof webauthnCredentials.$inferInsert;

export interface WebauthnCredentialAuthState {
  counter: number;
  backedUp: boolean;
  deviceType: string | null;
  lastUsedAt: string;
}

export class WebauthnCredentialRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listByUserId(userId: string): Promise<WebauthnCredentialRecord[]> {
    return this.context.drizzle
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, userId));
  }

  async findByCredentialId(
    credentialId: string,
  ): Promise<WebauthnCredentialRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.credentialId, credentialId))
      .limit(1);

    return rows[0] ?? null;
  }

  async create(
    record: NewWebauthnCredentialRecord,
  ): Promise<WebauthnCredentialRecord> {
    const rows = await this.context.drizzle
      .insert(webauthnCredentials)
      .values(record)
      .returning();

    await this.afterWrite();
    return rows[0];
  }

  async updateAuthState(
    id: string,
    state: WebauthnCredentialAuthState,
  ): Promise<void> {
    await this.context.drizzle
      .update(webauthnCredentials)
      .set(state)
      .where(eq(webauthnCredentials.id, id));

    await this.afterWrite();
  }

  async deleteForUser(userId: string, id: string): Promise<boolean> {
    const rows = await this.context.drizzle
      .delete(webauthnCredentials)
      .where(
        and(
          eq(webauthnCredentials.id, id),
          eq(webauthnCredentials.userId, userId),
        ),
      )
      .returning({ id: webauthnCredentials.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length > 0;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
