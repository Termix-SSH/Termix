import { desc, eq, or } from "drizzle-orm";
import { secretSources } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { insertReturning } from "./returning.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { FieldCrypto } from "../../utils/field-crypto.js";

export type SecretSourceRecord = typeof secretSources.$inferSelect;
export type SecretSourceKind = "onepassword-connect";

/** A row with the token still encrypted - safe to hand to the API. */
export type SecretSourcePublic = Omit<SecretSourceRecord, "token"> & {
  hasToken: boolean;
};

export interface SecretSourceCreateInput {
  id: string;
  userId: string;
  name: string;
  kind: SecretSourceKind;
  baseUrl: string;
  token: string;
  shared: boolean;
}

export interface SecretSourceUpdateInput {
  name?: string;
  baseUrl?: string;
  token?: string;
  shared?: boolean;
}

export function toPublicSecretSource(
  row: SecretSourceRecord,
): SecretSourcePublic {
  const { token, ...rest } = row;
  return { ...rest, hasToken: token.length > 0 };
}

/**
 * The token is encrypted with the owner's data key under the row id, like
 * vault_tokens - so a shared source only decrypts while its owner's key is
 * loaded, which the resolver reports as a clear error.
 */
export class SecretSourceRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  private encryptToken(id: string, ownerId: string, token: string): string {
    const key = DataCrypto.validateUserAccess(ownerId);
    return FieldCrypto.encryptField(token, key, id, "token");
  }

  decryptToken(row: SecretSourceRecord): string {
    const key = DataCrypto.getUserDataKey(row.userId);
    if (!key) {
      throw new Error(
        "The secret source owner's data is locked; they need to sign in first",
      );
    }
    return FieldCrypto.decryptField(row.token, key, row.id, "token");
  }

  async listVisibleToUser(userId: string): Promise<SecretSourceRecord[]> {
    return this.context.drizzle
      .select()
      .from(secretSources)
      .where(
        or(eq(secretSources.userId, userId), eq(secretSources.shared, true)),
      )
      .orderBy(desc(secretSources.updatedAt));
  }

  async findById(id: string): Promise<SecretSourceRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(secretSources)
      .where(eq(secretSources.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: SecretSourceCreateInput): Promise<SecretSourceRecord> {
    const [created] = await insertReturning(this.context, secretSources, {
      id: input.id,
      userId: input.userId,
      name: input.name,
      kind: input.kind,
      baseUrl: input.baseUrl,
      token: this.encryptToken(input.id, input.userId, input.token),
      shared: input.shared,
    });
    await this.afterWrite();
    return created;
  }

  async update(
    row: SecretSourceRecord,
    input: SecretSourceUpdateInput,
  ): Promise<void> {
    await this.context.drizzle
      .update(secretSources)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(input.shared !== undefined ? { shared: input.shared } : {}),
        ...(input.token !== undefined
          ? { token: this.encryptToken(row.id, row.userId, input.token) }
          : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(secretSources.id, row.id));
    await this.afterWrite();
  }

  async deleteById(id: string): Promise<void> {
    await this.context.drizzle
      .delete(secretSources)
      .where(eq(secretSources.id, id));
    await this.afterWrite();
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.context.drizzle
      .delete(secretSources)
      .where(eq(secretSources.userId, userId));
    await this.afterWrite();
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
