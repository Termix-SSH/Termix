import { and, eq, like, or, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { hosts, sshCredentials, sshFolders } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

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
      .where(and(eq(hosts.userId, userId), folderMatch(hosts.folder)))
      .returning({ id: hosts.id });

    const updatedCredentials = await this.context.drizzle
      .update(sshCredentials)
      .set({ folder: renameExpr(sshCredentials.folder), updatedAt: now })
      .where(
        and(
          eq(sshCredentials.userId, userId),
          folderMatch(sshCredentials.folder),
        ),
      )
      .returning({ id: sshCredentials.id });

    await this.context.drizzle
      .update(sshFolders)
      .set({ name: renameExpr(sshFolders.name), updatedAt: now })
      .where(and(eq(sshFolders.userId, userId), folderMatch(sshFolders.name)));

    await this.afterWrite();
    return {
      updatedHosts: updatedHosts.length,
      updatedCredentials: updatedCredentials.length,
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
    now = new Date().toISOString(),
  ): Promise<{ folder: HostFolderRecord; created: boolean }> {
    const existing = await this.findFolder(userId, name);
    if (existing) {
      const [updated] = await this.context.drizzle
        .update(sshFolders)
        .set({ color, icon, updatedAt: now })
        .where(and(eq(sshFolders.userId, userId), eq(sshFolders.name, name)))
        .returning();

      await this.afterWrite();
      return { folder: updated, created: false };
    }

    const [created] = await this.context.drizzle
      .insert(sshFolders)
      .values({
        userId,
        name,
        color,
        icon,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

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
  ): Promise<void> {
    const folderMatch = (col: SQLiteColumn) =>
      or(eq(col, folderName), like(col, `${folderName} / %`));

    const hostsToDelete = await this.listHostsInFolder(userId, folderName);
    if (hostsToDelete.length > 0) {
      await this.context.drizzle
        .delete(hosts)
        .where(and(eq(hosts.userId, userId), folderMatch(hosts.folder)));
    }

    await this.context.drizzle
      .delete(sshFolders)
      .where(and(eq(sshFolders.userId, userId), folderMatch(sshFolders.name)));

    await this.afterWrite();
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
