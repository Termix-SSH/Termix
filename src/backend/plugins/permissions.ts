/**
 * The grant check every privileged ctx call goes through.
 *
 * Capability strings are the manifest's own permission enum, stored verbatim in
 * plugin_permission_grants.capability -- no translation layer, so the manifest
 * stays the single source of truth for what is grantable.
 *
 * Two separate things have to be true for a capability to count as granted:
 * the manifest must declare it (the plugin asked for it up front) and an admin
 * must have granted it (someone said yes). A grant for something the manifest
 * never declared is ignored rather than honoured, so widening a plugin's reach
 * always requires a new manifest the user can see.
 */

import { createCurrentPluginPermissionGrantRepository } from "../database/repositories/factory.js";
import type { PluginPermission } from "./manifest.js";

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  capabilities: Set<string>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export class PluginPermissionError extends Error {
  readonly code = "EPLUGINPERM";

  constructor(pluginId: string, capability: string) {
    super(
      `Plugin "${pluginId}" is not granted the "${capability}" capability. ` +
        `Declare it in the manifest's permissions array and grant it in the plugin's settings.`,
    );
    this.name = "PluginPermissionError";
  }
}

export function invalidatePluginPermissionCache(pluginId?: string): void {
  if (pluginId) cache.delete(pluginId);
  else cache.clear();
}

async function loadGrants(pluginId: string): Promise<Set<string>> {
  const cached = cache.get(pluginId);
  if (cached && cached.expiresAt > Date.now()) return cached.capabilities;

  const rows =
    await createCurrentPluginPermissionGrantRepository().listByPlugin(pluginId);
  const capabilities = new Set(rows.map((row) => row.capability));

  cache.set(pluginId, { capabilities, expiresAt: Date.now() + CACHE_TTL_MS });
  return capabilities;
}

export async function hasCapability(
  pluginId: string,
  capability: PluginPermission | string,
  declared: readonly string[],
): Promise<boolean> {
  if (!declared.includes(capability)) return false;
  return (await loadGrants(pluginId)).has(capability);
}

export async function assertCapability(
  pluginId: string,
  capability: PluginPermission | string,
  declared: readonly string[],
): Promise<void> {
  if (!(await hasCapability(pluginId, capability, declared))) {
    throw new PluginPermissionError(pluginId, capability);
  }
}
