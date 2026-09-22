/**
 * Composition root for the plugin runtime.
 *
 * Owns the loader, seeds the plugins table, keeps capability grants in step
 * with each manifest, and registers the RBAC permissions a plugin contributes.
 *
 * The heavy dependencies are imported lazily inside each function rather than
 * at module scope: several pull in the repository layer, and a static import
 * here would close the cycle hosts/automation-events.ts documents.
 */

import { pluginLogger } from "../utils/logger.js";
import { unregisterPluginRouter } from "../database/routes/plugin-api-routes.js";
import { PluginLoader, type LoadedPlugin } from "./loader.js";
import { invalidatePluginPermissionCache } from "./permissions.js";

let loader: PluginLoader | null = null;

export function getPluginRuntime(): { loader: PluginLoader } {
  if (!loader) {
    loader = new PluginLoader();
  }
  return { loader };
}

/**
 * Gives every discovered plugin a row, and refreshes the stored manifest.
 *
 * Bundled plugins start enabled because they are part of the install; a
 * plugin dropped into the data directory starts disabled, so arriving on disk
 * is never the same as being allowed to run.
 *
 * `state` is only ever set on insert. Once the row exists whatever the user
 * chose wins, because re-enabling a plugin they disabled on every restart
 * would be a bug rather than a default.
 */
async function seedPlugins(loaded: LoadedPlugin[]): Promise<void> {
  const { createCurrentPluginRepository } =
    await import("../database/repositories/factory.js");
  const repository = createCurrentPluginRepository();

  for (const plugin of loaded) {
    const manifestJson = JSON.stringify(plugin.manifest);
    const existing = await repository.findById(plugin.id);

    if (existing) {
      // Unconditionally, not just on a version change: a manifest edited
      // without a version bump used to leave the stored copy stale forever,
      // and the API and the grant check both read the stored copy.
      await repository.update(plugin.id, {
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        source: plugin.source,
        manifestJson,
      });
      continue;
    }

    await repository.create({
      id: plugin.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      tier: plugin.source === "bundled" ? "bundled" : "community",
      source: plugin.source,
      state: plugin.source === "bundled" ? "enabled" : "disabled",
      manifestJson,
    });

    pluginLogger.info(`Registered ${plugin.source} plugin ${plugin.id}`, {
      operation: "plugin_seed",
    });
  }
}

/**
 * Brings plugin_permission_grants in line with the manifests on disk.
 *
 * A capability the manifest no longer declares is revoked: leaving it granted
 * would mean an upgrade silently kept a permission the new version never
 * asked for. Bundled plugins have every declared capability granted
 * automatically, since shipping in the install is the consent.
 */
async function syncCapabilityGrants(loaded: LoadedPlugin[]): Promise<void> {
  const { createCurrentPluginPermissionGrantRepository } =
    await import("../database/repositories/factory.js");
  const repository = createCurrentPluginPermissionGrantRepository();

  for (const plugin of loaded) {
    const declared = new Set(plugin.manifest.capabilities);
    const existing = await repository.listByPlugin(plugin.id);

    for (const grant of existing) {
      if (declared.has(grant.capability)) continue;
      await repository.revoke(plugin.id, grant.capability);
      pluginLogger.info(
        `Revoked ${plugin.id} capability "${grant.capability}": the manifest no longer declares it`,
        { operation: "plugin_grants" },
      );
    }

    if (plugin.source !== "bundled") continue;

    const granted = new Set(existing.map((grant) => grant.capability));
    for (const capability of declared) {
      if (granted.has(capability)) continue;
      await repository.grant({
        pluginId: plugin.id,
        capability,
        grantedBy: null,
        source: "bundled",
      });
    }

    invalidatePluginPermissionCache(plugin.id);
  }
}

/**
 * Loads every plugin on disk and activates the ones marked enabled, in
 * dependency order. Called once from the backend start-up sequence.
 */
export async function initializePlugins(): Promise<LoadedPlugin[]> {
  const { loader: pluginLoader } = getPluginRuntime();

  const loaded = await pluginLoader.loadAll();
  if (loaded.length === 0) return [];

  await seedPlugins(loaded);
  await syncCapabilityGrants(loaded);

  const { createCurrentPluginRepository } =
    await import("../database/repositories/factory.js");
  const records = await createCurrentPluginRepository().listAll();
  const enabled = new Set(
    records
      .filter((record) => record.state === "enabled")
      .map((record) => record.id),
  );

  const candidates = loaded
    .filter((plugin) => enabled.has(plugin.id))
    .map((plugin) => plugin.id);

  for (const pluginId of candidates) {
    const plugin = pluginLoader.get(pluginId);
    if (plugin) await registerPluginPermissions(plugin);
  }

  const result = await pluginLoader.activateAll(candidates);
  await persistRuntimeState(loaded);

  if (result.blocked.size > 0 || result.failed.size > 0) {
    pluginLogger.warn(
      `${result.blocked.size} plugin(s) blocked, ${result.failed.size} failed to activate`,
      { operation: "plugin_init" },
    );
  }

  return loaded;
}

/** Mirrors loader state into the database so the admin API can report it. */
async function persistRuntimeState(loaded: LoadedPlugin[]): Promise<void> {
  const { createCurrentPluginRepository } =
    await import("../database/repositories/factory.js");
  const repository = createCurrentPluginRepository();

  for (const plugin of loaded) {
    if (plugin.state !== "blocked" && plugin.state !== "failed") continue;
    try {
      await repository.update(plugin.id, {
        state: plugin.state,
        lastError: plugin.lastError,
      });
    } catch {
      // Reporting state must never stop the boot.
    }
  }
}

/**
 * Puts a plugin's declared permissions into the role catalog.
 *
 * Until this runs a plugin permission cannot be granted at all, because
 * PUT /rbac/roles/:id rejects any string isValidPermission does not know.
 * Registering here is what makes one appear in the admin role editor exactly
 * like hosts.view does.
 */
async function registerPluginPermissions(plugin: LoadedPlugin): Promise<void> {
  const group = plugin.manifest.contributes?.permissionGroup;
  if (!group) return;

  try {
    const { registerPermissionGroup } =
      await import("../utils/permission-catalog.js");
    registerPermissionGroup({
      group: group.group,
      permissions: group.permissions,
    });

    if (group.defaultForRole) {
      await applyRoleDefaults(plugin.id, group);
    }
  } catch (error) {
    pluginLogger.error(
      `Failed to register permissions for ${plugin.id}`,
      error instanceof Error ? error : new Error(String(error)),
      { operation: "plugin_permissions" },
    );
  }
}

/**
 * Applies a plugin's declared role suggestion, once.
 *
 * Only permissions the plugin declares itself are eligible; the manifest
 * validator enforces that, and this re-checks it because the stored manifest
 * is data. Without it a manifest could add admin.* to any role at boot.
 *
 * Each default is applied at most once and the fact is recorded, so an admin
 * who later revokes it does not get it handed back on the next restart. The
 * old code claimed that behaviour in a comment but re-added the permission
 * every time.
 */
async function applyRoleDefaults(
  pluginId: string,
  group: {
    group: string;
    permissions: string[];
    defaultForRole?: Record<string, string[]>;
  },
): Promise<void> {
  const { createCurrentRoleRepository, createCurrentPluginStorageRepository } =
    await import("../database/repositories/factory.js");
  const { PermissionManager } = await import("../utils/permission-manager.js");

  const roleRepository = createCurrentRoleRepository();
  const storage = createCurrentPluginStorageRepository();

  const APPLIED_KEY = "__role_defaults_applied";
  let applied: string[] = [];
  try {
    const raw = await storage.get(pluginId, APPLIED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) applied = parsed;
  } catch {
    applied = [];
  }

  const declared = new Set(group.permissions);
  const appliedSet = new Set(applied);

  for (const [roleName, wanted] of Object.entries(group.defaultForRole ?? {})) {
    try {
      const role = await roleRepository.findRoleByName(roleName);
      if (!role) continue;

      let current: unknown;
      try {
        current = role.permissions ? JSON.parse(role.permissions) : [];
      } catch {
        continue;
      }
      if (!Array.isArray(current)) continue;

      const missing = wanted.filter((permission) => {
        if (!declared.has(permission)) {
          pluginLogger.warn(
            `Ignoring ${pluginId} role default "${permission}" for ${roleName}: the plugin does not declare it`,
            { operation: "plugin_permissions" },
          );
          return false;
        }
        // Applied before means the admin has had the chance to remove it, so
        // its absence now is a decision rather than a gap.
        if (appliedSet.has(`${roleName}:${permission}`)) return false;
        return !coveredBy(current as string[], permission);
      });

      for (const permission of wanted) {
        if (declared.has(permission)) {
          appliedSet.add(`${roleName}:${permission}`);
        }
      }

      if (missing.length === 0) continue;

      await roleRepository.updateRole(role.id, {
        permissions: JSON.stringify([...(current as string[]), ...missing]),
      });

      for (const memberId of await roleRepository.listRoleUserIds(role.id)) {
        PermissionManager.getInstance().invalidateUserPermissionCache(memberId);
      }
    } catch (error) {
      pluginLogger.warn(
        `Could not apply ${pluginId} role defaults for ${roleName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { operation: "plugin_permissions" },
      );
    }
  }

  try {
    await storage.set(pluginId, APPLIED_KEY, JSON.stringify([...appliedSet]));
  } catch {
    // Losing the record only means a default may be re-offered once.
  }
}

function coveredBy(permissions: string[], permission: string): boolean {
  if (permissions.includes("*") || permissions.includes(permission)) {
    return true;
  }
  const parts = permission.split(".");
  for (let i = parts.length; i > 0; i--) {
    if (permissions.includes(`${parts.slice(0, i).join(".")}.*`)) return true;
  }
  return false;
}

export async function activatePlugin(pluginId: string): Promise<void> {
  const { loader: pluginLoader } = getPluginRuntime();

  // Before activate: a plugin's own activate() may already want to check one
  // of its permissions.
  const plugin = pluginLoader.get(pluginId);
  if (plugin) await registerPluginPermissions(plugin);

  await pluginLoader.activate(pluginId);
}

export async function deactivatePlugin(pluginId: string): Promise<void> {
  const { loader: pluginLoader } = getPluginRuntime();
  const plugin = pluginLoader.get(pluginId);

  await pluginLoader.deactivate(pluginId);
  unregisterPluginRouter(pluginId);

  const group = plugin?.manifest.contributes?.permissionGroup;
  if (group) {
    const { unregisterPermissionGroup } =
      await import("../utils/permission-catalog.js");
    unregisterPermissionGroup(group.group);
  }
}

export async function shutdownPlugins(): Promise<void> {
  if (!loader) return;
  for (const plugin of loader.list()) unregisterPluginRouter(plugin.id);
  await loader.shutdown();
}

/** Test seam. */
export function resetPluginRuntime(): void {
  loader = null;
}
