import { and, asc, eq, sql } from "drizzle-orm";
import { snippetFolders, snippets } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

export type SnippetRecord = typeof snippets.$inferSelect;
export type SnippetFolderRecord = typeof snippetFolders.$inferSelect;
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
}
export interface SnippetUpdateInput {
  name?: string;
  content?: string;
  description?: string | null;
  folder?: string | null;
  order?: number;
  hostFilter?: unknown;
}
export interface UpdateSnippetResult {
  existing: SnippetRecord;
  updated: SnippetRecord;
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

  async listOwnedSnippets(userId: string): Promise<SnippetRecord[]> {
    return this.context.drizzle
      .select()
      .from(snippets)
      .where(eq(snippets.userId, userId))
      .orderBy(
        sql`CASE WHEN ${snippets.folder} IS NULL OR ${snippets.folder} = '' THEN 0 ELSE 1 END`,
        asc(snippets.folder),
        asc(snippets.order),
        sql`${snippets.updatedAt} DESC`,
      );
  }

  async reorderSnippets(
    userId: string,
    updates: SnippetReorderUpdate[],
  ): Promise<void> {
    for (const update of updates) {
      const { id, order, folder } = update;

      if (!id || order === undefined) {
        continue;
      }

      const updateFields: Partial<{
        order: number;
        folder: string | null;
      }> = {
        order,
      };

      if (folder !== undefined) {
        updateFields.folder = folder?.trim() || null;
      }

      await this.context.drizzle
        .update(snippets)
        .set(updateFields)
        .where(and(eq(snippets.id, id), eq(snippets.userId, userId)));
    }

    await this.afterWrite();
  }

  async createSnippet(
    userId: string,
    input: NewSnippetInput,
  ): Promise<SnippetRecord> {
    const folderValue = input.folder?.trim() || "";
    const order =
      input.order === undefined || input.order === null
        ? await this.nextOrderForFolder(userId, folderValue)
        : input.order;

    const rows = await this.context.drizzle
      .insert(snippets)
      .values({
        userId,
        name: input.name.trim(),
        content: input.content.trim(),
        description: input.description?.trim() || null,
        folder: input.folder?.trim() || null,
        order,
        hostFilter: input.hostFilter ? JSON.stringify(input.hostFilter) : null,
      })
      .returning();

    await this.afterWrite();
    return rows[0];
  }

  async updateSnippet(
    userId: string,
    snippetId: number,
    input: SnippetUpdateInput,
  ): Promise<UpdateSnippetResult | null> {
    const existing = await this.findOwnedById(userId, snippetId);
    if (!existing) return null;

    const updateFields: Partial<{
      updatedAt: ReturnType<typeof sql>;
      name: string;
      content: string;
      description: string | null;
      folder: string | null;
      order: number;
      hostFilter: string | null;
    }> = {
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

    const rows = await this.context.drizzle
      .update(snippets)
      .set(updateFields)
      .where(and(eq(snippets.id, snippetId), eq(snippets.userId, userId)))
      .returning();

    await this.afterWrite();
    return { existing, updated: rows[0] };
  }

  async deleteSnippet(
    userId: string,
    snippetId: number,
  ): Promise<SnippetRecord | null> {
    const existing = await this.findOwnedById(userId, snippetId);
    if (!existing) return null;

    await this.context.drizzle
      .delete(snippets)
      .where(and(eq(snippets.id, snippetId), eq(snippets.userId, userId)));

    await this.afterWrite();
    return existing;
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

  private async nextOrderForFolder(
    userId: string,
    folder: string,
  ): Promise<number> {
    const maxOrderResult = await this.context.drizzle
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
    const maxOrder = maxOrderResult[0]?.maxOrder ?? -1;
    return maxOrder + 1;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
