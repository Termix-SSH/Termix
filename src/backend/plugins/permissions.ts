/**
 * The grant check every guarded ctx call goes through.
 *
 * Two things have to be true for a capability to count as granted: the
 * manifest declares it (the plugin asked for it up front) and it is granted in
 * plugin_permission_grants (someone, or the bundling process, said yes). A
 * grant for something the manifest never declared is ignored rather than
 * honoured, so widening a plugin's reach always requires a new manifest the
 * user can see.
 *
 * The cache is invalidated explicitly on every grant change rather than by
 * TTL: a revoke that takes effect a minute later is not a revoke.
 */

import { createCurrentPluginPermissionGrantRepository } from "../database/repositories/factory.js";
import { PluginCapabilityError } from "@termix/plugin-sdk/backend";

export { PluginCapabilityError };

const cache = new Map<string, Set<string>>();

export function invalidatePluginPermissionCache(pluginId?: string): void {
  if (pluginId) cache.delete(pluginId);
  else cache.clear();
}

async function loadGrants(pluginId: string): Promise<Set<string>> {
  const cached = cache.get(pluginId);
  if (cached) return cached;

  const rows =
    await createCurrentPluginPermissionGrantRepository().listByPlugin(pluginId);
  const capabilities = new Set(rows.map((row) => row.capability));

  cache.set(pluginId, capabilities);
  return capabilities;
}

export async function hasCapability(
  pluginId: string,
  capability: string,
  declared: readonly string[],
): Promise<boolean> {
  if (!declared.includes(capability)) return false;
  return (await loadGrants(pluginId)).has(capability);
}

export async function assertCapability(
  pluginId: string,
  capability: string,
  declared: readonly string[],
): Promise<void> {
  if (!(await hasCapability(pluginId, capability, declared))) {
    throw new PluginCapabilityError(pluginId, capability);
  }
}
