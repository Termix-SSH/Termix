import { eq } from "drizzle-orm";
import { termixIdentityCa } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { DataCrypto } from "../../utils/data-crypto.js";

export type TermixIdentityCaRecord = typeof termixIdentityCa.$inferSelect;
export type NewTermixIdentityCaRecord = typeof termixIdentityCa.$inferInsert;
export type TermixIdentityCaUpdate = Partial<
  Pick<
    NewTermixIdentityCaRecord,
    "publicKey" | "privateKey" | "validityDays" | "updatedAt"
  >
>;

export class TermixIdentityCaRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async findPublicByIdentityId(
    identityId: number,
  ): Promise<Pick<
    TermixIdentityCaRecord,
    "publicKey" | "validityDays"
  > | null> {
    const rows = await this.context.drizzle
      .select({
        publicKey: termixIdentityCa.publicKey,
        validityDays: termixIdentityCa.validityDays,
      })
      .from(termixIdentityCa)
      .where(eq(termixIdentityCa.identityId, identityId))
      .limit(1);

    return rows[0] ?? null;
  }

  async findDecryptedByIdentityId(
    userId: string,
    identityId: number,
  ): Promise<TermixIdentityCaRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(termixIdentityCa)
      .where(eq(termixIdentityCa.identityId, identityId))
      .limit(1);

    return this.decryptOne(rows[0] ?? null, userId);
  }

  async createEncryptedForUser(
    userId: string,
    ca: NewTermixIdentityCaRecord,
  ): Promise<TermixIdentityCaRecord> {
    const userDataKey = DataCrypto.validateUserAccess(userId);
    const result = this.context.drizzle.transaction((tx) => {
      const inserted = tx
        .insert(termixIdentityCa)
        .values({ ...ca, privateKey: "" })
        .returning()
        .all();
      const row = inserted[0];
      const encrypted = DataCrypto.encryptRecord(
        "termix_identity_ca",
        { id: row.id, privateKey: ca.privateKey },
        userId,
        userDataKey,
      );

      return tx
        .update(termixIdentityCa)
        .set({ privateKey: encrypted.privateKey })
        .where(eq(termixIdentityCa.id, row.id))
        .returning()
        .all()[0];
    });

    await this.afterWrite();
    return DataCrypto.decryptRecord(
      "termix_identity_ca",
      result,
      userId,
      userDataKey,
    );
  }

  async updateEncryptedForIdentity(
    userId: string,
    identityId: number,
    update: TermixIdentityCaUpdate,
  ): Promise<TermixIdentityCaRecord | null> {
    const existing = await this.findDecryptedByIdentityId(userId, identityId);
    if (!existing) return null;

    const userDataKey = DataCrypto.validateUserAccess(userId);
    const encryptedPrivateKey = update.privateKey
      ? DataCrypto.encryptRecord(
          "termix_identity_ca",
          { id: existing.id, privateKey: update.privateKey },
          userId,
          userDataKey,
        ).privateKey
      : undefined;

    const rows = await this.context.drizzle
      .update(termixIdentityCa)
      .set({
        ...update,
        ...(encryptedPrivateKey ? { privateKey: encryptedPrivateKey } : {}),
      })
      .where(eq(termixIdentityCa.identityId, identityId))
      .returning();

    await this.afterWrite();
    return this.decryptOne(rows[0] ?? null, userId);
  }

  async deleteByIdentityId(identityId: number): Promise<boolean> {
    const rows = await this.context.drizzle
      .delete(termixIdentityCa)
      .where(eq(termixIdentityCa.identityId, identityId))
      .returning({ id: termixIdentityCa.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length > 0;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(termixIdentityCa)
      .where(eq(termixIdentityCa.userId, userId))
      .returning({ id: termixIdentityCa.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  private decryptOne<T extends Record<string, unknown>>(
    record: T | null,
    userId: string,
  ): T | null {
    if (!record) return null;
    const userDataKey = DataCrypto.getUserDataKey(userId);
    if (!userDataKey) return null;
    return DataCrypto.decryptRecord(
      "termix_identity_ca",
      record,
      userId,
      userDataKey,
    );
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
