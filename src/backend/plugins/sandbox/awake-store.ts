/**
 * Which plugins said they have work that needs them running
 * (ctx.schedule.keepAwake), kept across restarts so such a plugin starts
 * at boot again instead of waiting for its first request.
 */

import fs from "node:fs";
import path from "node:path";

export interface AwakeState {
  /** The plugin manages this itself, so its short jobs don't keep it on. */
  managed: boolean;
  awake: boolean;
}

function storePath(): string {
  return path.join(process.env.DATA_DIR || "./db/data", ".plugin-awake.json");
}

function readAll(): Record<string, AwakeState> {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8")) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, AwakeState>)
      : {};
  } catch {
    return {};
  }
}

export function readAwakeState(pluginId: string): AwakeState | null {
  const entry = readAll()[pluginId];
  if (!entry || typeof entry !== "object") return null;
  return { managed: entry.managed === true, awake: entry.awake === true };
}

export function writeAwakeState(pluginId: string, state: AwakeState): void {
  const all = readAll();
  const before = all[pluginId];
  if (before?.managed === state.managed && before?.awake === state.awake) {
    return;
  }
  all[pluginId] = state;
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(all), { mode: 0o600 });
  } catch {
    // Read only data folder: the plugin just starts on its first request.
  }
}
