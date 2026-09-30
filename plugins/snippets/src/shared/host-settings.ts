/**
 * The snippets plugin's host settings: the startup snippet a terminal runs
 * when it connects, and the quick action buttons Host Metrics shows.
 */

export const PLUGIN_ID = "snippets";

export interface QuickAction {
  name: string;
  snippetId: number;
}

function snippetId(value: unknown): number | null {
  const id = typeof value === "string" ? Number(value) : value;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

/** Quick actions in their stored shape, dropping any without a snippet. */
export function readQuickActions(value: unknown): QuickAction[] {
  let list = value;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry): QuickAction[] => {
    if (!entry || typeof entry !== "object") return [];
    const id = snippetId((entry as { snippetId?: unknown }).snippetId);
    if (id === null) return [];
    const name = (entry as { name?: unknown }).name;
    return [{ name: typeof name === "string" ? name : "", snippetId: id }];
  });
}

export function readStartupSnippetId(value: unknown): number | null {
  return snippetId(value);
}

/** This plugin's slice of a host record's pluginSettings. */
export function snippetHostSettings(host: unknown): Record<string, unknown> {
  const all = (host as { pluginSettings?: Record<string, unknown> } | null)
    ?.pluginSettings;
  const own = all?.[PLUGIN_ID];
  return own && typeof own === "object" ? (own as Record<string, unknown>) : {};
}
