/**
 * A small main-thread service registry.
 *
 * This exists so a module can depend on a capability without depending on
 * whichever module happens to provide it. Two uses today:
 *
 *   - core registers the SSH connection pool as "ssh.transport" at boot, so
 *     everything that needs a pooled connection resolves a provider rather
 *     than importing the pool directly.
 *   - the session-sharing plugin publishes "sessions.sharing.guests", guest
 *     link resolution for the terminal, keyed by a token rather than a user.
 *
 * Deliberately NOT reachable from a worker plugin's ctx. Values here are live
 * objects -- pools, session managers, sockets -- and handing one across the
 * postMessage boundary is exactly what that boundary exists to prevent. Only
 * in-process first-party plugins get a reference to this.
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
