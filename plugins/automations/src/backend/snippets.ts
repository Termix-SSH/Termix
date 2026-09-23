import type { PluginServices } from "@termix/plugin-sdk/backend";

let current: PluginServices | null = null;

/** Set in activate, cleared on deactivate. */
export function setPluginServices(services: PluginServices | null): void {
  current = services;
}

/** Another plugin's snippets, as ctx.services.get("snippets.access") returns them. */
interface SnippetsAccess {
  get: (id: number) => Promise<{
    id: number;
    name: string;
    content: string;
    isNote: boolean;
  } | null>;
  resolveCommand: (
    id: number,
    vars: { ip?: string; username?: string; port?: number; name?: string },
    inputValues?: Record<string, string>,
  ) => Promise<string | null>;
}

/**
 * A snippet's command, resolved against a target host and run as userId.
 * Null when the snippets plugin is off, the user may not use it, or the
 * snippet does not exist. Optional: the run_snippet step fails with a clear
 * message without it, rather than the plugin failing to activate.
 */
export async function resolveSnippetCommandFor(
  userId: string,
  id: number,
  vars: { ip?: string; username?: string; port?: number; name?: string },
  inputValues?: Record<string, string>,
): Promise<string | null> {
  if (!current) return null;
  try {
    return await current
      .get<SnippetsAccess>("snippets.access", { userId })
      .resolveCommand(id, vars, inputValues);
  } catch {
    return null;
  }
}

export async function getSnippet(
  userId: string,
  id: number,
): Promise<{
  id: number;
  name: string;
  content: string;
  isNote: boolean;
} | null> {
  if (!current) return null;
  try {
    return await current
      .get<SnippetsAccess>("snippets.access", { userId })
      .get(id);
  } catch {
    return null;
  }
}
