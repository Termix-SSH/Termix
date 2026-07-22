import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { hostAccess, hosts } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { DataCrypto } from "../../utils/data-crypto.js";

export type HostRecord = typeof hosts.$inferSelect;
export type NewHostRecord = typeof hosts.$inferInsert;
export type HostUpdate = Partial<Omit<NewHostRecord, "id" | "userId">>;
export interface HostBulkUpdateState {
  id: number;
  statsConfig: string | null;
  credentialId: number | null;
  proxmoxConfig: string | null;
}

export class HostRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async create(host: NewHostRecord): Promise<HostRecord> {
    const rows = await this.context.drizzle
      .insert(hosts)
      .values({ syncId: randomUUID(), ...host })
      .returning();
    await this.afterWrite();
    return rows[0];
  }

  async createEncryptedForUser(
    userId: string,
    host: NewHostRecord | Record<string, unknown>,
  ): Promise<HostRecord> {
    const userDataKey = DataCrypto.validateUserAccess(userId);
    const tempId = host.id ?? Date.now();
    const dataWithTempId = {
      syncId: randomUUID(),
      ...host,
      id: tempId,
    };
    const encryptedHost = DataCrypto.encryptRecord(
      "ssh_data",
      dataWithTempId,
      userId,
      userDataKey,
    );

    if (!host.id) {
      delete (encryptedHost as Partial<NewHostRecord>).id;
    }

    const rows = await this.context.drizzle
      .insert(hosts)
      .values(encryptedHost as NewHostRecord)
      .returning();

    await this.afterWrite();
    return DataCrypto.decryptRecord("ssh_data", rows[0], userId, userDataKey);
  }

  async findById(id: number): Promise<HostRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(hosts)
      .where(eq(hosts.id, id))
      .limit(1);

    return rows[0] ?? null;
  }

  async findByIdForUser(
    userId: string,
    hostId: number,
  ): Promise<HostRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(hosts)
      .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId)))
      .limit(1);

    return rows[0] ?? null;
  }

  async findDecryptedByIdAs(
    userId: string,
    hostId: number,
  ): Promise<HostRecord | null> {
    const row = await this.findById(hostId);
    if (!row) return null;

    const userDataKey = DataCrypto.getUserDataKey(userId);
    if (!userDataKey) return null;

    return DataCrypto.decryptRecord("ssh_data", row, userId, userDataKey);
  }

  async listProxmoxEnabled(): Promise<
    Pick<HostRecord, "id" | "userId" | "proxmoxConfig">[]
  > {
    return this.context.drizzle
      .select({
        id: hosts.id,
        userId: hosts.userId,
        proxmoxConfig: hosts.proxmoxConfig,
      })
      .from(hosts)
      .where(eq(hosts.enableProxmox, true));
  }

  async listByUserId(userId: string): Promise<HostRecord[]> {
    return this.context.drizzle
      .select()
      .from(hosts)
      .where(eq(hosts.userId, userId));
  }

  async listDecryptedByUserId(userId: string): Promise<HostRecord[]> {
    const rows = await this.listByUserId(userId);
    const userDataKey = DataCrypto.getUserDataKey(userId);
    if (!userDataKey) return [];
    return DataCrypto.decryptRecords("ssh_data", rows, userId, userDataKey);
  }

  async existsForImportIdentity(
    userId: string,
    ip: string,
    port: number,
    username: string,
  ): Promise<boolean> {
    const rows = await this.context.drizzle
      .select({ id: hosts.id })
      .from(hosts)
      .where(
        and(
          eq(hosts.userId, userId),
          eq(hosts.ip, ip),
          eq(hosts.port, port),
          eq(hosts.username, username),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  async updateForUser(
    userId: string,
    hostId: number,
    update: HostUpdate,
  ): Promise<HostRecord | null> {
    const rows = await this.context.drizzle
      .update(hosts)
      .set(update)
      .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId)))
      .returning();

    await this.afterWrite();
    return rows[0] ?? null;
  }

  async updateEncryptedForUser(
    userId: string,
    hostId: number,
    update: HostUpdate,
  ): Promise<HostRecord | null> {
    const userDataKey = DataCrypto.validateUserAccess(userId);
    const encryptedUpdate = DataCrypto.encryptRecord(
      "ssh_data",
      update,
      userId,
      userDataKey,
    );

    const rows = await this.context.drizzle
      .update(hosts)
      .set(encryptedUpdate)
      .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId)))
      .returning();

    await this.afterWrite();
    return rows[0]
      ? DataCrypto.decryptRecord("ssh_data", rows[0], userId, userDataKey)
      : null;
  }

  async listBulkUpdateState(
    userId: string,
    hostIds: number[],
  ): Promise<HostBulkUpdateState[]> {
    if (hostIds.length === 0) {
      return [];
    }

    return this.context.drizzle
      .select({
        id: hosts.id,
        statsConfig: hosts.statsConfig,
        credentialId: hosts.credentialId,
        proxmoxConfig: hosts.proxmoxConfig,
      })
      .from(hosts)
      .where(and(inArray(hosts.id, hostIds), eq(hosts.userId, userId)));
  }

  async updateManyForUser(
    userId: string,
    hostIds: number[],
    update: HostUpdate,
  ): Promise<number> {
    if (hostIds.length === 0 || Object.keys(update).length === 0) {
      return 0;
    }

    const rows = await this.context.drizzle
      .update(hosts)
      .set(update)
      .where(and(inArray(hosts.id, hostIds), eq(hosts.userId, userId)))
      .returning({ id: hosts.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async deleteForUser(
    userId: string,
    hostId: number,
  ): Promise<{ syncId: string | null } | null> {
    await this.deleteAccessForHost(hostId);

    const rows = await this.context.drizzle
      .delete(hosts)
      .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId)))
      .returning({ syncId: hosts.syncId });

    await this.afterWrite();
    return rows[0] ?? null;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(hosts)
      .where(eq(hosts.userId, userId))
      .returning({ id: hosts.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async deleteAccessForHost(hostId: number): Promise<number> {
    const rows = await this.context.drizzle
      .delete(hostAccess)
      .where(eq(hostAccess.hostId, hostId))
      .returning({ id: hostAccess.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
