/**
 * IPC between the backend and scripts/dev.mjs, which forks it with
 * TERMIX_DEV_RELOAD=true. The runner asks for a plugin to be loaded again
 * after it rebuilt and copied it into the bundled folder.
 */

import { pluginLogger } from "../utils/logger.js";

interface ReloadRequest {
  type: "plugin-reload";
  id: string;
}

type Send = (message: unknown) => void;
type Reload = (id: string) => Promise<{ version: string; state: string }>;

function isReloadRequest(msg: unknown): msg is ReloadRequest {
  return (
    !!msg &&
    typeof msg === "object" &&
    (msg as { type?: unknown }).type === "plugin-reload" &&
    typeof (msg as { id?: unknown }).id === "string"
  );
}

export function isDevReloadEnabled(): boolean {
  return (
    process.env.TERMIX_DEV_RELOAD === "true" &&
    typeof process.send === "function"
  );
}

export async function handleDevMessage(
  msg: unknown,
  send: Send,
  reload: Reload,
): Promise<void> {
  if (!isReloadRequest(msg)) return;
  try {
    const result = await reload(msg.id);
    pluginLogger.info(`Reloaded ${msg.id}@${result.version}`, {
      operation: "plugin_dev_reload",
    });
    send({ type: "plugin-reloaded", id: msg.id, state: result.state });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pluginLogger.error(`Could not reload ${msg.id}`, error, {
      operation: "plugin_dev_reload",
    });
    send({ type: "plugin-reload-failed", id: msg.id, error: message });
  }
}

export function listenForDevReloads(): void {
  if (!isDevReloadEnabled()) return;
  process.on("message", (msg: unknown) => {
    void handleDevMessage(
      msg,
      (reply) => process.send?.(reply),
      async (id) => {
        const { reloadBundledPlugin } = await import("./manage.js");
        return reloadBundledPlugin(id);
      },
    );
  });
}
