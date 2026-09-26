/**
 * Composition root for the plugin runtime.
 *
 * Owns the loader, seeds the plugins table, keeps capability grants in step
 * with each manifest, and registers the RBAC permissions a plugin contributes.
 *
 * The heavy dependencies are imported lazily inside each function rather than
 * at module scope: several pull in the repository layer, and a static import
 * here would close an import cycle through the repositories.
 */

import { pluginLogger } from "../utils/logger.js";
import {
  setPluginEnabledCheck,
  setPluginInstalledCheck,
  unregisterPluginHttp,
} from "./http.js";
import { PluginLoader, type LoadedPlugin } from "./loader.js";
import type { PluginPermissionContribution } from "./manifest.js";
import { invalidatePluginPermissionCache } from "./permissions.js";
import { setSshAuthTypeOwnerSource } from "../hosts/connect/auth-provider-registry.js";
import { setSecretResolverOwnerSource } from "../hosts/connect/secret-resolver-registry.js";
import { recordConflict } from "./conflicts.js";

let loader: PluginLoader | null = null;

export function getPluginRuntime(): { loader: PluginLoader } {
  if (!loader) {
    loader = new PluginLoader();
    // The 503-while-disabled answer comes from here rather than from the
    // router being torn down, so a request that arrives mid-disable gets a
    // truthful status instead of a 404.
    setPluginEnabledCheck(
      (pluginId) => loader?.get(pluginId)?.state === "active",
    );
    setPluginInstalledCheck((pluginId) => !!loader?.get(pluginId));
    // Lets a host whose auth type belongs to a disabled plugin name it.
    setSshAuthTypeOwnerSource(() =>
      (loader?.list() ?? []).flatMap((plugin) =>
        (plugin.manifest.contributes?.auth?.sshAuthTypes ?? []).map((type) => ({
          type,
          pluginId: plugin.id,
          pluginName: plugin.manifest.name,
        })),
      ),
    );
    // Lets a secret reference whose scheme belongs to a disabled plugin name it.
    setSecretResolverOwnerSource(() =>
      (loader?.list() ?? []).flatMap((plugin) =>
        (plugin.manifest.contributes?.auth?.secretSchemes ?? []).map(
          (scheme) => ({
            scheme,
            pluginId: plugin.id,
            pluginName: plugin.manifest.name,
          }),
        ),
      ),
    );
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
 * Each name is registered as `<pluginId>.<name>`, so a plugin cannot claim a
 * core group or another plugin's namespace. Until this runs a plugin permission
 * cannot be granted at all, because PUT /rbac/roles/:id rejects any string
 * isValidPermission does not know.
 *
 * The qualified ids are also written to rbac_known_permissions, which is what
 * keeps a role holding one valid after the plugin is disabled or removed.
 */
async function registerPluginPermissions(plugin: LoadedPlugin): Promise<void> {
  const declared = plugin.manifest.contributes?.permissions;
  if (!declared || declared.length === 0) return;

  try {
    const {
      registerPluginPermissions: register,
      PERMISSION_CATALOG,
      getPermissionCatalog,
      rememberPermissions,
    } = await import("../utils/permission-catalog.js");
    const { qualifyPermission, RESERVED_PERMISSION_PREFIXES } =
      await import("./manifest.js");

    // The manifest validator blocks core groups and the plugin's own id, but
    // it cannot know which other plugins exist. Re-checked here because the
    // stored manifest is data.
    const coreGroups = new Set<string>([
      ...RESERVED_PERMISSION_PREFIXES,
      ...PERMISSION_CATALOG.map((entry) => entry.group),
    ]);
    // Both the loaded plugins and any namespace already in the catalog: a
    // disabled plugin still owns its permissions, so claiming them while it is
    // off would let the namespace change hands.
    const otherPluginIds = new Set(
      [
        ...getPluginRuntime()
          .loader.list()
          .map((candidate) => candidate.id),
        ...getPermissionCatalog()
          .filter((entry) => entry.pluginId !== undefined)
          .map((entry) => entry.group),
      ].filter((id) => id !== plugin.id),
    );

    // The group is the plugin id, so a plugin named after a core group would
    // register that group's permissions. The manifest validator refuses the
    // id too; this holds for a manifest that skipped it.
    if (coreGroups.has(plugin.id)) {
      recordConflict({
        kind: "permission",
        pluginId: plugin.id,
        heldBy: "core",
        name: plugin.id,
      });
      pluginLogger.error(
        `Ignoring every ${plugin.id} permission: its id is a core permission group`,
        undefined,
        { operation: "plugin_permissions" },
      );
      return;
    }

    const accepted = declared.filter((permission) => {
      const head = permission.name.split(".")[0];
      if (coreGroups.has(head) || otherPluginIds.has(head)) {
        recordConflict({
          kind: "permission",
          pluginId: plugin.id,
          heldBy: coreGroups.has(head) ? "core" : head,
          name: permission.name,
        });
        pluginLogger.error(
          `Ignoring ${plugin.id} permission "${permission.name}": it starts with "${head}", which belongs to someone else`,
          undefined,
          { operation: "plugin_permissions" },
        );
        return false;
      }
      return true;
    });

    if (accepted.length === 0) return;

    const items = accepted.map((permission) => ({
      permission: qualifyPermission(plugin.id, permission.name),
      titleKey: permission.titleKey,
      descriptionKey: permission.descriptionKey,
    }));

    register({
      group: plugin.id,
      pluginId: plugin.id,
      label: plugin.manifest.name,
      icon: plugin.manifest.icon,
      enabled: true,
      permissions: items.map((item) => item.permission),
      items,
    });

    rememberPermissions(items.map((item) => item.permission));

    const { createCurrentRbacPermissionRepository } =
      await import("../database/repositories/factory.js");
    await createCurrentRbacPermissionRepository().recordKnown(
      items.map((item) => ({
        permission: item.permission,
        pluginId: plugin.id,
      })),
    );

    await applyRoleDefaults(plugin.id, accepted);
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
 * Only the seeded system roles are eligible, and only permissions the plugin
 * declares itself. Each default is applied at most once and the fact is
 * recorded in rbac_applied_defaults, so an admin who later revokes it does not
 * get it handed back on the next restart. That ledger lives in core rather than
 * in plugin_storage, which cascades with the plugin: uninstall-then-reinstall
 * used to silently re-add a permission that had been deliberately removed.
 */
async function applyRoleDefaults(
  pluginId: string,
  declared: PluginPermissionContribution[],
): Promise<void> {
  const wanted = declared.filter(
    (permission) => (permission.defaultRoles ?? []).length > 0,
  );
  if (wanted.length === 0) return;

  const { createCurrentRoleRepository, createCurrentRbacPermissionRepository } =
    await import("../database/repositories/factory.js");
  const { PermissionManager } = await import("../utils/permission-manager.js");
  const { qualifyPermission, SYSTEM_ROLE_NAMES } =
    await import("./manifest.js");

  const roleRepository = createCurrentRoleRepository();
  const rbacRepository = createCurrentRbacPermissionRepository();

  const alreadyApplied = new Set(
    (await rbacRepository.listAppliedDefaults()).map(
      (row) => `${row.roleName}:${row.permission}`,
    ),
  );

  const byRole = new Map<string, string[]>();
  for (const permission of wanted) {
    for (const role of permission.defaultRoles ?? []) {
      if (!(SYSTEM_ROLE_NAMES as readonly string[]).includes(role)) continue;
      const id = qualifyPermission(pluginId, permission.name);
      byRole.set(role, [...(byRole.get(role) ?? []), id]);
    }
  }

  const recorded: { roleName: string; permission: string }[] = [];

  for (const [roleName, permissions] of byRole) {
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

      const missing = permissions.filter((permission) => {
        // Applied before means the admin has had the chance to remove it, so
        // its absence now is a decision rather than a gap.
        if (alreadyApplied.has(`${roleName}:${permission}`)) return false;
        return !coveredBy(current as string[], permission);
      });

      if (missing.length > 0) {
        await roleRepository.updateRole(role.id, {
          permissions: JSON.stringify([...(current as string[]), ...missing]),
        });
      }
      // Only once the role really has them, so a failed update is retried
      // on the next boot instead of being marked done.
      for (const permission of permissions) {
        recorded.push({ roleName, permission });
      }
      if (missing.length === 0) continue;

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
    await rbacRepository.recordAppliedDefaults(recorded);
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

  // A plugin enabled without a restart still needs its 2.8 data copied.
  const { runPluginDataMigrations } =
    await import("../upgrade/boot-migrations.js");
  await runPluginDataMigrations();
}

export async function deactivatePlugin(pluginId: string): Promise<void> {
  const { loader: pluginLoader } = getPluginRuntime();
  const plugin = pluginLoader.get(pluginId);

  await pluginLoader.deactivate(pluginId);
  unregisterPluginHttp(pluginId);

  // The group stays in the catalog, greyed: a role holding one of these is not
  // wrong just because the plugin is off, and removing them made every role
  // that held one unsaveable.
  if (plugin?.manifest.contributes?.permissions?.length) {
    const { markPluginPermissionsDisabled } =
      await import("../utils/permission-catalog.js");
    markPluginPermissionsDisabled(pluginId);
  }
}

/** Switches a plugin on or off and records it, the same as the admin route. */
export async function setPluginEnabled(
  pluginId: string,
  enabled: boolean,
): Promise<void> {
  const { createCurrentPluginRepository } =
    await import("../database/repositories/factory.js");
  await createCurrentPluginRepository().update(pluginId, {
    state: enabled ? "enabled" : "disabled",
    lastError: null,
  });
  if (enabled) await activatePlugin(pluginId);
  else await deactivatePlugin(pluginId);
}

/**
 * Loads a user plugin from a .tmxplug in the plugins directory and gives it
 * a row. It starts disabled, like any plugin that arrives on disk. A copy
 * already loaded under the same id is stopped and replaced.
 */
export async function installPluginArtifact(
  file: string,
): Promise<LoadedPlugin> {
  const { loader: pluginLoader } = getPluginRuntime();
  const bundledIds = new Set(
    pluginLoader
      .list()
      .filter((plugin) => plugin.source === "bundled")
      .map((plugin) => plugin.id),
  );
  const plugin = await pluginLoader.loadArtifact(file, bundledIds);
  await seedPlugins([plugin]);
  await syncCapabilityGrants([plugin]);
  return plugin;
}

/** Stops a plugin and forgets it, before a new version is installed. */
export async function unloadPlugin(pluginId: string): Promise<void> {
  const { loader: pluginLoader } = getPluginRuntime();
  if (!pluginLoader.get(pluginId)) return;
  await deactivatePlugin(pluginId);
  pluginLoader.forget(pluginId);
}

export async function shutdownPlugins(): Promise<void> {
  if (!loader) return;
  for (const plugin of loader.list()) unregisterPluginHttp(plugin.id);
  await loader.shutdown();
}

/** Test seam. */
export function resetPluginRuntime(): void {
  loader = null;
}
