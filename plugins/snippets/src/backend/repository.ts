import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm";
import type { PluginDatabase } from "@termix/plugin-sdk/backend";

export interface SnippetRecord {
  id: number;
  userId: string;
  name: string;
  content: string;
  description: string | null;
  folder: string | null;
  order: number;
  syncId: string | null;
  createdAt: string;
  updatedAt: string;
  hostFilter: string | null;
  isNote: boolean;
}

export interface SnippetFolderRecord {
  id: number;
  userId: string;
  name: string;
  color: string | null;
  icon: string | null;
  syncId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RenameSnippetFolderResult {
  status: "renamed" | "missing" | "conflict";
}

export interface SnippetReorderUpdate {
  id: number;
  order: number;
  folder?: string;
}

export interface NewSnippetInput {
  name: string;
  content: string;
  description?: string | null;
  folder?: string | null;
  order?: number | null;
  hostFilter?: unknown;
  isNote?: boolean;
}

export interface SnippetUpdateInput {
  name?: string;
  content?: string;
  description?: string | null;
  folder?: string | null;
  order?: number;
  hostFilter?: unknown;
  isNote?: boolean;
}

export interface UpdateSnippetResult {
  existing: SnippetRecord;
  updated: SnippetRecord;
}

export interface SnippetBulkImportResult {
  snippetsImported: number;
  snippetsSkipped: number;
  snippetsUpdated: number;
  foldersImported: number;
  foldersSkipped: number;
  failed: number;
  errors: string[];
}

interface BulkImportSnippetInput {
  name?: unknown;
  content?: unknown;
  description?: string | null;
  folder?: string | null;
  order?: unknown;
  hostFilter?: string | null;
}

interface BulkImportFolderInput {
  name?: unknown;
  color?: string | null;
  icon?: string | null;
}

export interface RbacAccessListItem {
  id: number;
  targetType: "user" | "role";
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

export type SnippetAccessTarget =
  | { targetType: "user"; targetUserId: string }
  | { targetType: "role"; targetRoleId: number };

export type UpsertSnippetAccessInput = SnippetAccessTarget & {
  snippetId: number;
  grantedBy: string;
  expiresAt: string | null;
};

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
  isNote: boolean;
}

export interface RbacAccessibleSnippet extends RbacVisibleSharedSnippet {
  hostFilter: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// The tables come from ctx.db.define/ctx.db.refs, which the SDK hands back
// untyped, and the drizzle handle is the server's own. Typed at this module's
// edge instead.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toAccessListItem(
  row: Omit<RbacAccessListItem, "targetType">,
): RbacAccessListItem {
  return { ...row, targetType: row.userId ? "user" : "role" };
}

export type SnippetRepository = ReturnType<typeof createSnippetRepository>;

/**
 * Snippet, folder and sharing storage. Written without RETURNING so it runs
 * the same on all three engines: an insert or update is read back by id/sync
 * id rather than relying on `.returning()`.
 */
export function createSnippetRepository(
  db: PluginDatabase,
  snippets: Table,
  folders: Table,
  access: Table,
) {
  const client = () => db.client<Drizzle>();
  const refs = () =>
    db.refs<{ users: Table; roles: Table; userRoles: Table }>();

  async function findOwnedById(
    userId: string,
    snippetId: number,
  ): Promise<SnippetRecord | null> {
    const drizzle = await client();
    const rows = await drizzle
      .select()
      .from(snippets)
      .where(and(eq(snippets.id, snippetId), eq(snippets.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async function findFolderByName(
    userId: string,
    name: string,
  ): Promise<SnippetFolderRecord | null> {
    const drizzle = await client();
    const rows = await drizzle
      .select()
      .from(folders)
      .where(and(eq(folders.userId, userId), eq(folders.name, name)))
      .limit(1);
    return rows[0] ?? null;
  }

  async function maxOrderForFolder(
    userId: string,
    folder: string | null,
  ): Promise<number> {
    const drizzle = await client();
    const result = await drizzle
      .select({ maxOrder: sql<number>`MAX(${snippets.order})` })
      .from(snippets)
      .where(
        and(
          eq(snippets.userId, userId),
          folder
            ? eq(snippets.folder, folder)
            : sql`(${snippets.folder} IS NULL OR ${snippets.folder} = '')`,
        ),
      );
    return result[0]?.maxOrder ?? -1;
  }

  async function nextOrderForFolder(
    userId: string,
    folder: string,
  ): Promise<number> {
    return (await maxOrderForFolder(userId, folder || null)) + 1;
  }

  async function findByNameAndFolder(
    userId: string,
    name: string,
    folder: string | null,
  ): Promise<SnippetRecord | null> {
    const drizzle = await client();
    const rows = await drizzle
      .select()
      .from(snippets)
      .where(
        and(
          eq(snippets.userId, userId),
          eq(snippets.name, name),
          folder
            ? eq(snippets.folder, folder)
            : sql`(${snippets.folder} IS NULL OR ${snippets.folder} = '')`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  function userOrRoleAccessFilter(userId: string, roleIds: number[]) {
    if (roleIds.length === 0) return eq(access.userId, userId);
    return or(eq(access.userId, userId), inArray(access.roleId, roleIds));
  }

  async function findSnippetAccess(
    snippetId: number,
    target: SnippetAccessTarget,
  ) {
    const drizzle = await client();
    const rows = await drizzle
      .select()
      .from(access)
      .where(
        and(
          eq(access.snippetId, snippetId),
          target.targetType === "user"
            ? eq(access.userId, target.targetUserId)
            : eq(access.roleId, target.targetRoleId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  return {
    findOwnedById,

    async listFolders(userId: string): Promise<SnippetFolderRecord[]> {
      const drizzle = await client();
      return drizzle
        .select()
        .from(folders)
        .where(eq(folders.userId, userId))
        .orderBy(asc(folders.name));
    },

    async listSnippetsForExport(userId: string): Promise<SnippetRecord[]> {
      const drizzle = await client();
      return drizzle
        .select()
        .from(snippets)
        .where(eq(snippets.userId, userId))
        .orderBy(sql`coalesce(${snippets.folder}, '')`, asc(snippets.order));
    },

    async listFoldersForExport(userId: string): Promise<SnippetFolderRecord[]> {
      const drizzle = await client();
      return drizzle
        .select()
        .from(folders)
        .where(eq(folders.userId, userId))
        .orderBy(asc(folders.name));
    },

    async listOwnedSnippetsInFolder(
      userId: string,
      folder: string,
    ): Promise<SnippetRecord[]> {
      const drizzle = await client();
      return drizzle
        .select()
        .from(snippets)
        .where(
          and(
            eq(snippets.userId, userId),
            or(
              eq(snippets.folder, folder),
              like(snippets.folder, `${folder} / %`),
            ),
          ),
        );
    },

    async listOwnedSnippets(userId: string): Promise<SnippetRecord[]> {
      const drizzle = await client();
      return drizzle
        .select()
        .from(snippets)
        .where(eq(snippets.userId, userId))
        .orderBy(
          sql`CASE WHEN ${snippets.folder} IS NULL OR ${snippets.folder} = '' THEN 0 ELSE 1 END`,
          asc(snippets.folder),
          asc(snippets.order),
          sql`${snippets.updatedAt} DESC`,
        );
    },

    async reorderSnippets(
      userId: string,
      updates: SnippetReorderUpdate[],
    ): Promise<void> {
      const drizzle = await client();
      for (const update of updates) {
        const { id, order, folder } = update;
        if (!id || order === undefined) continue;

        const updateFields: Partial<{ order: number; folder: string | null }> =
          {
            order,
          };
        if (folder !== undefined) updateFields.folder = folder?.trim() || null;

        await drizzle
          .update(snippets)
          .set(updateFields)
          .where(and(eq(snippets.id, id), eq(snippets.userId, userId)));
      }
      await db.persist();
    },

    async createSnippet(
      userId: string,
      input: NewSnippetInput,
    ): Promise<SnippetRecord> {
      const folderValue = input.folder?.trim() || "";
      const order =
        input.order === undefined || input.order === null
          ? await nextOrderForFolder(userId, folderValue)
          : input.order;

      const syncId = randomUUID();
      const drizzle = await client();
      await drizzle.insert(snippets).values({
        syncId,
        userId,
        name: input.name.trim(),
        content: input.content.trim(),
        description: input.description?.trim() || null,
        folder: input.folder?.trim() || null,
        order,
        hostFilter: input.hostFilter ? JSON.stringify(input.hostFilter) : null,
        isNote: input.isNote ?? false,
      });
      await db.persist();

      const rows = await drizzle
        .select()
        .from(snippets)
        .where(eq(snippets.syncId, syncId))
        .limit(1);
      return rows[0];
    },

    async updateSnippet(
      userId: string,
      snippetId: number,
      input: SnippetUpdateInput,
    ): Promise<UpdateSnippetResult | null> {
      const existing = await findOwnedById(userId, snippetId);
      if (!existing) return null;

      const updateFields: Record<string, unknown> = {
        updatedAt: sql`CURRENT_TIMESTAMP`,
      };
      if (input.name !== undefined) updateFields.name = input.name.trim();
      if (input.content !== undefined)
        updateFields.content = input.content.trim();
      if (input.description !== undefined)
        updateFields.description = input.description?.trim() || null;
      if (input.folder !== undefined)
        updateFields.folder = input.folder?.trim() || null;
      if (input.order !== undefined) updateFields.order = input.order;
      if (input.hostFilter !== undefined)
        updateFields.hostFilter = input.hostFilter
          ? JSON.stringify(input.hostFilter)
          : null;
      if (input.isNote !== undefined) updateFields.isNote = input.isNote;

      const drizzle = await client();
      await drizzle
        .update(snippets)
        .set(updateFields)
        .where(and(eq(snippets.id, snippetId), eq(snippets.userId, userId)));
      await db.persist();

      const updated = await findOwnedById(userId, snippetId);
      return { existing, updated: updated as SnippetRecord };
    },

    async deleteSnippet(
      userId: string,
      snippetId: number,
    ): Promise<SnippetRecord | null> {
      const existing = await findOwnedById(userId, snippetId);
      if (!existing) return null;

      const drizzle = await client();
      await drizzle
        .delete(snippets)
        .where(and(eq(snippets.id, snippetId), eq(snippets.userId, userId)));
      await db.persist();
      return existing;
    },

    async bulkImport(
      userId: string,
      snippetsToImport: unknown[] | undefined,
      foldersToImport: unknown[] | undefined,
      overwrite: boolean,
    ): Promise<SnippetBulkImportResult> {
      const results: SnippetBulkImportResult = {
        snippetsImported: 0,
        snippetsSkipped: 0,
        snippetsUpdated: 0,
        foldersImported: 0,
        foldersSkipped: 0,
        failed: 0,
        errors: [],
      };

      const drizzle = await client();
      let changed = false;

      if (Array.isArray(foldersToImport)) {
        for (const rawFolder of foldersToImport) {
          const folder = rawFolder as BulkImportFolderInput;
          if (!isNonEmptyString(folder.name)) {
            results.failed++;
            results.errors.push(`Folder missing name`);
            continue;
          }

          const existing = await findFolderByName(userId, folder.name);
          if (existing) {
            results.foldersSkipped++;
            continue;
          }

          await drizzle.insert(folders).values({
            syncId: randomUUID(),
            userId,
            name: folder.name.trim(),
            color: folder.color?.trim() || null,
            icon: folder.icon?.trim() || null,
          });
          changed = true;
          results.foldersImported++;
        }
      }

      if (Array.isArray(snippetsToImport)) {
        for (let i = 0; i < snippetsToImport.length; i++) {
          const snippet = snippetsToImport[i] as BulkImportSnippetInput;

          if (
            !isNonEmptyString(snippet.name) ||
            !isNonEmptyString(snippet.content)
          ) {
            results.failed++;
            results.errors.push(
              `Snippet ${i + 1}: name and content are required`,
            );
            continue;
          }

          const folderVal = snippet.folder?.trim() || null;
          const existing = await findByNameAndFolder(
            userId,
            snippet.name.trim(),
            folderVal,
          );

          if (existing) {
            if (!overwrite) {
              results.snippetsSkipped++;
              continue;
            }

            await drizzle
              .update(snippets)
              .set({
                content: snippet.content.trim(),
                description: snippet.description?.trim() || null,
                folder: folderVal,
                order:
                  typeof snippet.order === "number"
                    ? snippet.order
                    : existing.order,
                hostFilter: snippet.hostFilter || null,
                updatedAt: sql`CURRENT_TIMESTAMP`,
              })
              .where(
                and(eq(snippets.id, existing.id), eq(snippets.userId, userId)),
              );
            changed = true;
            results.snippetsUpdated++;
            continue;
          }

          const maxOrder = await maxOrderForFolder(userId, folderVal);
          await drizzle.insert(snippets).values({
            syncId: randomUUID(),
            userId,
            name: snippet.name.trim(),
            content: snippet.content.trim(),
            description: snippet.description?.trim() || null,
            folder: folderVal,
            order:
              typeof snippet.order === "number" ? snippet.order : maxOrder + 1,
            hostFilter: snippet.hostFilter || null,
          });
          changed = true;
          results.snippetsImported++;
        }
      }

      if (changed) await db.persist();
      return results;
    },

    async createFolder(
      userId: string,
      name: string,
      color: string | null | undefined,
      icon: string | null | undefined,
    ): Promise<SnippetFolderRecord | null> {
      const existing = await findFolderByName(userId, name);
      if (existing) return null;

      const syncId = randomUUID();
      const drizzle = await client();
      await drizzle.insert(folders).values({
        syncId,
        userId,
        name: name.trim(),
        color: color?.trim() || null,
        icon: icon?.trim() || null,
      });
      await db.persist();

      const rows = await drizzle
        .select()
        .from(folders)
        .where(eq(folders.syncId, syncId))
        .limit(1);
      return rows[0] ?? null;
    },

    async updateFolderMetadata(
      userId: string,
      name: string,
      color: string | null | undefined,
      icon: string | null | undefined,
    ): Promise<SnippetFolderRecord | null> {
      const existing = await findFolderByName(userId, name);
      if (!existing) return null;

      const updateFields: Record<string, unknown> = {
        updatedAt: sql`CURRENT_TIMESTAMP`,
      };
      if (color !== undefined) updateFields.color = color?.trim() || null;
      if (icon !== undefined) updateFields.icon = icon?.trim() || null;

      const drizzle = await client();
      await drizzle
        .update(folders)
        .set(updateFields)
        .where(and(eq(folders.userId, userId), eq(folders.name, name)));
      await db.persist();

      return findFolderByName(userId, name);
    },

    async renameFolder(
      userId: string,
      oldName: string,
      newName: string,
    ): Promise<RenameSnippetFolderResult> {
      const existing = await findFolderByName(userId, oldName);
      if (!existing) return { status: "missing" };

      const nameExists = await findFolderByName(userId, newName);
      if (nameExists) return { status: "conflict" };

      const drizzle = await client();
      await drizzle
        .update(folders)
        .set({ name: newName, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(folders.userId, userId), eq(folders.name, oldName)));

      await drizzle
        .update(snippets)
        .set({ folder: newName })
        .where(and(eq(snippets.userId, userId), eq(snippets.folder, oldName)));

      await db.persist();
      return { status: "renamed" };
    },

    async deleteFolder(
      userId: string,
      name: string,
    ): Promise<{ syncId: string | null } | null> {
      const drizzle = await client();
      await drizzle
        .update(snippets)
        .set({ folder: null })
        .where(and(eq(snippets.userId, userId), eq(snippets.folder, name)));

      const existing = await findFolderByName(userId, name);
      if (!existing) {
        await db.persist();
        return null;
      }

      await drizzle
        .delete(folders)
        .where(and(eq(folders.userId, userId), eq(folders.name, name)));
      await db.persist();
      return { syncId: existing.syncId };
    },

    /** Wipes a user's snippets and folders, for the password-reset data-wipe flow. */
    async deleteByUserId(userId: string): Promise<void> {
      const drizzle = await client();
      await drizzle.delete(snippets).where(eq(snippets.userId, userId));
      await drizzle.delete(folders).where(eq(folders.userId, userId));
      await db.persist();
    },

    // Sharing (moved from core's RbacAccessRepository)

    async listSnippetAccess(snippetId: number): Promise<RbacAccessListItem[]> {
      const drizzle = await client();
      const { users, roles } = await refs();
      const rows = await drizzle
        .select({
          id: access.id,
          userId: access.userId,
          roleId: access.roleId,
          username: users.username,
          roleName: roles.name,
          roleDisplayName: roles.displayName,
          grantedBy: access.grantedBy,
          grantedByUsername: sql<
            string | null
          >`(SELECT username FROM users WHERE id = ${access.grantedBy})`,
          permissionLevel: access.permissionLevel,
          expiresAt: access.expiresAt,
          createdAt: access.createdAt,
        })
        .from(access)
        .leftJoin(users, eq(access.userId, users.id))
        .leftJoin(roles, eq(access.roleId, roles.id))
        .where(eq(access.snippetId, snippetId))
        .orderBy(desc(access.createdAt));

      return rows.map(toAccessListItem);
    },

    async upsertSnippetAccess(
      input: UpsertSnippetAccessInput,
    ): Promise<{ id: number; created: boolean }> {
      const existing = await findSnippetAccess(input.snippetId, input);
      const drizzle = await client();

      if (existing) {
        await drizzle
          .update(access)
          .set({ expiresAt: input.expiresAt })
          .where(eq(access.id, existing.id));
        await db.persist();
        return { id: existing.id, created: false };
      }

      const now = new Date().toISOString();
      await drizzle.insert(access).values({
        snippetId: input.snippetId,
        userId: input.targetType === "user" ? input.targetUserId : null,
        roleId: input.targetType === "role" ? input.targetRoleId : null,
        grantedBy: input.grantedBy,
        permissionLevel: "view",
        expiresAt: input.expiresAt,
        createdAt: now,
      });
      await db.persist();

      const created = await findSnippetAccess(input.snippetId, input);
      return { id: created!.id, created: true };
    },

    async revokeSnippetAccess(
      accessId: number,
      snippetId: number,
    ): Promise<void> {
      const drizzle = await client();
      await drizzle
        .delete(access)
        .where(and(eq(access.id, accessId), eq(access.snippetId, snippetId)));
      await db.persist();
    },

    async listSharedSnippets(
      userId: string,
      roleIds: number[],
      now = new Date().toISOString(),
    ): Promise<RbacSharedSnippet[]> {
      const drizzle = await client();
      const { users } = await refs();

      const directShared = await drizzle
        .select({
          id: snippets.id,
          name: snippets.name,
          content: snippets.content,
          description: snippets.description,
          folder: snippets.folder,
          ownerUsername: users.username,
          permissionLevel: access.permissionLevel,
          expiresAt: access.expiresAt,
        })
        .from(access)
        .innerJoin(snippets, eq(access.snippetId, snippets.id))
        .innerJoin(users, eq(snippets.userId, users.id))
        .where(
          and(
            eq(access.userId, userId),
            or(isNull(access.expiresAt), gte(access.expiresAt, now)),
          ),
        );

      if (roleIds.length === 0) return directShared;

      const directIds = new Set(directShared.map((s: { id: number }) => s.id));
      const roleShared = await drizzle
        .select({
          id: snippets.id,
          name: snippets.name,
          content: snippets.content,
          description: snippets.description,
          folder: snippets.folder,
          ownerUsername: users.username,
          permissionLevel: access.permissionLevel,
          expiresAt: access.expiresAt,
        })
        .from(access)
        .innerJoin(snippets, eq(access.snippetId, snippets.id))
        .innerJoin(users, eq(snippets.userId, users.id))
        .where(
          and(
            or(isNull(access.expiresAt), gte(access.expiresAt, now)),
            inArray(access.roleId, roleIds),
          ),
        );

      return [
        ...directShared,
        ...roleShared.filter((s: { id: number }) => !directIds.has(s.id)),
      ];
    },

    async listVisibleSharedSnippets(
      userId: string,
      roleIds: number[],
      now = new Date().toISOString(),
    ): Promise<RbacVisibleSharedSnippet[]> {
      const drizzle = await client();
      const { users } = await refs();
      return drizzle
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
          isNote: snippets.isNote,
          ownerUsername: users.username,
          permissionLevel: access.permissionLevel,
          expiresAt: access.expiresAt,
        })
        .from(access)
        .innerJoin(snippets, eq(access.snippetId, snippets.id))
        .innerJoin(users, eq(snippets.userId, users.id))
        .where(
          and(
            userOrRoleAccessFilter(userId, roleIds),
            or(isNull(access.expiresAt), gte(access.expiresAt, now)),
          ),
        );
    },

    async findAccessibleSharedSnippet(
      snippetId: number,
      userId: string,
      roleIds: number[],
      now = new Date().toISOString(),
    ): Promise<RbacAccessibleSnippet | null> {
      const drizzle = await client();
      const { users } = await refs();
      const rows = await drizzle
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
          hostFilter: snippets.hostFilter,
          isNote: snippets.isNote,
          ownerUsername: users.username,
          permissionLevel: access.permissionLevel,
          expiresAt: access.expiresAt,
        })
        .from(access)
        .innerJoin(snippets, eq(access.snippetId, snippets.id))
        .innerJoin(users, eq(snippets.userId, users.id))
        .where(
          and(
            eq(access.snippetId, snippetId),
            userOrRoleAccessFilter(userId, roleIds),
            or(isNull(access.expiresAt), gte(access.expiresAt, now)),
          ),
        )
        .limit(1);

      return rows[0] ?? null;
    },

    /** A user's role ids, for the sharing filters above. */
    async listUserRoleIds(userId: string): Promise<number[]> {
      const drizzle = await client();
      const { userRoles } = await refs();
      const rows = await drizzle
        .select({ roleId: userRoles.roleId })
        .from(userRoles)
        .where(eq(userRoles.userId, userId));
      return rows.map((r: { roleId: number }) => r.roleId);
    },
  };
}
