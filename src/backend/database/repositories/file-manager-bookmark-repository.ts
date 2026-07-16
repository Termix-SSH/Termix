import { and, desc, eq, inArray } from "drizzle-orm";
import {
  fileManagerPinned,
  fileManagerRecent,
  fileManagerShortcuts,
} from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

export type FileManagerRecentRecord = typeof fileManagerRecent.$inferSelect;
export type FileManagerPinnedRecord = typeof fileManagerPinned.$inferSelect;
export type FileManagerShortcutRecord =
  typeof fileManagerShortcuts.$inferSelect;

export interface FileManagerBookmarkInput {
  hostId: number;
  path: string;
  name?: string | null;
}

function resolveBookmarkName(path: string, name?: string | null): string {
  return name || path.split("/").pop() || "Unknown";
}

export class FileManagerBookmarkRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listRecentForHost(
    userId: string,
    hostId: number,
    limit = 20,
  ): Promise<FileManagerRecentRecord[]> {
    return this.context.drizzle
      .select()
      .from(fileManagerRecent)
      .where(
        and(
          eq(fileManagerRecent.userId, userId),
          eq(fileManagerRecent.hostId, hostId),
        ),
      )
      .orderBy(desc(fileManagerRecent.lastOpened))
      .limit(limit);
  }

  async listRecentByUserId(userId: string): Promise<FileManagerRecentRecord[]> {
    return this.context.drizzle
      .select()
      .from(fileManagerRecent)
      .where(eq(fileManagerRecent.userId, userId));
  }

  async upsertRecent(
    userId: string,
    input: FileManagerBookmarkInput,
    lastOpened = new Date().toISOString(),
  ): Promise<void> {
    const [existing] = await this.context.drizzle
      .select({ id: fileManagerRecent.id })
      .from(fileManagerRecent)
      .where(
        and(
          eq(fileManagerRecent.userId, userId),
          eq(fileManagerRecent.hostId, input.hostId),
          eq(fileManagerRecent.path, input.path),
        ),
      )
      .limit(1);

    if (existing) {
      await this.context.drizzle
        .update(fileManagerRecent)
        .set({ lastOpened })
        .where(eq(fileManagerRecent.id, existing.id));
    } else {
      await this.context.drizzle.insert(fileManagerRecent).values({
        userId,
        hostId: input.hostId,
        path: input.path,
        name: resolveBookmarkName(input.path, input.name),
        lastOpened,
      });
    }

    await this.afterWrite();
  }

  async createRecentForImport(
    userId: string,
    input: FileManagerBookmarkInput,
    lastOpened = new Date().toISOString(),
  ): Promise<boolean> {
    const exists = await this.existsRecentImportItem(userId, input);
    if (exists) {
      return false;
    }

    await this.context.drizzle.insert(fileManagerRecent).values({
      userId,
      hostId: input.hostId,
      path: input.path,
      name: resolveBookmarkName(input.path, input.name),
      lastOpened,
    });
    await this.afterWrite();
    return true;
  }

  async deleteRecentForHostPath(
    userId: string,
    input: Pick<FileManagerBookmarkInput, "hostId" | "path">,
  ): Promise<number> {
    const rows = await this.context.drizzle
      .delete(fileManagerRecent)
      .where(
        and(
          eq(fileManagerRecent.userId, userId),
          eq(fileManagerRecent.hostId, input.hostId),
          eq(fileManagerRecent.path, input.path),
        ),
      )
      .returning({ id: fileManagerRecent.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async listPinnedForHost(
    userId: string,
    hostId: number,
  ): Promise<FileManagerPinnedRecord[]> {
    return this.context.drizzle
      .select()
      .from(fileManagerPinned)
      .where(
        and(
          eq(fileManagerPinned.userId, userId),
          eq(fileManagerPinned.hostId, hostId),
        ),
      )
      .orderBy(desc(fileManagerPinned.pinnedAt));
  }

  async listPinnedByUserId(userId: string): Promise<FileManagerPinnedRecord[]> {
    return this.context.drizzle
      .select()
      .from(fileManagerPinned)
      .where(eq(fileManagerPinned.userId, userId));
  }

  async createPinned(
    userId: string,
    input: FileManagerBookmarkInput,
    pinnedAt = new Date().toISOString(),
  ): Promise<boolean> {
    const exists = await this.existsPinned(userId, input.hostId, input.path);
    if (exists) {
      return false;
    }

    await this.context.drizzle.insert(fileManagerPinned).values({
      userId,
      hostId: input.hostId,
      path: input.path,
      name: resolveBookmarkName(input.path, input.name),
      pinnedAt,
    });
    await this.afterWrite();
    return true;
  }

  async createPinnedForImport(
    userId: string,
    input: FileManagerBookmarkInput,
    pinnedAt = new Date().toISOString(),
  ): Promise<boolean> {
    const exists = await this.existsPinnedImportItem(userId, input);
    if (exists) {
      return false;
    }

    await this.context.drizzle.insert(fileManagerPinned).values({
      userId,
      hostId: input.hostId,
      path: input.path,
      name: resolveBookmarkName(input.path, input.name),
      pinnedAt,
    });
    await this.afterWrite();
    return true;
  }

  async deletePinnedForHostPath(
    userId: string,
    input: Pick<FileManagerBookmarkInput, "hostId" | "path">,
  ): Promise<number> {
    const rows = await this.context.drizzle
      .delete(fileManagerPinned)
      .where(
        and(
          eq(fileManagerPinned.userId, userId),
          eq(fileManagerPinned.hostId, input.hostId),
          eq(fileManagerPinned.path, input.path),
        ),
      )
      .returning({ id: fileManagerPinned.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async listShortcutsForHost(
    userId: string,
    hostId: number,
  ): Promise<FileManagerShortcutRecord[]> {
    return this.context.drizzle
      .select()
      .from(fileManagerShortcuts)
      .where(
        and(
          eq(fileManagerShortcuts.userId, userId),
          eq(fileManagerShortcuts.hostId, hostId),
        ),
      )
      .orderBy(desc(fileManagerShortcuts.createdAt));
  }

  async listShortcutsByUserId(
    userId: string,
  ): Promise<FileManagerShortcutRecord[]> {
    return this.context.drizzle
      .select()
      .from(fileManagerShortcuts)
      .where(eq(fileManagerShortcuts.userId, userId));
  }

  async createShortcut(
    userId: string,
    input: FileManagerBookmarkInput,
    createdAt = new Date().toISOString(),
  ): Promise<boolean> {
    const exists = await this.existsShortcut(userId, input.hostId, input.path);
    if (exists) {
      return false;
    }

    await this.context.drizzle.insert(fileManagerShortcuts).values({
      userId,
      hostId: input.hostId,
      path: input.path,
      name: resolveBookmarkName(input.path, input.name),
      createdAt,
    });
    await this.afterWrite();
    return true;
  }

  async createShortcutForImport(
    userId: string,
    input: FileManagerBookmarkInput,
    createdAt = new Date().toISOString(),
  ): Promise<boolean> {
    const exists = await this.existsShortcutImportItem(userId, input);
    if (exists) {
      return false;
    }

    await this.context.drizzle.insert(fileManagerShortcuts).values({
      userId,
      hostId: input.hostId,
      path: input.path,
      name: resolveBookmarkName(input.path, input.name),
      createdAt,
    });
    await this.afterWrite();
    return true;
  }

  async deleteShortcutForHostPath(
    userId: string,
    input: Pick<FileManagerBookmarkInput, "hostId" | "path">,
  ): Promise<number> {
    const rows = await this.context.drizzle
      .delete(fileManagerShortcuts)
      .where(
        and(
          eq(fileManagerShortcuts.userId, userId),
          eq(fileManagerShortcuts.hostId, input.hostId),
          eq(fileManagerShortcuts.path, input.path),
        ),
      )
      .returning({ id: fileManagerShortcuts.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const total =
      (await this.deleteRecentByUserId(userId)) +
      (await this.deletePinnedByUserId(userId)) +
      (await this.deleteShortcutsByUserId(userId));

    if (total > 0) {
      await this.afterWrite();
    }

    return total;
  }

  async deleteByHostId(hostId: number): Promise<number> {
    const total =
      (await this.deleteRecentByHostId(hostId)) +
      (await this.deletePinnedByHostId(hostId)) +
      (await this.deleteShortcutsByHostId(hostId));

    if (total > 0) {
      await this.afterWrite();
    }

    return total;
  }

  async deleteByHostIds(hostIds: number[]): Promise<number> {
    if (hostIds.length === 0) {
      return 0;
    }

    const total =
      (await this.deleteRecentByHostIds(hostIds)) +
      (await this.deletePinnedByHostIds(hostIds)) +
      (await this.deleteShortcutsByHostIds(hostIds));

    if (total > 0) {
      await this.afterWrite();
    }

    return total;
  }

  private async existsPinned(
    userId: string,
    hostId: number,
    path: string,
  ): Promise<boolean> {
    const rows = await this.context.drizzle
      .select({ id: fileManagerPinned.id })
      .from(fileManagerPinned)
      .where(
        and(
          eq(fileManagerPinned.userId, userId),
          eq(fileManagerPinned.hostId, hostId),
          eq(fileManagerPinned.path, path),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  private async existsRecentImportItem(
    userId: string,
    input: FileManagerBookmarkInput,
  ): Promise<boolean> {
    const rows = await this.context.drizzle
      .select({ id: fileManagerRecent.id })
      .from(fileManagerRecent)
      .where(
        and(
          eq(fileManagerRecent.userId, userId),
          eq(fileManagerRecent.path, input.path),
          eq(
            fileManagerRecent.name,
            resolveBookmarkName(input.path, input.name),
          ),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  private async existsPinnedImportItem(
    userId: string,
    input: FileManagerBookmarkInput,
  ): Promise<boolean> {
    const rows = await this.context.drizzle
      .select({ id: fileManagerPinned.id })
      .from(fileManagerPinned)
      .where(
        and(
          eq(fileManagerPinned.userId, userId),
          eq(fileManagerPinned.path, input.path),
          eq(
            fileManagerPinned.name,
            resolveBookmarkName(input.path, input.name),
          ),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  private async existsShortcutImportItem(
    userId: string,
    input: FileManagerBookmarkInput,
  ): Promise<boolean> {
    const rows = await this.context.drizzle
      .select({ id: fileManagerShortcuts.id })
      .from(fileManagerShortcuts)
      .where(
        and(
          eq(fileManagerShortcuts.userId, userId),
          eq(fileManagerShortcuts.path, input.path),
          eq(
            fileManagerShortcuts.name,
            resolveBookmarkName(input.path, input.name),
          ),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  private async existsShortcut(
    userId: string,
    hostId: number,
    path: string,
  ): Promise<boolean> {
    const rows = await this.context.drizzle
      .select({ id: fileManagerShortcuts.id })
      .from(fileManagerShortcuts)
      .where(
        and(
          eq(fileManagerShortcuts.userId, userId),
          eq(fileManagerShortcuts.hostId, hostId),
          eq(fileManagerShortcuts.path, path),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  private async deleteRecentByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(fileManagerRecent)
      .where(eq(fileManagerRecent.userId, userId))
      .returning({ id: fileManagerRecent.id });
    return rows.length;
  }

  private async deletePinnedByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(fileManagerPinned)
      .where(eq(fileManagerPinned.userId, userId))
      .returning({ id: fileManagerPinned.id });
    return rows.length;
  }

  private async deleteShortcutsByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(fileManagerShortcuts)
      .where(eq(fileManagerShortcuts.userId, userId))
      .returning({ id: fileManagerShortcuts.id });
    return rows.length;
  }

  private async deleteRecentByHostId(hostId: number): Promise<number> {
    const rows = await this.context.drizzle
      .delete(fileManagerRecent)
      .where(eq(fileManagerRecent.hostId, hostId))
      .returning({ id: fileManagerRecent.id });
    return rows.length;
  }

  private async deletePinnedByHostId(hostId: number): Promise<number> {
    const rows = await this.context.drizzle
      .delete(fileManagerPinned)
      .where(eq(fileManagerPinned.hostId, hostId))
      .returning({ id: fileManagerPinned.id });
    return rows.length;
  }

  private async deleteShortcutsByHostId(hostId: number): Promise<number> {
    const rows = await this.context.drizzle
      .delete(fileManagerShortcuts)
      .where(eq(fileManagerShortcuts.hostId, hostId))
      .returning({ id: fileManagerShortcuts.id });
    return rows.length;
  }

  private async deleteRecentByHostIds(hostIds: number[]): Promise<number> {
    const rows = await this.context.drizzle
      .delete(fileManagerRecent)
      .where(inArray(fileManagerRecent.hostId, hostIds))
      .returning({ id: fileManagerRecent.id });
    return rows.length;
  }

  private async deletePinnedByHostIds(hostIds: number[]): Promise<number> {
    const rows = await this.context.drizzle
      .delete(fileManagerPinned)
      .where(inArray(fileManagerPinned.hostId, hostIds))
      .returning({ id: fileManagerPinned.id });
    return rows.length;
  }

  private async deleteShortcutsByHostIds(hostIds: number[]): Promise<number> {
    const rows = await this.context.drizzle
      .delete(fileManagerShortcuts)
      .where(inArray(fileManagerShortcuts.hostId, hostIds))
      .returning({ id: fileManagerShortcuts.id });
    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
