/**
 * The onboarding plugin picker: what a fresh install's first admin sees and
 * how their choices are applied in one go.
 */

import { pluginLogger } from "../utils/logger.js";
import { getPluginRuntime } from "./index.js";
import { onboardingDefaults } from "./bundled-index.js";
import {
  isLinkedDesktop,
  serialized,
  setPluginStateUnlocked,
  uninstallPluginUnlocked,
} from "./manage.js";
import {
  applyOrder,
  resolvePluginChoices,
  type ChoiceAdjustment,
  type ChoicePlugin,
  type PluginChoice,
} from "../../types/plugin-onboarding.js";

/**
 * Set until an admin confirms the picker: "fresh" on a new install, "upgrade"
 * on one that existed before the picker (2.9 and earlier).
 */
export const PLUGIN_SETUP_PENDING_KEY = "onboarding_plugin_setup_pending";
/** Set once the picker has been offered, so it is offered only once. */
export const PLUGIN_SETUP_OFFERED_KEY = "onboarding_plugin_setup_offered";

export type PluginSetupReason = "fresh" | "upgrade";

export interface OnboardingPluginInfo {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  category: string;
  version: string;
  source: "bundled" | "user";
  state: string;
  dependencies: string[];
  recommended: boolean;
  consent: boolean;
}

export interface OnboardingPluginList {
  pending: boolean;
  /** Why the picker is pending. On an upgrade it starts from what is on. */
  reason: PluginSetupReason | null;
  managedByLinkedServer: boolean;
  plugins: OnboardingPluginInfo[];
}

export interface OnboardingApplyResult {
  resolved: Record<string, PluginChoice>;
  adjustments: ChoiceAdjustment[];
  enabled: string[];
  disabled: string[];
  removed: string[];
  failed: { id: string; error: string; code?: string }[];
}

async function repos() {
  return import("../database/repositories/factory.js");
}

export async function pluginSetupReason(): Promise<PluginSetupReason | null> {
  const { createCurrentSettingsRepository } = await repos();
  const value = await createCurrentSettingsRepository().get(
    PLUGIN_SETUP_PENDING_KEY,
  );
  if (value === "fresh" || value === "1") return "fresh";
  if (value === "upgrade") return "upgrade";
  return null;
}

export async function isPluginSetupPending(): Promise<boolean> {
  return (await pluginSetupReason()) !== null;
}

async function clearPluginSetupPending(): Promise<void> {
  const { createCurrentSettingsRepository } = await repos();
  const settings = createCurrentSettingsRepository();
  await settings.delete(PLUGIN_SETUP_PENDING_KEY);
  await settings.set(PLUGIN_SETUP_OFFERED_KEY, "1");
}

/**
 * Called once at boot. Every install is offered the picker once: a fresh
 * one on its first admin's first run, an upgraded one (which never saw it)
 * the next time an admin signs in.
 */
export async function offerPluginSetup(fresh: boolean): Promise<void> {
  const { createCurrentSettingsRepository } = await repos();
  const settings = createCurrentSettingsRepository();
  if (await settings.get(PLUGIN_SETUP_OFFERED_KEY)) return;
  await settings.set(PLUGIN_SETUP_PENDING_KEY, fresh ? "fresh" : "upgrade");
  await settings.set(PLUGIN_SETUP_OFFERED_KEY, "1");
}

function choicePlugins(): ChoicePlugin[] {
  return getPluginRuntime()
    .loader.list()
    .map((plugin) => ({
      id: plugin.id,
      dependencies: Object.keys(plugin.manifest.dependencies ?? {}),
    }));
}

export async function describeOnboardingPlugins(): Promise<OnboardingPluginList> {
  const { createCurrentPluginRepository } = await repos();
  const states = new Map(
    (await createCurrentPluginRepository().listAll()).map((record) => [
      record.id,
      record.state,
    ]),
  );
  const plugins = getPluginRuntime()
    .loader.list()
    .map((plugin): OnboardingPluginInfo => {
      const defaults =
        plugin.source === "bundled"
          ? onboardingDefaults(plugin.id)
          : { recommended: false, consent: false };
      return {
        id: plugin.id,
        name: plugin.manifest.name,
        description: plugin.manifest.description,
        icon: plugin.manifest.icon ?? null,
        category: plugin.manifest.category,
        version: plugin.manifest.version,
        source: plugin.source,
        state: states.get(plugin.id) ?? "disabled",
        dependencies: Object.keys(plugin.manifest.dependencies ?? {}),
        ...defaults,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const reason = await pluginSetupReason();
  return {
    pending: reason !== null,
    reason,
    managedByLinkedServer: await isLinkedDesktop(),
    plugins,
  };
}

/**
 * Applies the picker in one serialized pass: enable (dependencies first),
 * then disable and remove (dependents first). One plugin failing does not
 * stop the rest. Ids that are not installed are ignored.
 */
export function applyOnboardingChoices(
  choices: Record<string, PluginChoice>,
  options: { dryRun?: boolean } = {},
): Promise<OnboardingApplyResult> {
  return serialized(async () => {
    const plugins = choicePlugins();
    const installed = new Set(plugins.map((plugin) => plugin.id));
    const wanted: Record<string, PluginChoice> = {};
    for (const [id, choice] of Object.entries(choices)) {
      if (installed.has(id)) wanted[id] = choice;
    }
    const { choices: resolved, adjustments } = resolvePluginChoices(
      plugins,
      wanted,
    );

    const result: OnboardingApplyResult = {
      resolved,
      adjustments,
      enabled: [],
      disabled: [],
      removed: [],
      failed: [],
    };

    const { createCurrentPluginRepository } = await repos();
    const states = new Map(
      (await createCurrentPluginRepository().listAll()).map((record) => [
        record.id,
        record.state,
      ]),
    );
    const order = applyOrder(plugins, resolved);
    const enable = order.enable.filter((id) => states.get(id) !== "enabled");
    const disable = order.disable.filter((id) => states.get(id) === "enabled");

    if (options.dryRun) {
      return {
        ...result,
        enabled: enable,
        disabled: disable,
        removed: order.remove,
      };
    }

    const attempt = async (
      id: string,
      run: () => Promise<unknown>,
      done: string[],
    ) => {
      try {
        const outcome = (await run()) as { state?: string } | undefined;
        if (outcome?.state === "failed" || outcome?.state === "blocked") {
          result.failed.push({ id, error: outcome.state });
          return;
        }
        done.push(id);
      } catch (error) {
        result.failed.push({
          id,
          error: error instanceof Error ? error.message : String(error),
          code: (error as { code?: string })?.code,
        });
      }
    };

    for (const id of enable) {
      await attempt(id, () => setPluginStateUnlocked(id, true), result.enabled);
    }
    for (const id of disable) {
      await attempt(
        id,
        () => setPluginStateUnlocked(id, false),
        result.disabled,
      );
    }
    for (const id of order.remove) {
      await attempt(id, () => uninstallPluginUnlocked(id), result.removed);
    }

    await clearPluginSetupPending();
    pluginLogger.info(
      `Onboarding plugin choices applied: ${result.enabled.length} enabled, ${result.disabled.length} disabled, ${result.removed.length} removed, ${result.failed.length} failed`,
      { operation: "plugin_onboarding" },
    );
    return result;
  });
}
