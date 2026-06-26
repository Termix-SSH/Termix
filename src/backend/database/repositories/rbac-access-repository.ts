import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import {
  hostAccess,
  hosts,
  roles,
  snippetAccess,
  snippets,
  users,
} from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

export type RbacAccessTargetType = "user" | "role";

export interface RbacAccessListItem {
  id: number;
  targetType: RbacAccessTargetType;
  userId: string | null;
  roleId: number | null;
  username: string | null;
  roleName: string | null;
  roleDisplayName: string | null;
  grantedBy: string;
  grantedByUsername: string | null;
  permissionLevel: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface RbacSharedHost {
  id: number;
  name: string | null;
  ip: string;
  port: number;
  username: string;
  folder: string | null;
  tags: string | null;
  permissionLevel: string;
  expiresAt: string | null;
  grantedBy: string;
  ownerUsername: string;
}

export interface RbacSharedSnippet {
  id: number;
  name: string;
  content: string;
  description: string | null;
  folder: string | null;
  ownerUsername: string;
  permissionLevel: string;
  expiresAt: string | null;
}

export interface RbacVisibleSharedSnippet extends RbacSharedSnippet {
  userId: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

type RawAccessListItem = Omit<RbacAccessListItem, "targetType">;

function toAccessListItem(access: RawAccessListItem): RbacAccessListItem {
  return {
    ...access,
    targetType: access.userId ? "user" : "role",
  };
}

export class RbacAccessRepository {
  constructor(private readonly context: DatabaseContext) {}

  async listHostAccess(hostId: number): Promise<RbacAccessListItem[]> {
    const rows = await this.context.drizzle
      .select({
        id: hostAccess.id,
        userId: hostAccess.userId,
        roleId: hostAccess.roleId,
        username: users.username,
        roleName: roles.name,
        roleDisplayName: roles.displayName,
        grantedBy: hostAccess.grantedBy,
        grantedByUsername: sql<
          string | null
        >`(SELECT username FROM users WHERE id = ${hostAccess.grantedBy})`,
        permissionLevel: hostAccess.permissionLevel,
        expiresAt: hostAccess.expiresAt,
        createdAt: hostAccess.createdAt,
      })
      .from(hostAccess)
      .leftJoin(users, eq(hostAccess.userId, users.id))
      .leftJoin(roles, eq(hostAccess.roleId, roles.id))
      .where(eq(hostAccess.hostId, hostId))
      .orderBy(desc(hostAccess.createdAt));

    return rows.map(toAccessListItem);
  }

  async listSnippetAccess(snippetId: number): Promise<RbacAccessListItem[]> {
    const rows = await this.context.drizzle
      .select({
        id: snippetAccess.id,
        userId: snippetAccess.userId,
        roleId: snippetAccess.roleId,
        username: users.username,
        roleName: roles.name,
        roleDisplayName: roles.displayName,
        grantedBy: snippetAccess.grantedBy,
        grantedByUsername: sql<
          string | null
        >`(SELECT username FROM users WHERE id = ${snippetAccess.grantedBy})`,
        permissionLevel: snippetAccess.permissionLevel,
        expiresAt: snippetAccess.expiresAt,
        createdAt: snippetAccess.createdAt,
      })
      .from(snippetAccess)
      .leftJoin(users, eq(snippetAccess.userId, users.id))
      .leftJoin(roles, eq(snippetAccess.roleId, roles.id))
      .where(eq(snippetAccess.snippetId, snippetId))
      .orderBy(desc(snippetAccess.createdAt));

    return rows.map(toAccessListItem);
  }

  async listSharedHosts(
    userId: string,
    roleIds: number[],
    now = new Date().toISOString(),
  ): Promise<RbacSharedHost[]> {
    return this.context.drizzle
      .select({
        id: hosts.id,
        name: hosts.name,
        ip: hosts.ip,
        port: hosts.port,
        username: hosts.username,
        folder: hosts.folder,
        tags: hosts.tags,
        permissionLevel: hostAccess.permissionLevel,
        expiresAt: hostAccess.expiresAt,
        grantedBy: hostAccess.grantedBy,
        ownerUsername: users.username,
      })
      .from(hostAccess)
      .innerJoin(hosts, eq(hostAccess.hostId, hosts.id))
      .innerJoin(users, eq(hosts.userId, users.id))
      .where(
        and(
          this.userOrRoleHostAccessFilter(userId, roleIds),
          or(isNull(hostAccess.expiresAt), gte(hostAccess.expiresAt, now)),
        ),
      )
      .orderBy(desc(hostAccess.createdAt));
  }

  async listSharedSnippets(
    userId: string,
    roleIds: number[],
    now = new Date().toISOString(),
  ): Promise<RbacSharedSnippet[]> {
    const directShared = await this.context.drizzle
      .select({
        id: snippets.id,
        name: snippets.name,
        content: snippets.content,
        description: snippets.description,
        folder: snippets.folder,
        ownerUsername: users.username,
        permissionLevel: snippetAccess.permissionLevel,
        expiresAt: snippetAccess.expiresAt,
      })
      .from(snippetAccess)
      .innerJoin(snippets, eq(snippetAccess.snippetId, snippets.id))
      .innerJoin(users, eq(snippets.userId, users.id))
      .where(
        and(
          eq(snippetAccess.userId, userId),
          or(
            isNull(snippetAccess.expiresAt),
            gte(snippetAccess.expiresAt, now),
          ),
        ),
      );

    if (roleIds.length === 0) {
      return directShared;
    }

    const directIds = new Set(directShared.map((snippet) => snippet.id));
    const roleShared = await this.context.drizzle
      .select({
        id: snippets.id,
        name: snippets.name,
        content: snippets.content,
        description: snippets.description,
        folder: snippets.folder,
        ownerUsername: users.username,
        permissionLevel: snippetAccess.permissionLevel,
        expiresAt: snippetAccess.expiresAt,
      })
      .from(snippetAccess)
      .innerJoin(snippets, eq(snippetAccess.snippetId, snippets.id))
      .innerJoin(users, eq(snippets.userId, users.id))
      .where(
        and(
          or(
            isNull(snippetAccess.expiresAt),
            gte(snippetAccess.expiresAt, now),
          ),
          inArray(snippetAccess.roleId, roleIds),
        ),
      );

    return [
      ...directShared,
      ...roleShared.filter((snippet) => !directIds.has(snippet.id)),
    ];
  }

  async listVisibleSharedSnippets(
    userId: string,
    roleIds: number[],
    now = new Date().toISOString(),
  ): Promise<RbacVisibleSharedSnippet[]> {
    return this.context.drizzle
      .select({
        id: snippets.id,
        userId: snippets.userId,
        name: snippets.name,
        content: snippets.content,
        description: snippets.description,
        folder: snippets.folder,
        order: snippets.order,
        createdAt: snippets.createdAt,
        updatedAt: snippets.updatedAt,
        ownerUsername: users.username,
        permissionLevel: snippetAccess.permissionLevel,
        expiresAt: snippetAccess.expiresAt,
      })
      .from(snippetAccess)
      .innerJoin(snippets, eq(snippetAccess.snippetId, snippets.id))
      .innerJoin(users, eq(snippets.userId, users.id))
      .where(
        and(
          this.userOrRoleSnippetAccessFilter(userId, roleIds),
          or(
            isNull(snippetAccess.expiresAt),
            gte(snippetAccess.expiresAt, now),
          ),
        ),
      );
  }

  private userOrRoleHostAccessFilter(userId: string, roleIds: number[]) {
    if (roleIds.length === 0) {
      return eq(hostAccess.userId, userId);
    }

    return or(
      eq(hostAccess.userId, userId),
      inArray(hostAccess.roleId, roleIds),
    );
  }

  private userOrRoleSnippetAccessFilter(userId: string, roleIds: number[]) {
    if (roleIds.length === 0) {
      return eq(snippetAccess.userId, userId);
    }

    return or(
      eq(snippetAccess.userId, userId),
      inArray(snippetAccess.roleId, roleIds),
    );
  }
}
