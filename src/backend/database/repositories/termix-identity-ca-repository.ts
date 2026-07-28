import { eq } from "drizzle-orm";
import { termixIdentityCa } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import {
  insertedId,
  rowsAffected,
  supportsReturning,
} from "./mutation-result.js";
import { updateReturning } from "./returning.js";

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
    const result = await this.insertThenEncrypt(userId, ca, userDataKey);

    await this.afterWrite();
    return DataCrypto.decryptRecord(
      "termix_identity_ca",
      result,
      userId,
      userDataKey,
    );
  }

  /**
   * Writes a CA in two steps, because the ciphertext depends on the id.
   *
   * The private key is encrypted with the row's own id as context, which does
   * not exist until the row does. So: insert with an empty key, encrypt, update.
   * The empty key must never be observable, hence the transaction.
   *
   * Two branches because better-sqlite3 rejects an async transaction callback —
   * see the same note in UserRepository.
   */
  private async insertThenEncrypt(
    userId: string,
    ca: NewTermixIdentityCaRecord,
    userDataKey: Buffer,
  ): Promise<TermixIdentityCaRecord> {
    const draft = { ...ca, privateKey: "" };

    const seal = (id: number) =>
      DataCrypto.encryptRecord(
        "termix_identity_ca",
        { id, privateKey: ca.privateKey },
        userId,
        userDataKey,
      ).privateKey;

    if (this.context.dialect === "sqlite") {
      return this.context.drizzle.transaction((tx) => {
        const row = tx
          .insert(termixIdentityCa)
          .values(draft)
          .returning()
          .all()[0];
        return tx
          .update(termixIdentityCa)
          .set({ privateKey: seal(row.id) })
          .where(eq(termixIdentityCa.id, row.id))
          .returning()
          .all()[0];
      });
    }

    return this.context.drizzle.transaction(async (tx) => {
      const written = await tx.insert(termixIdentityCa).values(draft);
      const id = supportsReturning(this.context.dialect)
        ? (written as unknown as { id: number }[])[0].id
        : insertedId(written);

      if (id === null || id === undefined) {
        throw new Error("Insert into termix_identity_ca returned no id.");
      }

      await tx
        .update(termixIdentityCa)
        .set({ privateKey: seal(id) })
        .where(eq(termixIdentityCa.id, id));

      const [row] = await tx
        .select()
        .from(termixIdentityCa)
        .where(eq(termixIdentityCa.id, id));
      return row;
    });
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

    const rows = await updateReturning(
      this.context,
      termixIdentityCa,
      {
        ...update,
        ...(encryptedPrivateKey ? { privateKey: encryptedPrivateKey } : {}),
      },
      eq(termixIdentityCa.identityId, identityId),
    );

    await this.afterWrite();
    return this.decryptOne(rows[0] ?? null, userId);
  }

  async deleteByIdentityId(identityId: number): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(termixIdentityCa)
      .where(eq(termixIdentityCa.identityId, identityId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result) > 0;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(termixIdentityCa)
      .where(eq(termixIdentityCa.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
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
