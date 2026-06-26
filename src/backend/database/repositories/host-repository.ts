import { and, eq } from "drizzle-orm";
import { hostAccess, hosts } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

export type HostRecord = typeof hosts.$inferSelect;
export type NewHostRecord = typeof hosts.$inferInsert;
export type HostUpdate = Partial<Omit<NewHostRecord, "id" | "userId">>;

export class HostRepository {
  constructor(private readonly context: DatabaseContext) {}

  async create(host: NewHostRecord): Promise<HostRecord> {
    const rows = await this.context.drizzle
      .insert(hosts)
      .values(host)
      .returning();
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

    return rows[0] ?? null;
  }

  async deleteForUser(userId: string, hostId: number): Promise<boolean> {
    await this.deleteAccessForHost(hostId);

    const rows = await this.context.drizzle
      .delete(hosts)
      .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId)))
      .returning({ id: hosts.id });

    return rows.length > 0;
  }

  async deleteAccessForHost(hostId: number): Promise<number> {
    const rows = await this.context.drizzle
      .delete(hostAccess)
      .where(eq(hostAccess.hostId, hostId))
      .returning({ id: hostAccess.id });

    return rows.length;
  }
}
