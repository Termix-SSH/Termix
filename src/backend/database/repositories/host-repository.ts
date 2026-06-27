import { and, eq, inArray } from "drizzle-orm";
import { hostAccess, hosts } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

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
      .values(host)
      .returning();
    await this.afterWrite();
    return rows[0];
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

  async listByUserId(userId: string): Promise<HostRecord[]> {
    return this.context.drizzle
      .select()
      .from(hosts)
      .where(eq(hosts.userId, userId));
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

  async deleteForUser(userId: string, hostId: number): Promise<boolean> {
    await this.deleteAccessForHost(hostId);

    const rows = await this.context.drizzle
      .delete(hosts)
      .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId)))
      .returning({ id: hosts.id });

    await this.afterWrite();
    return rows.length > 0;
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
