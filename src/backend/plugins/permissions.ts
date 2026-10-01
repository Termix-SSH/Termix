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
 *
 * Every refusal is audited here, so a guard added anywhere in the runtime
 * leaves a trail without each call site remembering to write one.
 */

import { createCurrentPluginPermissionGrantRepository } from "../database/repositories/factory.js";
import { PluginCapabilityError } from "@termix/plugin-sdk/backend";
import { getActor } from "./actor.js";

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

/**
 * For hooks ssh2 calls synchronously. Answers from the cache only and fails
 * closed when the grants are not loaded yet, starting the load for next time.
 */
export function hasCachedCapability(
  pluginId: string,
  capability: string,
  declared: readonly string[],
): boolean {
  if (!declared.includes(capability)) return false;
  const cached = cache.get(pluginId);
  if (!cached) {
    void loadGrants(pluginId).catch(() => {});
    return false;
  }
  return cached.has(capability);
}

/** Loads a plugin's grants ahead of a synchronous hasCachedCapability. */
export function warmPluginGrants(pluginId: string): void {
  void loadGrants(pluginId).catch(() => {});
}

/**
 * Throws PluginCapabilityError unless granted, after writing the refusal's
 * audit line. `action` names the call ("kv_set"), so the line says what was
 * refused and not only which capability was missing.
 */
export async function assertCapability(
  pluginId: string,
  capability: string,
  declared: readonly string[],
  action = "capability_refused",
): Promise<void> {
  if (await hasCapability(pluginId, capability, declared)) return;
  const error = new PluginCapabilityError(pluginId, capability);
  await auditRefusal(pluginId, capability, action, error);
  throw error;
}

/**
 * The error for a capability a sync call never declared, with its audit
 * line written in the background.
 */
export function capabilityRefused(
  pluginId: string,
  capability: string,
  action = "capability_refused",
): PluginCapabilityError {
  const error = new PluginCapabilityError(pluginId, capability);
  void auditRefusal(pluginId, capability, action, error);
  return error;
}

async function auditRefusal(
  pluginId: string,
  capability: string,
  action: string,
  error: Error,
): Promise<void> {
  try {
    const { logAudit } = await import("../utils/audit-logger.js");
    await logAudit({
      // Attribution comes from the runtime, never from the plugin.
      userId: getActor() ?? "system",
      username: `plugin:${pluginId}`,
      action: `plugin_${action}`,
      resourceType: "plugin",
      resourceId: pluginId,
      resourceName: pluginId,
      details: `refused: ${capability}`,
      success: false,
      errorMessage: error.message,
    });
  } catch {
    // Auditing must never change what the caller sees.
  }
}
