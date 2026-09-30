/**
 * Personal fields: look-and-feel values (a terminal's font, a remote
 * desktop's color depth) that a user a host is shared with sees through
 * their own defaults while the host follows its defaults. The stored value is
 * the owner's; this swaps it for the viewer's at read time.
 */

import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { createCurrentHostDefaultsRepository } from "../../database/repositories/factory.js";
import type { HostRow } from "../../database/repositories/host-defaults-repository.js";
import {
  hostSettingsPlugins,
  type HostPluginSettings,
} from "../../database/routes/host-plugin-settings.js";
import { parseDefaultOverrides } from "../../../types/host-defaults.js";
import { pluginCatalogEntries, type DefaultKeyInfo } from "./catalog.js";
import { loadDefaultsIndex } from "./levels.js";
import { resolveKey, type HostLevels } from "./resolve.js";

function personalEntries(manifests: PluginManifest[]): DefaultKeyInfo[] {
  return manifests.flatMap((manifest) =>
    pluginCatalogEntries(manifest).filter((entry) => entry.personal),
  );
}

async function viewerLevels(viewerId: string): Promise<HostLevels> {
  const index = await loadDefaultsIndex([viewerId]);
  return {
    admin: index.admin,
    user: index.users.get(viewerId) ?? new Map(),
    folders: [],
  };
}

function follows(row: HostRow, entry: DefaultKeyInfo): boolean {
  const overrides = parseDefaultOverrides(row.defaultOverrides);
  const own = overrides?.[entry.namespace];
  return !!own && !own.includes(entry.key);
}

/** Replaces personal values in a host list's plugin settings, in place. */
export async function applyPersonalHostValues(
  settings: Map<number, HostPluginSettings>,
  viewerId: string,
): Promise<void> {
  const entries = personalEntries(hostSettingsPlugins());
  if (entries.length === 0 || settings.size === 0) return;
  const rows = (
    await createCurrentHostDefaultsRepository().listHosts({
      hostIds: [...settings.keys()],
    })
  ).filter((row) => row.userId !== viewerId);
  if (rows.length === 0) return;

  const levels = await viewerLevels(viewerId);
  for (const row of rows) {
    const values = settings.get(row.id);
    if (!values) continue;
    for (const entry of entries) {
      if (!follows(row, entry) || !values[entry.namespace]) continue;
      const resolved = resolveKey(entry, levels);
      if (resolved) values[entry.namespace][entry.key] = resolved.value;
    }
  }
}

/** One personal value as a user sees it, when that differs from the stored one. */
export async function personalHostValue(
  manifest: PluginManifest,
  hostId: number,
  viewerId: string,
  key: string,
): Promise<{ applies: boolean; value?: unknown }> {
  const entry = pluginCatalogEntries(manifest).find(
    (candidate) => candidate.key === key && candidate.personal,
  );
  if (!entry || !Number.isInteger(hostId)) return { applies: false };
  const [row] = await createCurrentHostDefaultsRepository().listHosts({
    hostIds: [hostId],
  });
  if (!row || row.userId === viewerId || !follows(row, entry)) {
    return { applies: false };
  }
  const resolved = resolveKey(entry, await viewerLevels(viewerId));
  return resolved
    ? { applies: true, value: resolved.value }
    : { applies: false };
}

/** A host field as a user's hosts get it with nothing more specific set. */
export async function userHostDefault(
  manifest: PluginManifest,
  userId: string,
  key: string,
): Promise<unknown> {
  const entry = pluginCatalogEntries(manifest).find(
    (candidate) => candidate.key === key,
  );
  if (!entry) return undefined;
  return resolveKey(entry, await viewerLevels(userId))?.value;
}
