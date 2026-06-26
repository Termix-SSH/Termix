import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import {
  hostAccess,
  hosts,
  roles,
  sharedCredentials,
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

export interface RbacRoleHostAccessCredentialSource {
  hostAccessId: number;
  credentialId: number | null;
  hostId: number;
  hostOwnerId: string;
}

export type RbacAccessTarget =
  | { targetType: "user"; targetUserId: string }
  | { targetType: "role"; targetRoleId: number };

export interface UpsertHostAccessInput extends RbacAccessTarget {
  hostId: number;
  grantedBy: string;
  permissionLevel: string;
  expiresAt: string | null;
}

export interface UpsertSnippetAccessInput extends RbacAccessTarget {
  snippetId: number;
  grantedBy: string;
  expiresAt: string | null;
}

type RawAccessListItem = Omit<RbacAccessListItem, "targetType">;

function toAccessListItem(access: RawAccessListItem): RbacAccessListItem {
  return {
    ...access,
    targetType: access.userId ? "user" : "role",
  };
}

export class RbacAccessRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

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

  async upsertHostAccess(input: UpsertHostAccessInput): Promise<{
    id: number;
    created: boolean;
  }> {
    const existing = await this.findHostAccess(input.hostId, input);

    if (existing) {
      await this.context.drizzle
        .update(hostAccess)
        .set({
          permissionLevel: input.permissionLevel,
          expiresAt: input.expiresAt,
        })
        .where(eq(hostAccess.id, existing.id));

      await this.context.drizzle
        .delete(sharedCredentials)
        .where(eq(sharedCredentials.hostAccessId, existing.id));

      await this.afterWrite();
      return { id: existing.id, created: false };
    }

    const result = await this.context.drizzle.insert(hostAccess).values({
      hostId: input.hostId,
      userId: input.targetType === "user" ? input.targetUserId : null,
      roleId: input.targetType === "role" ? input.targetRoleId : null,
      grantedBy: input.grantedBy,
      permissionLevel: input.permissionLevel,
      expiresAt: input.expiresAt,
    });

    await this.afterWrite();
    return { id: Number(result.lastInsertRowid), created: true };
  }

  async revokeHostAccess(accessId: number): Promise<void> {
    await this.context.drizzle
      .delete(hostAccess)
      .where(eq(hostAccess.id, accessId));
    await this.afterWrite();
  }

  async findDirectHostAccess(
    hostId: number,
    userId: string,
  ): Promise<typeof hostAccess.$inferSelect | null> {
    const rows = await this.context.drizzle
      .select()
      .from(hostAccess)
      .where(and(eq(hostAccess.hostId, hostId), eq(hostAccess.userId, userId)))
      .limit(1);

    return rows[0] ?? null;
  }

  async updateHostAccessOverrideCredential(
    accessId: number,
    credentialId: number | null,
  ): Promise<void> {
    await this.context.drizzle
      .update(hostAccess)
      .set({ overrideCredentialId: credentialId })
      .where(eq(hostAccess.id, accessId));
    await this.afterWrite();
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

  async upsertSnippetAccess(input: UpsertSnippetAccessInput): Promise<{
    id: number;
    created: boolean;
  }> {
    const existing = await this.findSnippetAccess(input.snippetId, input);

    if (existing) {
      await this.context.drizzle
        .update(snippetAccess)
        .set({ expiresAt: input.expiresAt })
        .where(eq(snippetAccess.id, existing.id));

      await this.afterWrite();
      return { id: existing.id, created: false };
    }

    const result = await this.context.drizzle.insert(snippetAccess).values({
      snippetId: input.snippetId,
      userId: input.targetType === "user" ? input.targetUserId : null,
      roleId: input.targetType === "role" ? input.targetRoleId : null,
      grantedBy: input.grantedBy,
      permissionLevel: "view",
      expiresAt: input.expiresAt,
    });

    await this.afterWrite();
    return { id: Number(result.lastInsertRowid), created: true };
  }

  async revokeSnippetAccess(accessId: number): Promise<void> {
    await this.context.drizzle
      .delete(snippetAccess)
      .where(eq(snippetAccess.id, accessId));
    await this.afterWrite();
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

  async deleteExpiredHostAccess(
    now = new Date().toISOString(),
  ): Promise<number> {
    const rows = await this.context.drizzle
      .delete(hostAccess)
      .where(
        and(
          sql`${hostAccess.expiresAt} IS NOT NULL`,
          sql`${hostAccess.expiresAt} <= ${now}`,
        ),
      )
      .returning({ id: hostAccess.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async findActiveHostAccess(
    hostId: number,
    userId: string,
    roleIds: number[],
    now = new Date().toISOString(),
  ): Promise<typeof hostAccess.$inferSelect | null> {
    const rows = await this.context.drizzle
      .select()
      .from(hostAccess)
      .where(
        and(
          eq(hostAccess.hostId, hostId),
          this.userOrRoleHostAccessFilter(userId, roleIds),
          or(isNull(hostAccess.expiresAt), gte(hostAccess.expiresAt, now)),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async touchHostAccess(
    accessId: number,
    lastAccessedAt = new Date().toISOString(),
  ): Promise<void> {
    await this.context.drizzle
      .update(hostAccess)
      .set({ lastAccessedAt })
      .where(eq(hostAccess.id, accessId));
    await this.afterWrite();
  }

  async listRoleHostAccessCredentialSources(
    roleId: number,
  ): Promise<RbacRoleHostAccessCredentialSource[]> {
    return this.context.drizzle
      .select({
        hostAccessId: hostAccess.id,
        credentialId: hosts.credentialId,
        hostId: hosts.id,
        hostOwnerId: hosts.userId,
      })
      .from(hostAccess)
      .innerJoin(hosts, eq(hostAccess.hostId, hosts.id))
      .where(eq(hostAccess.roleId, roleId));
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

  private async findHostAccess(hostId: number, target: RbacAccessTarget) {
    const rows = await this.context.drizzle
      .select()
      .from(hostAccess)
      .where(
        and(
          eq(hostAccess.hostId, hostId),
          target.targetType === "user"
            ? eq(hostAccess.userId, target.targetUserId)
            : eq(hostAccess.roleId, target.targetRoleId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  private async findSnippetAccess(snippetId: number, target: RbacAccessTarget) {
    const rows = await this.context.drizzle
      .select()
      .from(snippetAccess)
      .where(
        and(
          eq(snippetAccess.snippetId, snippetId),
          target.targetType === "user"
            ? eq(snippetAccess.userId, target.targetUserId)
            : eq(snippetAccess.roleId, target.targetRoleId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
