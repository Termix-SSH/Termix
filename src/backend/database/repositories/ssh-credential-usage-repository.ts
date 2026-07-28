import { eq, inArray } from "drizzle-orm";
import { sshCredentialUsage } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";

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
    const result = await this.context.drizzle
      .delete(sshCredentialUsage)
      .where(eq(sshCredentialUsage.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  async deleteByHostId(hostId: number): Promise<number> {
    const result = await this.context.drizzle
      .delete(sshCredentialUsage)
      .where(eq(sshCredentialUsage.hostId, hostId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  async deleteByHostIds(hostIds: number[]): Promise<number> {
    if (hostIds.length === 0) {
      return 0;
    }

    const result = await this.context.drizzle
      .delete(sshCredentialUsage)
      .where(inArray(sshCredentialUsage.hostId, hostIds));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
