import { eq, inArray } from "drizzle-orm";
import { sshCredentialUsage } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export type SshCredentialUsageRecord = typeof sshCredentialUsage.$inferSelect;

export class SshCredentialUsageRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listByUserId(userId: string): Promise<SshCredentialUsageRecord[]> {
    return this.context.drizzle
      .select()
      .from(sshCredentialUsage)
      .where(eq(sshCredentialUsage.userId, userId));
  }

  async create(
    credentialId: number,
    hostId: number,
    userId: string,
  ): Promise<SshCredentialUsageRecord> {
    const [created] = await this.context.drizzle
      .insert(sshCredentialUsage)
      .values({ credentialId, hostId, userId })
      .returning();
    await this.afterWrite();
    return created;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(sshCredentialUsage)
      .where(eq(sshCredentialUsage.userId, userId))
      .returning({ id: sshCredentialUsage.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async deleteByHostId(hostId: number): Promise<number> {
    const rows = await this.context.drizzle
      .delete(sshCredentialUsage)
      .where(eq(sshCredentialUsage.hostId, hostId))
      .returning({ id: sshCredentialUsage.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async deleteByHostIds(hostIds: number[]): Promise<number> {
    if (hostIds.length === 0) {
      return 0;
    }

    const rows = await this.context.drizzle
      .delete(sshCredentialUsage)
      .where(inArray(sshCredentialUsage.hostId, hostIds))
      .returning({ id: sshCredentialUsage.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
