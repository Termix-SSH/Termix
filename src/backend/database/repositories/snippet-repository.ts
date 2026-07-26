import { and, asc, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { snippetFolders, snippets } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

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
        syncId: randomUUID(),
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

  async deleteByUserId(userId: string): Promise<{
    snippetsDeleted: number;
    foldersDeleted: number;
  }> {
    const deletedSnippets = await this.context.drizzle
      .delete(snippets)
      .where(eq(snippets.userId, userId))
      .returning({ id: snippets.id });

    const deletedFolders = await this.context.drizzle
      .delete(snippetFolders)
      .where(eq(snippetFolders.userId, userId))
      .returning({ id: snippetFolders.id });

    if (deletedSnippets.length > 0 || deletedFolders.length > 0) {
      await this.afterWrite();
    }

    return {
      snippetsDeleted: deletedSnippets.length,
      foldersDeleted: deletedFolders.length,
    };
  }

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

    let changed = false;

    if (Array.isArray(foldersToImport)) {
      for (const rawFolder of foldersToImport) {
        const folder = rawFolder as BulkImportFolderInput;
        if (!isNonEmptyString(folder.name)) {
          results.failed++;
          results.errors.push(`Folder missing name`);
          continue;
        }

        const created = await this.createFolder(
          userId,
          folder.name,
          folder.color,
          folder.icon,
          false,
        );

        if (!created) {
          results.foldersSkipped++;
          continue;
        }

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
        const existing = await this.findByNameAndFolder(
          userId,
          snippet.name.trim(),
          folderVal,
        );

        if (existing) {
          if (!overwrite) {
            results.snippetsSkipped++;
            continue;
          }

          await this.context.drizzle
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

        const maxOrder = await this.maxOrderForFolder(userId, folderVal);
        await this.context.drizzle.insert(snippets).values({
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

    if (changed) {
      await this.afterWrite();
    }

    return results;
  }

  async createFolder(
    userId: string,
    name: string,
    color: string | null | undefined,
    icon: string | null | undefined,
    triggerSave = true,
  ): Promise<SnippetFolderRecord | null> {
    const existing = await this.findFolderByName(userId, name);
    if (existing) return null;

    const rows = await this.context.drizzle
      .insert(snippetFolders)
      .values({
        syncId: randomUUID(),
        userId,
        name: name.trim(),
        color: color?.trim() || null,
        icon: icon?.trim() || null,
      })
      .returning();

    if (triggerSave) {
      await this.afterWrite();
    }
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

  async deleteFolder(
    userId: string,
    name: string,
  ): Promise<{ syncId: string | null } | null> {
    await this.context.drizzle
      .update(snippets)
      .set({ folder: null })
      .where(and(eq(snippets.userId, userId), eq(snippets.folder, name)));

    const rows = await this.context.drizzle
      .delete(snippetFolders)
      .where(
        and(eq(snippetFolders.userId, userId), eq(snippetFolders.name, name)),
      )
      .returning({ syncId: snippetFolders.syncId });

    await this.afterWrite();
    return rows[0] ?? null;
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
    return (await this.maxOrderForFolder(userId, folder || null)) + 1;
  }

  private async maxOrderForFolder(
    userId: string,
    folder: string | null,
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
    return maxOrder;
  }

  private async findByNameAndFolder(
    userId: string,
    name: string,
    folder: string | null,
  ): Promise<SnippetRecord | null> {
    const rows = await this.context.drizzle
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

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
