import { and, eq, gte, inArray, isNull, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  credentialAccess,
  roles,
  sshCredentials,
  users,
} from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { insertReturning } from "./returning.js";

export type CredentialAccessRecord = typeof credentialAccess.$inferSelect;
export type CredentialPermissionLevel = "use" | "manage";

export interface CredentialAccessListItem extends CredentialAccessRecord {
  targetType: "user" | "role";
  username: string | null;
  roleName: string | null;
  roleDisplayName: string | null;
  grantedByUsername: string | null;
}

export type CredentialAccessTarget =
  | { targetType: "user"; targetUserId: string }
  | { targetType: "role"; targetRoleId: number };

export interface UpsertCredentialAccessInput {
  credentialId: number;
  grantedBy: string;
  permissionLevel: CredentialPermissionLevel;
  expiresAt: string | null;
  target: CredentialAccessTarget;
}

/** A credential shared with the caller, with the grant that admits them. */
export interface SharedCredentialGrant {
  accessId: number;
  credentialId: number;
  ownerId: string;
  permissionLevel: string;
  expiresAt: string | null;
}

function activeFilter(now: string): SQL {
  return or(
    isNull(credentialAccess.expiresAt),
    gte(credentialAccess.expiresAt, now),
  )!;
}

function granteeFilter(userId: string, roleIds: number[]): SQL {
  return roleIds.length === 0
    ? eq(credentialAccess.userId, userId)
    : or(
        eq(credentialAccess.userId, userId),
        inArray(credentialAccess.roleId, roleIds),
      )!;
}

export class CredentialAccessRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listForCredential(
    credentialId: number,
  ): Promise<CredentialAccessListItem[]> {
    const granter = alias(users, "granter");
    const rows = await this.context.drizzle
      .select({
        access: credentialAccess,
        username: users.username,
        roleName: roles.name,
        roleDisplayName: roles.displayName,
        grantedByUsername: granter.username,
      })
      .from(credentialAccess)
      .leftJoin(users, eq(credentialAccess.userId, users.id))
      .leftJoin(roles, eq(credentialAccess.roleId, roles.id))
      .leftJoin(granter, eq(credentialAccess.grantedBy, granter.id))
      .where(eq(credentialAccess.credentialId, credentialId));
    return rows.map((row) => ({
      ...row.access,
      targetType: row.access.roleId ? ("role" as const) : ("user" as const),
      username: row.username,
      roleName: row.roleName,
      roleDisplayName: row.roleDisplayName,
      grantedByUsername: row.grantedByUsername,
    }));
  }

  async upsert(
    input: UpsertCredentialAccessInput,
  ): Promise<{ id: number; created: boolean }> {
    const targetFilter =
      input.target.targetType === "user"
        ? eq(credentialAccess.userId, input.target.targetUserId)
        : eq(credentialAccess.roleId, input.target.targetRoleId);
    const existing = await this.context.drizzle
      .select({ id: credentialAccess.id })
      .from(credentialAccess)
      .where(
        and(eq(credentialAccess.credentialId, input.credentialId), targetFilter),
      )
      .limit(1);

    if (existing[0]) {
      await this.context.drizzle
        .update(credentialAccess)
        .set({
          permissionLevel: input.permissionLevel,
          expiresAt: input.expiresAt,
          grantedBy: input.grantedBy,
        })
        .where(eq(credentialAccess.id, existing[0].id));
      await this.afterWrite();
      return { id: existing[0].id, created: false };
    }

    const [created] = await insertReturning(this.context, credentialAccess, {
      credentialId: input.credentialId,
      userId:
        input.target.targetType === "user" ? input.target.targetUserId : null,
      roleId:
        input.target.targetType === "role" ? input.target.targetRoleId : null,
      grantedBy: input.grantedBy,
      permissionLevel: input.permissionLevel,
      expiresAt: input.expiresAt,
    });
    await this.afterWrite();
    return { id: created.id, created: true };
  }

  async findById(
    accessId: number,
    credentialId: number,
  ): Promise<CredentialAccessRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(credentialAccess)
      .where(
        and(
          eq(credentialAccess.id, accessId),
          eq(credentialAccess.credentialId, credentialId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async revoke(accessId: number, credentialId: number): Promise<void> {
    await this.context.drizzle
      .delete(credentialAccess)
      .where(
        and(
          eq(credentialAccess.id, accessId),
          eq(credentialAccess.credentialId, credentialId),
        ),
      );
    await this.afterWrite();
  }

  /** The strongest unexpired grant admitting this user to the credential. */
  async findActiveGrant(
    credentialId: number,
    userId: string,
    roleIds: number[],
    now = new Date().toISOString(),
  ): Promise<CredentialAccessRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(credentialAccess)
      .where(
        and(
          eq(credentialAccess.credentialId, credentialId),
          granteeFilter(userId, roleIds),
          activeFilter(now),
        ),
      );
    return (
      rows.find((row) => row.permissionLevel === "manage") ?? rows[0] ?? null
    );
  }

  /** Every credential shared with this user (directly or via a role). */
  async listSharedWithUser(
    userId: string,
    roleIds: number[],
    now = new Date().toISOString(),
  ): Promise<SharedCredentialGrant[]> {
    const rows = await this.context.drizzle
      .select({
        accessId: credentialAccess.id,
        credentialId: credentialAccess.credentialId,
        ownerId: sshCredentials.userId,
        permissionLevel: credentialAccess.permissionLevel,
        expiresAt: credentialAccess.expiresAt,
      })
      .from(credentialAccess)
      .innerJoin(sshCredentials, eq(credentialAccess.credentialId, sshCredentials.id))
      .where(and(granteeFilter(userId, roleIds), activeFilter(now)));
    // Direct and role grants can overlap; keep the strongest per credential.
    const best = new Map<number, SharedCredentialGrant>();
    for (const row of rows) {
      if (row.ownerId === userId) continue;
      const current = best.get(row.credentialId);
      if (!current || row.permissionLevel === "manage") best.set(row.credentialId, row);
    }
    return Array.from(best.values());
  }

  /** Active grants on one credential, expanded to user and role targets. */
  async listActiveGrants(
    credentialId: number,
    now = new Date().toISOString(),
  ): Promise<CredentialAccessRecord[]> {
    return this.context.drizzle
      .select()
      .from(credentialAccess)
      .where(
        and(eq(credentialAccess.credentialId, credentialId), activeFilter(now)),
      );
  }

  /** Grants a role holds, with the credential owner - for new-member snapshots. */
  async listRoleGrants(
    roleId: number,
  ): Promise<Array<{ accessId: number; credentialId: number; ownerId: string }>> {
    return this.context.drizzle
      .select({
        accessId: credentialAccess.id,
        credentialId: credentialAccess.credentialId,
        ownerId: sshCredentials.userId,
      })
      .from(credentialAccess)
      .innerJoin(sshCredentials, eq(credentialAccess.credentialId, sshCredentials.id))
      .where(eq(credentialAccess.roleId, roleId));
  }

  async deleteForUserReferences(userId: string): Promise<void> {
    await this.context.drizzle
      .delete(credentialAccess)
      .where(
        or(
          eq(credentialAccess.userId, userId),
          eq(credentialAccess.grantedBy, userId),
        ),
      );
    await this.afterWrite();
  }

  async reassignGrantedBy(fromUserId: string, toUserId: string): Promise<void> {
    await this.context.drizzle
      .update(credentialAccess)
      .set({ grantedBy: toUserId })
      .where(eq(credentialAccess.grantedBy, fromUserId));
    await this.afterWrite();
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
