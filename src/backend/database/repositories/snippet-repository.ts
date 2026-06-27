import { and, asc, eq, sql } from "drizzle-orm";
import { snippetFolders, snippets } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

export type SnippetRecord = typeof snippets.$inferSelect;
export type SnippetFolderRecord = typeof snippetFolders.$inferSelect;
export interface RenameSnippetFolderResult {
  status: "renamed" | "missing" | "conflict";
}

export class SnippetRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async findOwnedById(
    userId: string,
    snippetId: number,
  ): Promise<SnippetRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(snippets)
      .where(and(eq(snippets.id, snippetId), eq(snippets.userId, userId)))
      .limit(1);

    return rows[0] ?? null;
  }

  async listFolders(userId: string): Promise<SnippetFolderRecord[]> {
    return this.context.drizzle
      .select()
      .from(snippetFolders)
      .where(eq(snippetFolders.userId, userId))
      .orderBy(asc(snippetFolders.name));
  }

  async listSnippetsForExport(userId: string): Promise<SnippetRecord[]> {
    return this.context.drizzle
      .select()
      .from(snippets)
      .where(eq(snippets.userId, userId))
      .orderBy(asc(snippets.folder), asc(snippets.order));
  }

  async listFoldersForExport(userId: string): Promise<SnippetFolderRecord[]> {
    return this.listFolders(userId);
  }

  async createFolder(
    userId: string,
    name: string,
    color: string | null | undefined,
    icon: string | null | undefined,
  ): Promise<SnippetFolderRecord | null> {
    const existing = await this.findFolderByName(userId, name);
    if (existing) return null;

    const rows = await this.context.drizzle
      .insert(snippetFolders)
      .values({
        userId,
        name: name.trim(),
        color: color?.trim() || null,
        icon: icon?.trim() || null,
      })
      .returning();

    await this.afterWrite();
    return rows[0] ?? null;
  }

  async updateFolderMetadata(
    userId: string,
    name: string,
    color: string | null | undefined,
    icon: string | null | undefined,
  ): Promise<SnippetFolderRecord | null> {
    const existing = await this.findFolderByName(userId, name);
    if (!existing) return null;

    const updateFields: Partial<{
      color: string | null;
      icon: string | null;
      updatedAt: ReturnType<typeof sql>;
    }> = {
      updatedAt: sql`CURRENT_TIMESTAMP`,
    };

    if (color !== undefined) updateFields.color = color?.trim() || null;
    if (icon !== undefined) updateFields.icon = icon?.trim() || null;

    const rows = await this.context.drizzle
      .update(snippetFolders)
      .set(updateFields)
      .where(
        and(eq(snippetFolders.userId, userId), eq(snippetFolders.name, name)),
      )
      .returning();

    await this.afterWrite();
    return rows[0] ?? null;
  }

  async renameFolder(
    userId: string,
    oldName: string,
    newName: string,
  ): Promise<RenameSnippetFolderResult> {
    const existing = await this.findFolderByName(userId, oldName);
    if (!existing) return { status: "missing" };

    const nameExists = await this.findFolderByName(userId, newName);
    if (nameExists) return { status: "conflict" };

    await this.context.drizzle
      .update(snippetFolders)
      .set({ name: newName, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(
        and(
          eq(snippetFolders.userId, userId),
          eq(snippetFolders.name, oldName),
        ),
      );

    await this.context.drizzle
      .update(snippets)
      .set({ folder: newName })
      .where(and(eq(snippets.userId, userId), eq(snippets.folder, oldName)));

    await this.afterWrite();
    return { status: "renamed" };
  }

  async deleteFolder(userId: string, name: string): Promise<void> {
    await this.context.drizzle
      .update(snippets)
      .set({ folder: null })
      .where(and(eq(snippets.userId, userId), eq(snippets.folder, name)));

    await this.context.drizzle
      .delete(snippetFolders)
      .where(
        and(eq(snippetFolders.userId, userId), eq(snippetFolders.name, name)),
      );

    await this.afterWrite();
  }

  private async findFolderByName(
    userId: string,
    name: string,
  ): Promise<SnippetFolderRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(snippetFolders)
      .where(
        and(eq(snippetFolders.userId, userId), eq(snippetFolders.name, name)),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
