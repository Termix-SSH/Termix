import { and, eq, inArray, like, or } from "drizzle-orm";
import { folderAccess, roles, users } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { insertReturning } from "./returning.js";

export type FolderAccessRecord = typeof folderAccess.$inferSelect;

export interface FolderAccessListItem extends FolderAccessRecord {
  targetType: "user" | "role";
  username: string | null;
  roleName: string | null;
  roleDisplayName: string | null;
}

export type FolderAccessTarget =
  | { targetType: "user"; targetUserId: string }
  | { targetType: "role"; targetRoleId: number };

/** "A / B / C" → ["A", "A / B", "A / B / C"]: a host inherits rules on every ancestor. */
export function folderAncestors(folder: string): string[] {
  const parts = folder.split(" / ");
  return parts.map((_, i) => parts.slice(0, i + 1).join(" / "));
}

export class FolderAccessRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async upsert(input: {
    ownerUserId: string;
    folder: string;
    grantedBy: string;
    permissionLevel: string;
    expiresAt: string | null;
    target: FolderAccessTarget;
  }): Promise<FolderAccessRecord> {
    const targetFilter =
      input.target.targetType === "user"
        ? eq(folderAccess.userId, input.target.targetUserId)
        : eq(folderAccess.roleId, input.target.targetRoleId);
    const existing = await this.context.drizzle
      .select()
      .from(folderAccess)
      .where(
        and(
          eq(folderAccess.ownerUserId, input.ownerUserId),
          eq(folderAccess.folder, input.folder),
          targetFilter,
        ),
      )
      .limit(1);
    if (existing[0]) {
      await this.context.drizzle
        .update(folderAccess)
        .set({
          permissionLevel: input.permissionLevel,
          expiresAt: input.expiresAt,
          grantedBy: input.grantedBy,
        })
        .where(eq(folderAccess.id, existing[0].id));
      await this.afterWrite();
      return {
        ...existing[0],
        permissionLevel: input.permissionLevel,
        expiresAt: input.expiresAt,
      };
    }
    const [created] = await insertReturning(this.context, folderAccess, {
      ownerUserId: input.ownerUserId,
      folder: input.folder,
      userId:
        input.target.targetType === "user" ? input.target.targetUserId : null,
      roleId:
        input.target.targetType === "role" ? input.target.targetRoleId : null,
      grantedBy: input.grantedBy,
      permissionLevel: input.permissionLevel,
      expiresAt: input.expiresAt,
    });
    await this.afterWrite();
    return created;
  }

  /** Rules that apply to a host in this folder: the folder's own and its ancestors'. */
  async listApplicable(
    ownerUserId: string,
    folder: string,
    now = new Date().toISOString(),
  ): Promise<FolderAccessRecord[]> {
    const rows = await this.context.drizzle
      .select()
      .from(folderAccess)
      .where(
        and(
          eq(folderAccess.ownerUserId, ownerUserId),
          inArray(folderAccess.folder, folderAncestors(folder)),
        ),
      );
    return rows.filter((row) => !row.expiresAt || row.expiresAt >= now);
  }

  async listForFolder(
    ownerUserId: string,
    folder: string,
  ): Promise<FolderAccessListItem[]> {
    const rows = await this.context.drizzle
      .select({
        rule: folderAccess,
        username: users.username,
        roleName: roles.name,
        roleDisplayName: roles.displayName,
      })
      .from(folderAccess)
      .leftJoin(users, eq(folderAccess.userId, users.id))
      .leftJoin(roles, eq(folderAccess.roleId, roles.id))
      .where(
        and(
          eq(folderAccess.ownerUserId, ownerUserId),
          eq(folderAccess.folder, folder),
        ),
      );
    return rows.map((row) => ({
      ...row.rule,
      targetType: row.rule.roleId ? ("role" as const) : ("user" as const),
      username: row.username,
      roleName: row.roleName,
      roleDisplayName: row.roleDisplayName,
    }));
  }

  async findById(
    id: number,
    ownerUserId: string,
  ): Promise<FolderAccessRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(folderAccess)
      .where(
        and(eq(folderAccess.id, id), eq(folderAccess.ownerUserId, ownerUserId)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async deleteById(id: number, ownerUserId: string): Promise<void> {
    await this.context.drizzle
      .delete(folderAccess)
      .where(
        and(eq(folderAccess.id, id), eq(folderAccess.ownerUserId, ownerUserId)),
      );
    await this.afterWrite();
  }

  /** Follows a folder rename, including subfolders. */
  async renameFolder(
    ownerUserId: string,
    oldName: string,
    newName: string,
  ): Promise<void> {
    const prefix = `${oldName} / `;
    const rows = await this.context.drizzle
      .select({ id: folderAccess.id, folder: folderAccess.folder })
      .from(folderAccess)
      .where(
        and(
          eq(folderAccess.ownerUserId, ownerUserId),
          or(
            eq(folderAccess.folder, oldName),
            like(folderAccess.folder, `${prefix}%`),
          ),
        ),
      );
    for (const row of rows) {
      const renamed =
        row.folder === oldName
          ? newName
          : `${newName} / ${row.folder.slice(prefix.length)}`;
      await this.context.drizzle
        .update(folderAccess)
        .set({ folder: renamed })
        .where(eq(folderAccess.id, row.id));
    }
    if (rows.length) await this.afterWrite();
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
