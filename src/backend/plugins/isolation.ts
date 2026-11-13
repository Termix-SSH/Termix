/**
 * Which plugins run in their own process and which may not run at all. Kept
 * apart from the loader so routes can read it without importing the runtime.
 */
import { isLegacyPluginApi } from "@termix-ssh/plugin-sdk/manifest";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";

/** Official: shipped in the image, or signed with the official key. */
export function isOfficialPlugin(plugin: {
  source: string;
  signedTier?: string;
}): boolean {
  return plugin.source === "bundled" || plugin.signedTier === "official";
}

/** Whether a plugin was built for API 1 and so can't run in its own process. */
export function needsUnisolated(plugin: {
  manifest: Pick<PluginManifest, "engine">;
}): boolean {
  return isLegacyPluginApi(String(plugin.manifest.engine.api));
}

export const LEGACY_COMMUNITY_ERROR =
  "This plugin was made for an older Termix and can't run in its own process. Ask its author for an update.";
export const LEGACY_SWITCH_ERROR =
  "This plugin was made for an older Termix and can't run in its own process. An admin can turn on Run without isolation for it.";
