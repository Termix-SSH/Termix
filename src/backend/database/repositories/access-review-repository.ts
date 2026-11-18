import { and, eq, isNotNull, lte, or, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  credentialAccess,
  folderAccess,
  hostAccess,
  hosts,
  roles,
  sshCredentials,
  users,
} from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";

export type AccessKind = "host" | "folder" | "credential";

/** One share, whatever it is on, in the shape the review page lists. */
export interface AccessReviewRow {
  kind: AccessKind;
  accessId: number;
  /** Host id, credential id, or the folder path. */
  targetId: string;
  targetName: string;
  ownerId: string | null;
  ownerUsername: string | null;
  granteeUserId: string | null;
  granteeUsername: string | null;
  granteeRoleId: number | null;
  granteeRoleName: string | null;
  permissionLevel: string;
  grantedBy: string | null;
  grantedByUsername: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastAccessedAt: string | null;
}

export interface AccessReviewFilter {
  kind?: AccessKind;
  userId?: string;
  roleId?: number;
}

/** Reads every share across hosts, folders and credentials for admins. */
export class AccessReviewRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async list(filter: AccessReviewFilter = {}): Promise<AccessReviewRow[]> {
    const rows: AccessReviewRow[] = [];
    if (!filter.kind || filter.kind === "host") {
      rows.push(...(await this.listHostShares(filter)));
    }
    if (!filter.kind || filter.kind === "folder") {
      rows.push(...(await this.listFolderShares(filter)));
    }
    if (!filter.kind || filter.kind === "credential") {
      rows.push(...(await this.listCredentialShares(filter)));
    }
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // Subqueries, not alias(): an SQLite alias renders without its table on
  // Postgres and MySQL.
  private userNames(name: string) {
    return this.context.drizzle
      .select({ id: users.id, username: users.username })
      .from(users)
      .as(name);
  }

  private people() {
    return {
      owner: this.userNames("review_owner"),
      grantee: this.userNames("review_grantee"),
      granter: this.userNames("review_granter"),
    };
  }

  private granteeWhere(
    userColumn: SQLiteColumn,
    roleColumn: SQLiteColumn,
    filter: AccessReviewFilter,
  ): SQL | undefined {
    const parts: (SQL | undefined)[] = [];
    if (filter.userId) parts.push(eq(userColumn, filter.userId));
    if (filter.roleId !== undefined) parts.push(eq(roleColumn, filter.roleId));
    return parts.length ? and(...parts) : undefined;
  }

  private async listHostShares(
    filter: AccessReviewFilter,
  ): Promise<AccessReviewRow[]> {
    const { owner, grantee, granter } = this.people();
    const where = filter.userId
      ? and(
          or(
            eq(hostAccess.userId, filter.userId),
            eq(hosts.userId, filter.userId),
          ),
          filter.roleId !== undefined
            ? eq(hostAccess.roleId, filter.roleId)
            : undefined,
        )
      : this.granteeWhere(hostAccess.userId, hostAccess.roleId, filter);
    const rows = await this.context.drizzle
      .select({
        accessId: hostAccess.id,
        hostId: hosts.id,
        hostName: hosts.name,
        hostIp: hosts.ip,
        ownerId: hosts.userId,
        ownerUsername: owner.username,
        granteeUserId: hostAccess.userId,
        granteeUsername: grantee.username,
        granteeRoleId: hostAccess.roleId,
        granteeRoleName: roles.name,
        permissionLevel: hostAccess.permissionLevel,
        grantedBy: hostAccess.grantedBy,
        grantedByUsername: granter.username,
        createdAt: hostAccess.createdAt,
        expiresAt: hostAccess.expiresAt,
        lastAccessedAt: hostAccess.lastAccessedAt,
      })
      .from(hostAccess)
      .innerJoin(hosts, eq(hostAccess.hostId, hosts.id))
      .leftJoin(owner, eq(hosts.userId, owner.id))
      .leftJoin(grantee, eq(hostAccess.userId, grantee.id))
      .leftJoin(roles, eq(hostAccess.roleId, roles.id))
      .leftJoin(granter, eq(hostAccess.grantedBy, granter.id))
      .where(where);
    return rows.map((row) => ({
      kind: "host",
      accessId: row.accessId,
      targetId: String(row.hostId),
      targetName: row.hostName || row.hostIp,
      ownerId: row.ownerId,
      ownerUsername: row.ownerUsername,
      granteeUserId: row.granteeUserId,
      granteeUsername: row.granteeUsername,
      granteeRoleId: row.granteeRoleId,
      granteeRoleName: row.granteeRoleName,
      permissionLevel: row.permissionLevel,
      grantedBy: row.grantedBy,
      grantedByUsername: row.grantedByUsername,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lastAccessedAt: row.lastAccessedAt,
    }));
  }

  private async listFolderShares(
    filter: AccessReviewFilter,
  ): Promise<AccessReviewRow[]> {
    const { owner, grantee, granter } = this.people();
    const where = filter.userId
      ? and(
          or(
            eq(folderAccess.userId, filter.userId),
            eq(folderAccess.ownerUserId, filter.userId),
          ),
          filter.roleId !== undefined
            ? eq(folderAccess.roleId, filter.roleId)
            : undefined,
        )
      : this.granteeWhere(folderAccess.userId, folderAccess.roleId, filter);
    const rows = await this.context.drizzle
      .select({
        accessId: folderAccess.id,
        folder: folderAccess.folder,
        ownerId: folderAccess.ownerUserId,
        ownerUsername: owner.username,
        granteeUserId: folderAccess.userId,
        granteeUsername: grantee.username,
        granteeRoleId: folderAccess.roleId,
        granteeRoleName: roles.name,
        permissionLevel: folderAccess.permissionLevel,
        grantedBy: folderAccess.grantedBy,
        grantedByUsername: granter.username,
        createdAt: folderAccess.createdAt,
        expiresAt: folderAccess.expiresAt,
      })
      .from(folderAccess)
      .leftJoin(owner, eq(folderAccess.ownerUserId, owner.id))
      .leftJoin(grantee, eq(folderAccess.userId, grantee.id))
      .leftJoin(roles, eq(folderAccess.roleId, roles.id))
      .leftJoin(granter, eq(folderAccess.grantedBy, granter.id))
      .where(where);
    return rows.map((row) => ({
      kind: "folder",
      accessId: row.accessId,
      targetId: row.folder,
      targetName: row.folder,
      ownerId: row.ownerId,
      ownerUsername: row.ownerUsername,
      granteeUserId: row.granteeUserId,
      granteeUsername: row.granteeUsername,
      granteeRoleId: row.granteeRoleId,
      granteeRoleName: row.granteeRoleName,
      permissionLevel: row.permissionLevel,
      grantedBy: row.grantedBy,
      grantedByUsername: row.grantedByUsername,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lastAccessedAt: null,
    }));
  }

  private async listCredentialShares(
    filter: AccessReviewFilter,
  ): Promise<AccessReviewRow[]> {
    const { owner, grantee, granter } = this.people();
    const where = filter.userId
      ? and(
          or(
            eq(credentialAccess.userId, filter.userId),
            eq(sshCredentials.userId, filter.userId),
          ),
          filter.roleId !== undefined
            ? eq(credentialAccess.roleId, filter.roleId)
            : undefined,
        )
      : this.granteeWhere(
          credentialAccess.userId,
          credentialAccess.roleId,
          filter,
        );
    const rows = await this.context.drizzle
      .select({
        accessId: credentialAccess.id,
        credentialId: sshCredentials.id,
        credentialName: sshCredentials.name,
        ownerId: sshCredentials.userId,
        ownerUsername: owner.username,
        granteeUserId: credentialAccess.userId,
        granteeUsername: grantee.username,
        granteeRoleId: credentialAccess.roleId,
        granteeRoleName: roles.name,
        permissionLevel: credentialAccess.permissionLevel,
        grantedBy: credentialAccess.grantedBy,
        grantedByUsername: granter.username,
        createdAt: credentialAccess.createdAt,
        expiresAt: credentialAccess.expiresAt,
      })
      .from(credentialAccess)
      .innerJoin(
        sshCredentials,
        eq(credentialAccess.credentialId, sshCredentials.id),
      )
      .leftJoin(owner, eq(sshCredentials.userId, owner.id))
      .leftJoin(grantee, eq(credentialAccess.userId, grantee.id))
      .leftJoin(roles, eq(credentialAccess.roleId, roles.id))
      .leftJoin(granter, eq(credentialAccess.grantedBy, granter.id))
      .where(where);
    return rows.map((row) => ({
      kind: "credential",
      accessId: row.accessId,
      targetId: String(row.credentialId),
      targetName: row.credentialName,
      ownerId: row.ownerId,
      ownerUsername: row.ownerUsername,
      granteeUserId: row.granteeUserId,
      granteeUsername: row.granteeUsername,
      granteeRoleId: row.granteeRoleId,
      granteeRoleName: row.granteeRoleName,
      permissionLevel: row.permissionLevel,
      grantedBy: row.grantedBy,
      grantedByUsername: row.grantedByUsername,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lastAccessedAt: null,
    }));
  }

  /** Removes folder and credential shares that ran out. */
  async deleteExpired(now = new Date().toISOString()): Promise<number> {
    const folders = await this.context.drizzle
      .delete(folderAccess)
      .where(
        and(
          isNotNull(folderAccess.expiresAt),
          lte(folderAccess.expiresAt, now),
        ),
      );
    const credentials = await this.context.drizzle
      .delete(credentialAccess)
      .where(
        and(
          isNotNull(credentialAccess.expiresAt),
          lte(credentialAccess.expiresAt, now),
        ),
      );
    const removed = rowsAffected(folders) + rowsAffected(credentials);
    if (removed > 0) await this.onWrite?.();
    return removed;
  }
}
