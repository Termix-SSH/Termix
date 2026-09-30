import type { PluginApiClient } from "@termix/plugin-sdk/frontend";
import {
  normalizeTouchInputSettings,
  type TouchInputSettings,
} from "../shared/touch-input-settings";
import {
  readUserSettings,
  type TerminalUserSettings,
} from "../shared/terminal-settings";

/** Calls to this plugin's own routes under /plugin-api/ssh-terminal/. */

export interface TerminalClientSettings {
  sessionTimeoutMinutes: number;
  sessionPersistence: boolean;
  commandHistoryEnabled: boolean;
  touchInput: TouchInputSettings;
  user: TerminalUserSettings;
}

export async function getClientSettings(
  api: PluginApiClient,
): Promise<TerminalClientSettings> {
  const { data } = await api.get<TerminalClientSettings>("/client-settings");
  return {
    ...data,
    touchInput: normalizeTouchInputSettings(data?.touchInput),
    user: readUserSettings(data?.user as unknown as Record<string, unknown>),
  };
}

/** Turns auto tmux on for a host (its terminal host setting). */
export async function enableHostAutoTmux(
  api: PluginApiClient,
  hostId: number,
): Promise<void> {
  await api.put(`/hosts/${hostId}/auto-tmux`, { enabled: true });
}

export async function saveCommandToHistory(
  api: PluginApiClient,
  hostId: number,
  command: string,
): Promise<void> {
  await api.post("/command-history", { hostId, command });
}

export async function getCommandHistory(
  api: PluginApiClient,
  hostId: number,
): Promise<string[]> {
  const { data } = await api.get<string[]>(`/command-history/${hostId}`);
  return Array.isArray(data) ? data : [];
}

export async function deleteCommandFromHistory(
  api: PluginApiClient,
  hostId: number,
  command: string,
): Promise<void> {
  await api.post("/command-history/delete", { hostId, command });
}

export async function clearCommandHistory(
  api: PluginApiClient,
  hostId: number,
): Promise<void> {
  await api.delete(`/command-history/${hostId}`);
}

/** A host-scope setting of this plugin, as the host payload carries it. */
export function hostSetting(
  host: object | null | undefined,
  key: string,
  fallback: boolean,
): boolean {
  const settings = (
    host as { pluginSettings?: Record<string, Record<string, unknown>> } | null
  )?.pluginSettings;
  const value = settings?.["ssh-terminal"]?.[key];
  return typeof value === "boolean" ? value : fallback;
}
