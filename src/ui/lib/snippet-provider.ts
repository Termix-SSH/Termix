import { invokeAction } from "@/shell/action-registry";

/** A snippet as core's pickers show it. */
export interface SnippetRow {
  id: number;
  name: string;
  content: string;
  folder?: string | null;
  isNote?: boolean;
}

/**
 * The user's snippets, from whichever plugin provides them through the
 * "snippet.list" action. Empty while no plugin does. An admin editing
 * another user's host passes that user's id.
 */
export async function listSnippets(options?: {
  targetUserId?: string;
}): Promise<SnippetRow[]> {
  const rows = await invokeAction("snippet.list", options);
  return Array.isArray(rows) ? (rows as SnippetRow[]) : [];
}
