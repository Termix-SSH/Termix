import { and, eq } from "drizzle-orm";
import { hostAccess, hosts, sshCredentials } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { DataCrypto } from "../../utils/data-crypto.js";

export type HostResolutionHostRecord = typeof hosts.$inferSelect;
export type HostResolutionCredentialRecord = typeof sshCredentials.$inferSelect;

export class HostResolutionRepository {
  constructor(private readonly context: DatabaseContext) {}

  async findHostById(
    hostId: number,
    userId: string,
  ): Promise<HostResolutionHostRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(hosts)
      .where(eq(hosts.id, hostId))
      .limit(1);

    return this.decryptOne("ssh_data", rows[0], userId);
  }

  async findCredentialByIdForUser(
    credentialId: number,
    userId: string,
  ): Promise<HostResolutionCredentialRecord | null> {
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

    return this.decryptOne("ssh_credentials", rows[0], userId);
  }

  async findOverrideCredentialId(
    hostId: number,
    userId: string,
  ): Promise<number | null> {
    const rows = await this.context.drizzle
      .select({ overrideCredentialId: hostAccess.overrideCredentialId })
      .from(hostAccess)
      .where(and(eq(hostAccess.hostId, hostId), eq(hostAccess.userId, userId)))
      .limit(1);

    return rows[0]?.overrideCredentialId ?? null;
  }

  private decryptOne<T extends Record<string, unknown>>(
    tableName: "ssh_data" | "ssh_credentials",
    record: T | undefined,
    userId: string,
  ): T | null {
    if (!record) return null;
    const userDataKey = DataCrypto.getUserDataKey(userId);
    if (!userDataKey) return null;
    return DataCrypto.decryptRecord(tableName, record, userId, userDataKey);
  }
}
