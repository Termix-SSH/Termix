/**
 * Moving to plugin API 2. Every plugin now runs in its own process, but most
 * official plugins are still API 1 until they are ported. So that an upgrade
 * does not turn them off, the first boot of this version turns on "Run without
 * isolation" for each official API 1 plugin that was on, and the plugins page
 * shows a warning listing them. Plugins that arrive enabled later (a fresh
 * install's picks, a newly shipped plugin) get the same.
 *
 * Community API 1 plugins never get the switch.
 */
import type { LoadedPlugin } from "../plugins/loader.js";
import { isOfficialPlugin, needsUnisolated } from "../plugins/isolation.js";
import { pluginLogger } from "../utils/logger.js";

export const UNISOLATED_SEEDED_KEY = "plugins_unisolated_seeded";

export async function seedUnisolatedSwitches(
  loaded: LoadedPlugin[],
  newThisBoot: ReadonlySet<string>,
): Promise<string[]> {
  const { createCurrentPluginRepository, createCurrentSettingsRepository } =
    await import("../database/repositories/factory.js");
  const repository = createCurrentPluginRepository();
  const settings = createCurrentSettingsRepository();
  const firstPass = (await settings.get(UNISOLATED_SEEDED_KEY)) !== "1";
  const records = new Map(
    (await repository.listAll()).map((record) => [record.id, record]),
  );

  const turnedOn: string[] = [];
  for (const plugin of loaded) {
    const record = records.get(plugin.id);
    if (!record) continue;
    plugin.runUnisolated = record.runUnisolated;
    if (record.runUnisolated) continue;
    if (!needsUnisolated(plugin) || !isOfficialPlugin(plugin)) continue;
    if (!["enabled", "failed", "blocked"].includes(record.state)) continue;
    if (!firstPass && !newThisBoot.has(plugin.id)) continue;
    await repository.update(plugin.id, { runUnisolated: true });
    plugin.runUnisolated = true;
    turnedOn.push(plugin.id);
  }
  if (firstPass) await settings.set(UNISOLATED_SEEDED_KEY, "1");
  if (turnedOn.length > 0) {
    pluginLogger.warn(
      `These plugins still run inside the server process until they are updated: ${turnedOn.join(", ")}`,
      { operation: "plugin_unisolated" },
    );
  }
  return turnedOn;
}
