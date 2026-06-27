import { and, eq, isNotNull } from "drizzle-orm";
import { hostAccess, hosts, sshCredentials } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { DataCrypto } from "../../utils/data-crypto.js";

export type HostResolutionHostRecord = typeof hosts.$inferSelect;
export type HostResolutionCredentialRecord = typeof sshCredentials.$inferSelect;
export interface HostKeyVerificationRecord {
  hostKeyFingerprint: string | null;
  hostKeyType: string | null;
  hostKeyAlgorithm: string | null;
  hostKeyChangedCount: number | null;
  name: string | null;
}

export class HostResolutionRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

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

  async findHostsByUserId(userId: string): Promise<HostResolutionHostRecord[]> {
    const rows = await this.context.drizzle
      .select()
      .from(hosts)
      .where(eq(hosts.userId, userId));

    return this.decryptMany("ssh_data", rows, userId);
  }

  async findHostOwnerId(hostId: number): Promise<string | null> {
    const rows = await this.context.drizzle
      .select({ ownerId: hosts.userId })
      .from(hosts)
      .where(eq(hosts.id, hostId))
      .limit(1);

    return rows[0]?.ownerId ?? null;
  }

  async isHostOwnedByUser(hostId: number, userId: string): Promise<boolean> {
    const rows = await this.context.drizzle
      .select({ id: hosts.id })
      .from(hosts)
      .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId)))
      .limit(1);

    return rows.length > 0;
  }

  async listAllHosts(): Promise<HostResolutionHostRecord[]> {
    const rows = await this.context.drizzle.select().from(hosts);

    return this.decryptManyByOwner("ssh_data", rows);
  }

  async listHostsWithTunnelConnections(): Promise<HostResolutionHostRecord[]> {
    const rows = await this.context.drizzle
      .select()
      .from(hosts)
      .where(
        and(eq(hosts.enableTunnel, true), isNotNull(hosts.tunnelConnections)),
      );

    return this.decryptManyByOwner("ssh_data", rows);
  }

  async listHostsUsingCredentialForUser(
    userId: string,
    credentialId: number,
  ): Promise<HostResolutionHostRecord[]> {
    const rows = await this.context.drizzle
      .select()
      .from(hosts)
      .where(
        and(eq(hosts.credentialId, credentialId), eq(hosts.userId, userId)),
      );

    return this.decryptMany("ssh_data", rows, userId);
  }

  async findHostKeyVerificationData(
    hostId: number,
  ): Promise<HostKeyVerificationRecord | null> {
    const rows = await this.context.drizzle
      .select({
        hostKeyFingerprint: hosts.hostKeyFingerprint,
        hostKeyType: hosts.hostKeyType,
        hostKeyAlgorithm: hosts.hostKeyAlgorithm,
        hostKeyChangedCount: hosts.hostKeyChangedCount,
        name: hosts.name,
      })
      .from(hosts)
      .where(eq(hosts.id, hostId))
      .limit(1);

    return rows[0] ?? null;
  }

  async storeHostKey(
    hostId: number,
    fingerprint: string,
    keyType: string,
    algorithm: string,
    now = new Date().toISOString(),
  ): Promise<void> {
    await this.context.drizzle
      .update(hosts)
      .set({
        hostKeyFingerprint: fingerprint,
        hostKeyType: keyType,
        hostKeyAlgorithm: algorithm,
        hostKeyFirstSeen: now,
        hostKeyLastVerified: now,
      })
      .where(eq(hosts.id, hostId));
    await this.afterWrite();
  }

  async updateHostKey(
    hostId: number,
    fingerprint: string,
    keyType: string,
    algorithm: string,
    currentChangeCount: number,
    now = new Date().toISOString(),
  ): Promise<void> {
    await this.context.drizzle
      .update(hosts)
      .set({
        hostKeyFingerprint: fingerprint,
        hostKeyType: keyType,
        hostKeyAlgorithm: algorithm,
        hostKeyLastVerified: now,
        hostKeyChangedCount: currentChangeCount + 1,
      })
      .where(eq(hosts.id, hostId));
    await this.afterWrite();
  }

  async touchHostKeyLastVerified(
    hostId: number,
    now = new Date().toISOString(),
  ): Promise<void> {
    await this.context.drizzle
      .update(hosts)
      .set({ hostKeyLastVerified: now })
      .where(eq(hosts.id, hostId));
    await this.afterWrite();
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

  private decryptMany<T extends Record<string, unknown>>(
    tableName: "ssh_data" | "ssh_credentials",
    records: T[],
    userId: string,
  ): T[] {
    const userDataKey = DataCrypto.getUserDataKey(userId);
    if (!userDataKey) return [];
    return records.map((record) =>
      DataCrypto.decryptRecord(tableName, record, userId, userDataKey),
    );
  }

  private decryptManyByOwner<
    T extends Record<string, unknown> & { userId: string },
  >(tableName: "ssh_data" | "ssh_credentials", records: T[]): T[] {
    return records.flatMap((record) => {
      const userDataKey = DataCrypto.getUserDataKey(record.userId);
      if (!userDataKey) return [];
      return [
        DataCrypto.decryptRecord(tableName, record, record.userId, userDataKey),
      ];
    });
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
