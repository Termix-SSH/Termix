import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { hostAccess, hosts } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { rowsAffected } from "./mutation-result.js";
import {
  deleteReturning,
  insertReturning,
  updateReturning,
} from "./returning.js";

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
    const rows = await insertReturning(this.context, hosts, {
      syncId: randomUUID(),
      ...host,
    });
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

    const rows = await insertReturning(
      this.context,
      hosts,
      encryptedHost as NewHostRecord,
    );

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
    const rows = await updateReturning(
      this.context,
      hosts,
      { ...update, updatedAt: sql`CURRENT_TIMESTAMP` },
      and(eq(hosts.id, hostId), eq(hosts.userId, userId)),
    );

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

    const rows = await updateReturning(
      this.context,
      hosts,
      { ...encryptedUpdate, updatedAt: sql`CURRENT_TIMESTAMP` },
      and(eq(hosts.id, hostId), eq(hosts.userId, userId)),
    );

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

    const result = await this.context.drizzle
      .update(hosts)
      .set({ ...update, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(inArray(hosts.id, hostIds), eq(hosts.userId, userId)));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  /**
   * Sets a distinct manual sortOrder per host (drag-to-reorder). Unlike
   * updateManyForUser, each id gets its own value, so this is one UPDATE per
   * row rather than a single set-for-all-matching-ids statement.
   */
  async reorderForUser(
    userId: string,
    positions: { id: number; sortOrder: number }[],
  ): Promise<number> {
    if (positions.length === 0) return 0;

    let affected: number;
    if (this.context.dialect === "sqlite") {
      /* eslint-disable no-restricted-syntax -- sqlite-only branch: the dialect
         is checked directly above, and better-sqlite3 rejects an async
         transaction callback, so this cannot use the shared async helpers. */
      affected = this.context.drizzle.transaction((tx) => {
        let count = 0;
        for (const { id, sortOrder } of positions) {
          const result = tx
            .update(hosts)
            .set({ sortOrder, updatedAt: sql`CURRENT_TIMESTAMP` })
            .where(and(eq(hosts.id, id), eq(hosts.userId, userId)))
            .run();
          count += rowsAffected(result);
        }
        return count;
      });
      /* eslint-enable no-restricted-syntax */
    } else {
      affected = await this.context.drizzle.transaction(async (tx) => {
        let count = 0;
        for (const { id, sortOrder } of positions) {
          const result = await tx
            .update(hosts)
            .set({ sortOrder, updatedAt: sql`CURRENT_TIMESTAMP` })
            .where(and(eq(hosts.id, id), eq(hosts.userId, userId)));
          count += rowsAffected(result);
        }
        return count;
      });
    }

    if (affected > 0) {
      await this.afterWrite();
    }

    return affected;
  }

  async deleteForUser(
    userId: string,
    hostId: number,
  ): Promise<{ syncId: string | null } | null> {
    await this.deleteAccessForHost(hostId);

    const rows = await deleteReturning(
      this.context,
      hosts,
      and(eq(hosts.id, hostId), eq(hosts.userId, userId)),
    );

    await this.afterWrite();
    return rows[0] ? { syncId: rows[0].syncId } : null;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(hosts)
      .where(eq(hosts.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  async deleteAccessForHost(hostId: number): Promise<number> {
    const result = await this.context.drizzle
      .delete(hostAccess)
      .where(eq(hostAccess.hostId, hostId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
