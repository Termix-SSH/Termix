import { and, asc, eq } from "drizzle-orm";
import { snippetFolders, snippets } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

export type SnippetRecord = typeof snippets.$inferSelect;
export type SnippetFolderRecord = typeof snippetFolders.$inferSelect;

export class SnippetRepository {
  constructor(private readonly context: DatabaseContext) {}

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
}
