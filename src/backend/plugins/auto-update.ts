/**
 * Applies plugin updates on a timer for plugins with auto-update on. An
 * update that asks for a new capability is never applied here; admins get
 * an alert and review it in the Plugins tab.
 */

import { pluginLogger } from "../utils/logger.js";

const FIRST_CHECK_MS = 2 * 60_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;

let timer: NodeJS.Timeout | null = null;

export async function runPluginAutoUpdate(): Promise<void> {
  const { isLinkedDesktop, updateAllPlugins } = await import("./manage.js");
  if (await isLinkedDesktop()) return;

  const result = await updateAllPlugins({ userId: null, onlyAutoUpdate: true });

  for (const done of result.updated) {
    pluginLogger.info(`Auto-updated plugin ${done.id} to ${done.version}`, {
      operation: "plugin_auto_update",
    });
  }
  for (const failed of result.failed) {
    pluginLogger.warn(`Auto-update of ${failed.id} failed: ${failed.error}`, {
      operation: "plugin_auto_update",
    });
  }
  if (result.needsReview.length === 0) return;

  const { sendCoreAlert } = await import("../notify/core-notify.js");
  for (const entry of result.needsReview) {
    await sendCoreAlert({
      title: `A plugin update needs review`,
      body: `The new version of ${entry.id} asks for more access, so it was not installed on its own. Review it in Plugins.`,
      severity: "info",
      category: "termix.plugin-update",
      dedupeKey: `plugin-review:${entry.id}:${entry.capabilities.join(",")}`,
      audience: "admins",
    });
  }
}

export function startPluginAutoUpdate(): void {
  if (timer) return;
  const run = () =>
    void runPluginAutoUpdate().catch((error) => {
      pluginLogger.warn(
        `Plugin auto-update check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { operation: "plugin_auto_update" },
      );
    });
  setTimeout(run, FIRST_CHECK_MS).unref?.();
  timer = setInterval(run, CHECK_EVERY_MS);
  timer.unref?.();
}

export function stopPluginAutoUpdate(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
