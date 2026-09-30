/**
 * A small in-process key/value registry for live objects plugins hand each
 * other (a guest-link resolver, a host import normalizer). Services with
 * versions and permissions go through service-registry.ts instead.
 *
 * ctx.registry only lets a plugin provide or revoke keys under its own id
 * ("<pluginId>.something"); anyone may consume. Core also reads a few
 * well-known per-plugin keys, such as "<pluginId>.hostImportNormalizer".
 *
 * `consume` returns undefined rather than throwing when nothing is registered.
 * A provider can disappear when its plugin is disabled, and callers are
 * expected to handle that rather than assume it is always there.
 */

import { pluginLogger } from "../utils/logger.js";

const providers = new Map<string, unknown>();

export function provide<T>(key: string, value: T): void {
  if (providers.has(key)) {
    pluginLogger.warn(
      `Service "${key}" is already registered and is being replaced`,
      { operation: "plugin_registry" },
    );
  }
  providers.set(key, value);
}

export function consume<T>(key: string): T | undefined {
  return providers.get(key) as T | undefined;
}

/**
 * Removes a provider, but only if `value` is the one currently registered.
 * A plugin that crashed and restarted must not revoke the replacement its own
 * restart installed, so revocation is identity-checked rather than by key.
 */
export function revoke(key: string, value?: unknown): boolean {
  if (!providers.has(key)) return false;
  if (value !== undefined && providers.get(key) !== value) return false;
  return providers.delete(key);
}

export function has(key: string): boolean {
  return providers.has(key);
}

/** Test seam. */
export function clearRegistry(): void {
  providers.clear();
}
