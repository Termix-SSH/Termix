/**
 * The onboarding defaults and the default look of the bundled plugins, from
 * dist/plugins/bundled-index.json (written by scripts/build-plugins.cjs from
 * docker/bundled-plugins.json). Core never names plugins, so which ones a
 * fresh install keeps lives in that file and not here.
 */

import fs from "node:fs";
import path from "node:path";
import { getBundledPluginsDir } from "./paths.js";

export const BUNDLED_INDEX_FILE = "bundled-index.json";

export interface OnboardingDefaults {
  recommended: boolean;
  consent: boolean;
}

type Recommended = boolean | "desktop";

interface BundledIndex {
  plugins: Record<
    string,
    {
      onboarding?: {
        recommended?: Recommended;
        consent?: boolean;
        enabledByEnv?: string[];
      };
      defaultLook?: boolean;
    }
  >;
}

let cached: BundledIndex | null | undefined;

export function readBundledIndex(): BundledIndex | null {
  if (cached !== undefined) return cached;
  try {
    const raw = JSON.parse(
      fs.readFileSync(
        path.join(getBundledPluginsDir(), BUNDLED_INDEX_FILE),
        "utf8",
      ),
    );
    cached =
      raw && typeof raw.plugins === "object" && raw.plugins
        ? { plugins: raw.plugins }
        : null;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Bundled plugins whose layout and theme a fresh install shows. Core reads
 * the default look from here so it never has to name a plugin.
 */
export function defaultLookPluginIds(): string[] {
  const index = readBundledIndex();
  if (!index) return [];
  return Object.entries(index.plugins)
    .filter(([, entry]) => entry?.defaultLook === true)
    .map(([id]) => id)
    .sort();
}

export function isDefaultLookPlugin(pluginId: string): boolean {
  return defaultLookPluginIds().includes(pluginId);
}

export function resetBundledIndexCache(): void {
  cached = undefined;
}

function isDesktop(): boolean {
  return process.env.ELECTRON_EMBEDDED === "true";
}

/**
 * Without an index (a build that skipped build-plugins) every plugin counts
 * as recommended, which is how installs behaved before the picker. A plugin
 * whose enabledByEnv variables are set counts as recommended too, so a server
 * set up for it through the environment works from the first boot.
 */
export function onboardingDefaults(pluginId: string): OnboardingDefaults {
  const index = readBundledIndex();
  if (!index) return { recommended: true, consent: false };
  const entry = index.plugins[pluginId]?.onboarding;
  const recommended = entry?.recommended;
  const configured = (entry?.enabledByEnv ?? []).some(
    (name) => typeof name === "string" && !!process.env[name]?.trim(),
  );
  return {
    recommended:
      recommended === true ||
      (recommended === "desktop" && isDesktop()) ||
      configured,
    consent: entry?.consent === true,
  };
}

/**
 * The state a newly seen plugin's row starts in. Bundled plugins start
 * enabled, except on a fresh install, where only recommended ones do and
 * consent plugins wait for the admin. A plugin dropped into the data
 * directory always starts disabled.
 */
export function initialPluginState(
  pluginId: string,
  source: "bundled" | "user",
  freshInstall: boolean,
): "enabled" | "disabled" {
  if (source !== "bundled") return "disabled";
  if (!freshInstall) return "enabled";
  // The default look is what the app is drawn with.
  if (isDefaultLookPlugin(pluginId)) return "enabled";
  const { recommended, consent } = onboardingDefaults(pluginId);
  return recommended && !consent ? "enabled" : "disabled";
}
