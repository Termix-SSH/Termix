import { desc, eq, sql } from "drizzle-orm";
import { hostAccess, roles, snippetAccess, users } from "../db/schema.js";
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
}
