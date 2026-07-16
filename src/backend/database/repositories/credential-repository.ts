import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { sshCredentials, sshCredentialUsage } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { SystemCrypto } from "../../utils/system-crypto.js";

export type CredentialRecord = typeof sshCredentials.$inferSelect;
export type NewCredentialRecord = typeof sshCredentials.$inferInsert;
export type CredentialUpdate = Partial<
  Omit<NewCredentialRecord, "id" | "userId">
>;
export type CredentialSystemEncryptionUpdate = Pick<
  CredentialUpdate,
  "systemPassword" | "systemKey" | "systemKeyPassword" | "updatedAt"
>;

export class CredentialRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async create(credential: NewCredentialRecord): Promise<CredentialRecord> {
    const rows = await this.context.drizzle
      .insert(sshCredentials)
      .values(credential)
      .returning();
    await this.afterWrite();
    return rows[0];
  }

  async createEncryptedForUser(
    userId: string,
    credential: NewCredentialRecord | Record<string, unknown>,
  ): Promise<CredentialRecord> {
    const userDataKey = DataCrypto.validateUserAccess(userId);
    const tempId = credential.id ?? Date.now();
    const dataWithTempId = { ...credential, id: tempId };
    const encryptedCredential = await this.encryptCredentialRecordForWrite(
      dataWithTempId,
      userId,
      userDataKey,
    );

    if (!credential.id) {
      delete (encryptedCredential as Partial<NewCredentialRecord>).id;
    }

    const rows = await this.context.drizzle
      .insert(sshCredentials)
      .values(encryptedCredential as NewCredentialRecord)
      .returning();

    await this.afterWrite();
    return DataCrypto.decryptRecord(
      "ssh_credentials",
      rows[0],
      userId,
      userDataKey,
    );
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

  async findById(credentialId: number): Promise<CredentialRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(sshCredentials)
      .where(eq(sshCredentials.id, credentialId))
      .limit(1);

    return rows[0] ?? null;
  }

  async listByUserId(userId: string): Promise<CredentialRecord[]> {
    return this.context.drizzle
      .select()
      .from(sshCredentials)
      .where(eq(sshCredentials.userId, userId))
      .orderBy(desc(sshCredentials.updatedAt));
  }

  async listMissingSystemEncryptionByUserId(
    userId: string,
  ): Promise<CredentialRecord[]> {
    return this.context.drizzle
      .select()
      .from(sshCredentials)
      .where(
        and(
          eq(sshCredentials.userId, userId),
          or(
            isNull(sshCredentials.systemPassword),
            isNull(sshCredentials.systemKey),
            isNull(sshCredentials.systemKeyPassword),
          ),
        ),
      );
  }

  async existsForImportIdentity(
    userId: string,
    name: string,
    username: string | null,
  ): Promise<boolean> {
    const rows = await this.context.drizzle
      .select({ id: sshCredentials.id })
      .from(sshCredentials)
      .where(
        and(
          eq(sshCredentials.userId, userId),
          eq(sshCredentials.name, name),
          eq(sshCredentials.username, username),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  async findDecryptedByIdForUser(
    userId: string,
    credentialId: number,
  ): Promise<CredentialRecord | null> {
    const row = await this.findByIdForUser(userId, credentialId);
    return this.decryptOne(row, userId);
  }

  async listDecryptedByUserId(userId: string): Promise<CredentialRecord[]> {
    const rows = await this.listByUserId(userId);
    return this.decryptMany(rows, userId);
  }

  async listFolders(userId: string): Promise<string[]> {
    const rows = await this.context.drizzle
      .select({ folder: sshCredentials.folder })
      .from(sshCredentials)
      .where(eq(sshCredentials.userId, userId));

    return [...new Set(rows.map((row) => row.folder).filter(Boolean))].sort();
  }

  async renameFolder(
    userId: string,
    oldName: string,
    newName: string,
  ): Promise<number> {
    const rows = await this.context.drizzle
      .update(sshCredentials)
      .set({ folder: newName })
      .where(
        and(
          eq(sshCredentials.userId, userId),
          eq(sshCredentials.folder, oldName),
        ),
      )
      .returning({ id: sshCredentials.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
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

    await this.afterWrite();
    return rows[0] ?? null;
  }

  async updateEncryptedForUser(
    userId: string,
    credentialId: number,
    update: CredentialUpdate,
  ): Promise<CredentialRecord | null> {
    const userDataKey = DataCrypto.validateUserAccess(userId);
    const encryptedUpdate = await this.encryptCredentialRecordForWrite(
      update,
      userId,
      userDataKey,
    );

    const rows = await this.context.drizzle
      .update(sshCredentials)
      .set(encryptedUpdate)
      .where(
        and(
          eq(sshCredentials.id, credentialId),
          eq(sshCredentials.userId, userId),
        ),
      )
      .returning();

    await this.afterWrite();
    return this.decryptOne(rows[0] ?? null, userId);
  }

  async updateSystemEncryptionForUser(
    userId: string,
    credentialId: number,
    update: CredentialSystemEncryptionUpdate,
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

    if (rows.length > 0) {
      await this.afterWrite();
    }

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

    await this.afterWrite();
    return rows.length > 0;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(sshCredentials)
      .where(eq(sshCredentials.userId, userId))
      .returning({ id: sshCredentials.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
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
    await this.afterWrite();
  }

  private decryptOne<T extends Record<string, unknown>>(
    record: T | null,
    userId: string,
  ): T | null {
    if (!record) return null;
    const userDataKey = DataCrypto.getUserDataKey(userId);
    if (!userDataKey) return null;
    return DataCrypto.decryptRecord(
      "ssh_credentials",
      record,
      userId,
      userDataKey,
    );
  }

  private decryptMany<T extends Record<string, unknown>>(
    records: T[],
    userId: string,
  ): T[] {
    const userDataKey = DataCrypto.getUserDataKey(userId);
    if (!userDataKey) return [];
    return DataCrypto.decryptRecords(
      "ssh_credentials",
      records,
      userId,
      userDataKey,
    );
  }

  private async encryptCredentialRecordForWrite<
    T extends Record<string, unknown>,
  >(record: T, userId: string, userDataKey: Buffer): Promise<T> {
    const encryptedRecord = DataCrypto.encryptRecord(
      "ssh_credentials",
      record,
      userId,
      userDataKey,
    );
    const systemKey =
      await SystemCrypto.getInstance().getCredentialSharingKey();
    const systemEncrypted = await DataCrypto.encryptRecordWithSystemKey(
      "ssh_credentials",
      record,
      systemKey,
    );

    return { ...encryptedRecord, ...systemEncrypted };
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
