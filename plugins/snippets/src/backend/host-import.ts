import {
  PLUGIN_ID,
  readQuickActions,
  readStartupSnippetId,
} from "../shared/host-settings.js";

/**
 * Registered as "snippets.hostImportNormalizer": a 2.8 or early 2.9 export
 * carried quick actions as a host field and the startup snippet inside
 * terminalConfig. An export that already carries this plugin's
 * pluginSettings has had them written by core.
 */
export function hostImportNormalizer(
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  const carried = (raw.pluginSettings as Record<string, unknown> | undefined)?.[
    PLUGIN_ID
  ];
  if (
    carried &&
    typeof carried === "object" &&
    Object.keys(carried).length > 0
  ) {
    return null;
  }

  const values: Record<string, unknown> = {};
  const quickActions = readQuickActions(raw.quickActions);
  if (quickActions.length > 0) values.quickActions = quickActions;

  let terminalConfig = raw.terminalConfig;
  if (typeof terminalConfig === "string") {
    try {
      terminalConfig = JSON.parse(terminalConfig);
    } catch {
      terminalConfig = null;
    }
  }
  const startup = readStartupSnippetId(
    (terminalConfig as { startupSnippetId?: unknown } | null)?.startupSnippetId,
  );
  if (startup !== null) values.startupSnippetId = startup;

  return Object.keys(values).length > 0 ? values : null;
}

/**
 * Registered as "snippets.hostPayloadLegacy": quickActions and
 * terminalConfig.startupSnippetId in their 2.8 shape, for clients that
 * still read them (Termix-Mobile). Remove once the mobile app reads
 * pluginSettings.snippets.
 */
export function hostPayloadLegacy(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    quickActions: readQuickActions(values.quickActions),
  };
  const startup = readStartupSnippetId(values.startupSnippetId);
  if (startup !== null) out.terminalConfig = { startupSnippetId: startup };
  return out;
}

/** What hostSettingsSync needs from the repository. */
export interface SnippetSyncLookup {
  findSyncIdById: (id: number) => Promise<string | null>;
  findIdBySyncId: (syncId: string) => Promise<number | null>;
}

/**
 * Registered as "snippets.hostSettingsSync": both host settings hold local
 * snippet ids, so remote sync carries the snippets' sync ids instead, which
 * are the same on both sides.
 */
export function createHostSettingsSync(lookup: SnippetSyncLookup) {
  const toSyncId = async (id: number) => lookup.findSyncIdById(id);
  const toId = async (value: unknown) =>
    typeof value === "string" && value ? lookup.findIdBySyncId(value) : null;

  return {
    exportValue: async (key: string, value: unknown) => {
      if (key === "startupSnippetId") {
        const id = readStartupSnippetId(value);
        return id === null ? null : await toSyncId(id);
      }
      if (key === "quickActions") {
        const actions = readQuickActions(value);
        const out = [];
        for (const action of actions) {
          const syncId = await toSyncId(action.snippetId);
          if (syncId) out.push({ name: action.name, snippetId: syncId });
        }
        return out;
      }
      return value;
    },
    importValue: async (key: string, value: unknown) => {
      if (key === "startupSnippetId") return await toId(value);
      if (key === "quickActions") {
        if (!Array.isArray(value)) return [];
        const out = [];
        for (const entry of value) {
          const row = (entry ?? {}) as { name?: unknown; snippetId?: unknown };
          const id = await toId(row.snippetId);
          if (id !== null) {
            out.push({
              name: typeof row.name === "string" ? row.name : "",
              snippetId: id,
            });
          }
        }
        return out;
      }
      return value;
    },
  };
}
