import { authApi, handleApiError } from "@/main-axios";

/**
 * A snippet row as the list endpoint returns it. Callers that need the full
 * shape narrow it themselves; only the id is relied on across the app.
 *
 * Snippets themselves are owned by the snippets plugin
 * (/plugin-api/snippets); this is the thin read/run surface used by a few
 * core and plugin callers (the host editor's startup snippet, the command
 * palette, custom keybindings, host-metrics quick actions) that cannot
 * reach into the snippets plugin's own frontend code.
 */
export interface SnippetRow {
  id: number;
  [key: string]: unknown;
}

export async function getSnippets(): Promise<SnippetRow[]> {
  try {
    const response = await authApi.get("/plugin-api/snippets");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch snippets");
  }
}

export async function executeSnippet(
  snippetId: number,
  hostId: number,
  inputValues?: Record<string, string>,
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const response = await authApi.post("/plugin-api/snippets/execute", {
      snippetId,
      hostId,
      ...(inputValues ? { inputValues } : {}),
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "execute snippet");
  }
}
