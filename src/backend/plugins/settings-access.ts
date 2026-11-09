import type {
  PluginManifest,
  PluginSettingsField,
} from "@termix-ssh/plugin-sdk/manifest";
import { PermissionManager } from "../utils/permission-manager.js";
import { resolvePermission } from "./rbac.js";
import type { PluginSettingsScope } from "./settings.js";

/**
 * Whether a user may write one settings field. Every path that writes plugin
 * settings for a user (the settings routes, host imports, bulk host edits,
 * host defaults, sync) goes through this, so a field's permission can't be
 * skipped by taking another route.
 *
 * Admin scope always needs admin.plugins.manage. A field permission narrows
 * who may write it and never widens the scope's own gate.
 */
export async function canWriteSettingField(
  userId: string,
  manifest: PluginManifest,
  scope: PluginSettingsScope,
  field: PluginSettingsField,
): Promise<boolean> {
  const permissions = PermissionManager.getInstance();
  if (
    scope === "admin" &&
    !(await permissions.hasPermission(userId, "admin.plugins.manage"))
  ) {
    return false;
  }
  if (field.permission) {
    return permissions.hasPermission(
      userId,
      resolvePermission(manifest, field.permission),
    );
  }
  return true;
}
