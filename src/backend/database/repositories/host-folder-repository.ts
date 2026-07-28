import { and, eq, like, or, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { hosts, sshCredentials, sshFolders } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import {
  deleteReturning,
  insertReturning,
  updateReturning,
} from "./returning.js";

export type HostFolderRecord = typeof sshFolders.$inferSelect;
export type HostFolderHostRecord = typeof hosts.$inferSelect;

export interface RenameFolderResult {
  updatedHosts: number;
  updatedCredentials: number;
}

export class HostFolderRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async renameFolder(
    userId: string,
    oldName: string,
    newName: string,
    now = new Date().toISOString(),
  ): Promise<RenameFolderResult> {
    const oldPrefix = `${oldName} / `;
    const newPrefix = `${newName} / `;
    const childLike = `${oldPrefix}%`;
    const renameExpr = (col: SQLiteColumn) =>
      sql`CASE WHEN ${col} = ${oldName} THEN ${newName} ELSE ${newPrefix} || substr(${col}, ${oldPrefix.length + 1}) END`;
    const folderMatch = (col: SQLiteColumn) =>
      or(eq(col, oldName), like(col, childLike));

    const updatedHosts = await this.context.drizzle
      .update(hosts)
      .set({ folder: renameExpr(hosts.folder), updatedAt: now })
      .where(and(eq(hosts.userId, userId), folderMatch(hosts.folder)));

    const updatedCredentials = await this.context.drizzle
      .update(sshCredentials)
      .set({ folder: renameExpr(sshCredentials.folder), updatedAt: now })
      .where(
        and(
          eq(sshCredentials.userId, userId),
          folderMatch(sshCredentials.folder),
        ),
      );

    await this.context.drizzle
      .update(sshFolders)
      .set({ name: renameExpr(sshFolders.name), updatedAt: now })
      .where(and(eq(sshFolders.userId, userId), folderMatch(sshFolders.name)));

    await this.afterWrite();
    return {
      updatedHosts: rowsAffected(updatedHosts),
      updatedCredentials: rowsAffected(updatedCredentials),
    };
  }

  async listFolders(userId: string): Promise<HostFolderRecord[]> {
    return this.context.drizzle
      .select()
      .from(sshFolders)
      .where(eq(sshFolders.userId, userId));
  }

  async upsertMetadata(
    userId: string,
    name: string,
    color: string | null | undefined,
    icon: string | null | undefined,
    credentialId?: number | null,
    now = new Date().toISOString(),
  ): Promise<{ folder: HostFolderRecord; created: boolean }> {
    const existing = await this.findFolder(userId, name);
    if (existing) {
      const [updated] = await updateReturning(
        this.context,
        sshFolders,
        {
          color,
          icon,
          credentialId:
            credentialId === undefined ? existing.credentialId : credentialId,
          updatedAt: now,
        },
        and(eq(sshFolders.userId, userId), eq(sshFolders.name, name)),
      );

      await this.afterWrite();
      return { folder: updated, created: false };
    }

    const [created] = await insertReturning(this.context, sshFolders, {
      syncId: randomUUID(),
      userId,
      name,
      color,
      icon,
      credentialId: credentialId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    await this.afterWrite();
    return { folder: created, created: true };
  }

  async listHostsInFolder(
    userId: string,
    folderName: string,
  ): Promise<HostFolderHostRecord[]> {
    const folderMatch = (col: SQLiteColumn) =>
      or(eq(col, folderName), like(col, `${folderName} / %`));

    return this.context.drizzle
      .select()
      .from(hosts)
      .where(and(eq(hosts.userId, userId), folderMatch(hosts.folder)));
  }

  async deleteHostsAndFolderRecords(
    userId: string,
    folderName: string,
  ): Promise<{ hostSyncIds: string[]; folderSyncIds: string[] }> {
    const folderMatch = (col: SQLiteColumn) =>
      or(eq(col, folderName), like(col, `${folderName} / %`));

    const hostsToDelete = await this.listHostsInFolder(userId, folderName);
    if (hostsToDelete.length > 0) {
      await this.context.drizzle
        .delete(hosts)
        .where(and(eq(hosts.userId, userId), folderMatch(hosts.folder)));
    }

    const deletedFolders = await deleteReturning(
      this.context,
      sshFolders,
      and(eq(sshFolders.userId, userId), folderMatch(sshFolders.name)),
    );

    await this.afterWrite();

    return {
      hostSyncIds: hostsToDelete
        .map((h) => h.syncId)
        .filter((id): id is string => !!id),
      folderSyncIds: deletedFolders
        .map((f) => f.syncId)
        .filter((id): id is string => !!id),
    };
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(sshFolders)
      .where(eq(sshFolders.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  private async findFolder(
    userId: string,
    name: string,
  ): Promise<HostFolderRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(sshFolders)
      .where(and(eq(sshFolders.userId, userId), eq(sshFolders.name, name)))
      .limit(1);

    return rows[0] ?? null;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
