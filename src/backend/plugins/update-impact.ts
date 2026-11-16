/**
 * Which installed plugins would stay off after Termix moves to another
 * version, so admins hear about it before they update.
 */
import {
  isLegacyPluginApi,
  isTermixCompatible,
  type PluginManifest,
} from "@termix-ssh/plugin-sdk/manifest";

export interface BlockedPlugin {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  /** api: made for plugin API 1. termix: its engine.termix leaves the version out. */
  reason: "api" | "termix";
  /** The Termix range it asks for, for reason termix. */
  needs: string | null;
}

export interface InstalledPluginInfo {
  id: string;
  enabled: boolean;
  manifest: Pick<PluginManifest, "name" | "version" | "engine">;
}

export function pluginsBlockedOn(
  version: string,
  plugins: InstalledPluginInfo[],
): BlockedPlugin[] {
  const out: BlockedPlugin[] = [];
  for (const plugin of plugins) {
    const { manifest } = plugin;
    const base = {
      id: plugin.id,
      name: manifest.name || plugin.id,
      version: manifest.version,
      enabled: plugin.enabled,
    };
    if (isLegacyPluginApi(String(manifest.engine?.api ?? ""))) {
      out.push({ ...base, reason: "api", needs: null });
    } else if (
      !isTermixCompatible(String(manifest.engine?.termix ?? ""), version)
    ) {
      out.push({ ...base, reason: "termix", needs: manifest.engine.termix });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
