/**
 * How a plugin names a core role permission.
 *
 * A plugin writes its own permissions short ("services.use") and core registers
 * them as `<pluginId>.<name>`. A cross-plugin check still has to be
 * expressible, so a string that already names another plugin or a core group is
 * taken as given. Everything ctx.rbac exposes, and the per-route gate in
 * http.ts, resolves through here so the four paths cannot disagree.
 */

import {
  PERMISSION_CATALOG,
  getPermissionCatalog,
} from "../utils/permission-catalog.js";
import type { PluginManifest } from "./manifest.js";

function coreGroups(): Set<string> {
  return new Set(PERMISSION_CATALOG.map((entry) => entry.group));
}

/** The ids this plugin declares, in their registered `<pluginId>.<name>` form. */
export function declaredPermissions(manifest: PluginManifest): Set<string> {
  return new Set(
    (manifest.contributes?.permissions ?? []).map(
      (permission) => `${manifest.id}.${permission.name}`,
    ),
  );
}

/**
 * Turns whatever a plugin passed into the id core stores.
 *
 * A bare name takes this plugin's prefix. A string whose first segment is a
 * core group, or this plugin's own id, is already a full id.
 */
export function resolvePermission(
  manifest: PluginManifest,
  permission: string,
): string {
  const head = permission.split(".")[0];
  if (!head) return permission;

  if (head === manifest.id) return permission;
  // A name this plugin declares is its own, even if another plugin's id
  // happens to match its first segment.
  if (
    (manifest.contributes?.permissions ?? []).some(
      (declared) => declared.name === permission,
    )
  ) {
    return `${manifest.id}.${permission}`;
  }
  if (coreGroups().has(head)) return permission;

  // Another plugin's registered group, which is the cross-plugin check.
  const otherPlugin = getPermissionCatalog().some(
    (entry) => entry.pluginId !== undefined && entry.group === head,
  );
  if (otherPlugin) return permission;

  // Nothing claims that first segment, so it is a short name of our own.
  return `${manifest.id}.${permission}`;
}
