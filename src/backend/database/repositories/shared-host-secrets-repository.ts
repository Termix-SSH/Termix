import { and, eq, inArray, or } from "drizzle-orm";
import { hostAccess, hosts, sharedHostSecrets } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export type SharedHostSecretRecord = typeof sharedHostSecrets.$inferSelect;
export type NewSharedHostSecretRecord = typeof sharedHostSecrets.$inferInsert;

export type ShareProtocol = "ssh" | "rdp" | "vnc" | "telnet";

export class SharedHostSecretsRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async upsert(record: NewSharedHostSecretRecord): Promise<void> {
    const existing = await this.context.drizzle
      .select({ id: sharedHostSecrets.id })
      .from(sharedHostSecrets)
      .where(
        and(
          eq(sharedHostSecrets.hostAccessId, record.hostAccessId),
          eq(sharedHostSecrets.targetUserId, record.targetUserId),
          eq(sharedHostSecrets.protocol, record.protocol ?? "ssh"),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await this.context.drizzle
        .update(sharedHostSecrets)
        .set({ ...record, updatedAt: new Date().toISOString() })
        .where(eq(sharedHostSecrets.id, existing[0].id));
    } else {
      await this.context.drizzle.insert(sharedHostSecrets).values(record);
    }

    await this.afterWrite();
  }

  async findForHostUserProtocol(
    hostId: number,
    targetUserId: string,
    protocol: ShareProtocol,
  ): Promise<SharedHostSecretRecord | null> {
    const rows = await this.context.drizzle
      .select({ secret: sharedHostSecrets })
      .from(sharedHostSecrets)
      .innerJoin(hostAccess, eq(sharedHostSecrets.hostAccessId, hostAccess.id))
      .where(
        and(
          eq(hostAccess.hostId, hostId),
          eq(sharedHostSecrets.targetUserId, targetUserId),
          eq(sharedHostSecrets.protocol, protocol),
        ),
      )
      .limit(1);

    return rows[0]?.secret ?? null;
  }

  async existsForHostAccessAndTargetUser(
    hostAccessId: number,
    targetUserId: string,
  ): Promise<boolean> {
    const rows = await this.context.drizzle
      .select({ id: sharedHostSecrets.id })
      .from(sharedHostSecrets)
      .where(
        and(
          eq(sharedHostSecrets.hostAccessId, hostAccessId),
          eq(sharedHostSecrets.targetUserId, targetUserId),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  async deleteForHostAccessAndTarget(
    hostAccessId: number,
    targetUserId: string,
    keepProtocols: ShareProtocol[] = [],
  ): Promise<void> {
    const rows = await this.context.drizzle
      .select({
        id: sharedHostSecrets.id,
        protocol: sharedHostSecrets.protocol,
      })
      .from(sharedHostSecrets)
      .where(
        and(
          eq(sharedHostSecrets.hostAccessId, hostAccessId),
          eq(sharedHostSecrets.targetUserId, targetUserId),
        ),
      );

    const staleIds = rows
      .filter((row) => !keepProtocols.includes(row.protocol as ShareProtocol))
      .map((row) => row.id);

    if (staleIds.length > 0) {
      await this.context.drizzle
        .delete(sharedHostSecrets)
        .where(inArray(sharedHostSecrets.id, staleIds));
      await this.afterWrite();
    }
  }

  async deleteByHostAccessId(hostAccessId: number): Promise<number> {
    const rows = await this.context.drizzle
      .delete(sharedHostSecrets)
      .where(eq(sharedHostSecrets.hostAccessId, hostAccessId))
      .returning({ id: sharedHostSecrets.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async deleteForRoleMember(
    roleId: number,
    targetUserId: string,
  ): Promise<number> {
    const rows = await this.context.drizzle
      .select({ id: sharedHostSecrets.id })
      .from(sharedHostSecrets)
      .innerJoin(hostAccess, eq(sharedHostSecrets.hostAccessId, hostAccess.id))
      .where(
        and(
          eq(hostAccess.roleId, roleId),
          eq(sharedHostSecrets.targetUserId, targetUserId),
        ),
      );

    if (rows.length === 0) return 0;

    await this.context.drizzle.delete(sharedHostSecrets).where(
      inArray(
        sharedHostSecrets.id,
        rows.map((row) => row.id),
      ),
    );
    await this.afterWrite();
    return rows.length;
  }

  async deleteByOriginalCredentialId(credentialId: number): Promise<number> {
    const rows = await this.context.drizzle
      .delete(sharedHostSecrets)
      .where(eq(sharedHostSecrets.originalCredentialId, credentialId))
      .returning({ id: sharedHostSecrets.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async deleteByTargetUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(sharedHostSecrets)
      .where(eq(sharedHostSecrets.targetUserId, userId))
      .returning({ id: sharedHostSecrets.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async findHostIdsReferencingCredential(
    ownerId: string,
    credentialId: number,
  ): Promise<number[]> {
    const rows = await this.context.drizzle
      .select({ id: hosts.id })
      .from(hosts)
      .where(
        and(
          eq(hosts.userId, ownerId),
          or(
            eq(hosts.credentialId, credentialId),
            eq(hosts.rdpCredentialId, credentialId),
            eq(hosts.vncCredentialId, credentialId),
            eq(hosts.telnetCredentialId, credentialId),
          ),
        ),
      );

    return rows.map((row) => row.id);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
