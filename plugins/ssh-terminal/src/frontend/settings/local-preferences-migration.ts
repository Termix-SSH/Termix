import type { TermixApp } from "@termix/plugin-sdk/frontend";
import {
  invalidateTerminalClientSettings,
  loadTerminalClientSettings,
} from "../terminal-settings";
import { DEFAULT_USER_SETTINGS } from "../../shared/terminal-settings";

/**
 * Browser-only terminal preferences from before 2.9.0, and the user setting
 * each became. Read once: the key is removed after it is saved.
 */
const LOCAL_KEYS: Array<{
  storageKey: string;
  setting: string;
  parse: (raw: string) => unknown;
}> = [
  {
    storageKey: "terminalLocalEchoMode",
    setting: "localEcho",
    parse: (raw) => (["off", "auto", "on"].includes(raw) ? raw : undefined),
  },
  {
    storageKey: "terminalLinkClickBehavior",
    setting: "linkClickBehavior",
    parse: (raw) => (["confirm", "direct"].includes(raw) ? raw : undefined),
  },
  {
    storageKey: "commandAutocomplete",
    setting: "commandAutocomplete",
    parse: (raw) =>
      raw === "true" ? true : raw === "false" ? false : undefined,
  },
];

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Moves the old localStorage values into this plugin's user settings, the
 * first time this browser runs the plugin. A value the user already changed
 * on the server wins: the browser's value only replaces a default.
 */
export async function moveLocalTerminalPreferences(
  app: Pick<TermixApp, "api">,
): Promise<void> {
  const found = LOCAL_KEYS.map((entry) => ({
    ...entry,
    raw: readStorage(entry.storageKey),
  })).filter((entry) => entry.raw !== null);
  if (found.length === 0) return;

  try {
    const { user } = await loadTerminalClientSettings(app.api);
    const current = user as unknown as Record<string, unknown>;
    const defaults = DEFAULT_USER_SETTINGS as unknown as Record<
      string,
      unknown
    >;
    const values: Record<string, unknown> = {};
    for (const entry of found) {
      const value = entry.parse(entry.raw as string);
      if (
        value !== undefined &&
        value !== current[entry.setting] &&
        current[entry.setting] === defaults[entry.setting]
      ) {
        values[entry.setting] = value;
      }
    }
    if (Object.keys(values).length > 0) {
      await app.api.put("/user-settings", values);
      invalidateTerminalClientSettings();
    }
    for (const entry of found) {
      try {
        localStorage.removeItem(entry.storageKey);
      } catch {
        // storage unavailable
      }
    }
  } catch {
    // Try again next time the plugin starts.
  }
}
