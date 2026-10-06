// Plugin management: what is installed, and enabling/disabling it.
//
// Distinct from plugin-api-routes.ts, which dispatches traffic INTO a running
// plugin. This is the control plane for the plugins themselves.

import type { AuthenticatedRequest } from "../../../types/index.js";
import express, { type Request, type Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import {
  createCurrentPluginPermissionGrantRepository,
  createCurrentPluginRepository,
} from "../repositories/factory.js";
import { getPluginRuntime } from "../../plugins/index.js";
import { describePluginFrontend } from "../../plugins/assets.js";
import { invalidatePluginPermissionCache } from "../../plugins/permissions.js";
import { getPluginPublicHttpRoutes } from "../../plugins/http.js";
import { getPluginPublicWsRoutes } from "../../plugins/ws.js";
import { PluginManageError } from "../../plugins/manage.js";
import {
  findField,
  getAllSettings,
  setSetting,
  validateSettingsSave,
  type PluginSettingsScope,
} from "../../plugins/settings.js";
import {
  getAuditUsername,
  getRequestMeta,
  logAudit,
} from "../../utils/audit-logger.js";
import type {
  PluginManifest,
  PluginSettingsField,
} from "@termix-ssh/plugin-sdk/manifest";

const router = express.Router();

/** A settings body is a flat object; an array or null is a client bug. */
function isPlainBody(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const permissionManager = PermissionManager.getInstance();
const requireManagePlugins = permissionManager.requirePermission(
  "admin.plugins.manage",
);

/**
 * @openapi
 * /plugins/public:
 *   get:
 *     summary: List the plugin frontends anonymous guest pages need
 *     description: >
 *       No auth. A shared-session or collab guest link has no session, yet its
 *       page still draws surfaces a plugin provides (a remote desktop stream).
 *       Returns only enabled plugins whose manifest sets contributes.guest,
 *       with the fields the browser loader needs and nothing operational,
 *       plus the ?view= names each serves to guests (contributes.guestViews).
 *     tags:
 *       - Plugins
 *     responses:
 *       200:
 *         description: Guest-capable plugins.
 */
router.get("/public", async (_req: Request, res: Response) => {
  try {
    const records = await createCurrentPluginRepository().listAll();
    const { loader } = getPluginRuntime();
    const plugins = records.flatMap((record) => {
      if (record.state !== "enabled") return [];
      const loaded = loader.get(record.id);
      let manifest: {
        contributes?: { guest?: boolean; guestViews?: string[] };
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      try {
        manifest = JSON.parse(record.manifestJson);
      } catch {
        return [];
      }
      if (manifest?.contributes?.guest !== true) return [];
      return [
        {
          id: record.id,
          name: record.name,
          // Not before login: it tells a scanner which known bugs apply.
          version: "",
          enabled: true,
          state: loaded?.state ?? record.state,
          contributes: {
            guest: true,
            guestViews: manifest.contributes.guestViews ?? [],
          },
          dependencies: manifest.dependencies ?? {},
          optionalDependencies: manifest.optionalDependencies ?? {},
          ...describePluginFrontend(loaded),
        },
      ];
    });
    res.json(plugins);
  } catch (error) {
    databaseLogger.error(
      "Failed to list guest plugins",
      error instanceof Error ? error : new Error(String(error)),
      { operation: "plugin_list_public" },
    );
    res.status(500).json({ error: "Failed to list plugins" });
  }
});

/**
 * @openapi
 * /plugins/public-manifest:
 *   get:
 *     summary: List the plugin frontends the login screen needs
 *     description: >
 *       No auth. The login screen draws login methods and second-factor steps
 *       that plugins provide, before anyone has signed in. Returns only
 *       enabled plugins that contribute login methods or second factors, with
 *       the fields the browser loader needs and the ids they contribute.
 *       Nothing operational: no versions, capabilities, grants, settings or
 *       errors.
 *     tags:
 *       - Plugins
 *     responses:
 *       200:
 *         description: Login-capable plugins.
 */
router.get("/public-manifest", async (_req: Request, res: Response) => {
  try {
    res.json(await listPreLoginPlugins());
  } catch (error) {
    databaseLogger.error(
      "Failed to list login plugins",
      error instanceof Error ? error : new Error(String(error)),
      { operation: "plugin_list_public_manifest" },
    );
    res.status(500).json({ error: "Failed to list plugins" });
  }
});

/** Enabled plugins with login or second-factor UI, without admin data. */
export async function listPreLoginPlugins(): Promise<
  Array<Record<string, unknown>>
> {
  const records = await createCurrentPluginRepository().listAll();
  const { loader } = getPluginRuntime();
  return records.flatMap((record) => {
    if (record.state !== "enabled") return [];
    const loaded = loader.get(record.id);
    if (loaded?.state !== "active") return [];
    let manifest: PluginManifest;
    try {
      manifest = JSON.parse(record.manifestJson) as PluginManifest;
    } catch {
      return [];
    }
    const auth = manifest?.contributes?.auth;
    const loginMethods = auth?.loginMethods ?? [];
    const secondFactors = auth?.secondFactors ?? [];
    if (loginMethods.length === 0 && secondFactors.length === 0) return [];
    return [
      {
        id: record.id,
        name: record.name,
        version: "",
        enabled: true,
        state: loaded.state,
        contributes: { auth: { loginMethods, secondFactors } },
        dependencies: manifest.dependencies ?? {},
        optionalDependencies: manifest.optionalDependencies ?? {},
        ...describePluginFrontend(loaded),
      },
    ];
  });
}

/**
 * @openapi
 * /plugins:
 *   get:
 *     summary: List installed plugins and their runtime state
 *     description: >
 *       Returns every plugin known to the database, merged with the loader's
 *       live state so the UI can tell "enabled but failed" from "disabled".
 *       Open to any authenticated user, not just admins: the app shell calls
 *       this on every session to decide which plugin-contributed tabs and
 *       rail items to register, so gating it behind admin.plugins.manage
 *       would break the shell for non-admin users.
 *
 *       Non-admins get only what the shell needs. What a plugin is allowed to
 *       do, what has been granted to it and why it failed are operational
 *       details, so capabilities, grants, lastError and publicRoutes are
 *       included only for holders of admin.plugins.manage. publicRoutes lists
 *       the HTTP paths and socket paths a running plugin serves without
 *       core's login check.
 *
 *       The frontend fields drive the browser's plugin loader: `frontend`
 *       says there is a bundle at /plugin-assets/<id>/frontend.js,
 *       `assetVersion` is its cache key, `css` says a stylesheet sits beside
 *       it, and `locales` lists the languages it ships ("en" and xx_YY).
 *       `dependencies` and `optionalDependencies` let the loader activate
 *       frontends in the same order the server does.
 *     tags:
 *       - Plugins
 *     responses:
 *       200:
 *         description: List of plugins.
 */
router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).userId as string;
    const records = await createCurrentPluginRepository().listAll();
    const { loader } = getPluginRuntime();
    const live = new Map(loader.list().map((p) => [p.id, p]));

    const canManage = await permissionManager.hasPermission(
      userId,
      "admin.plugins.manage",
    );

    // One query for every plugin rather than one per plugin.
    const grantsByPlugin = new Map<string, string[]>();
    if (canManage) {
      const grantRepository = createCurrentPluginPermissionGrantRepository();
      await Promise.all(
        records.map(async (record) => {
          const grants = await grantRepository.listByPlugin(record.id);
          grantsByPlugin.set(
            record.id,
            grants.map((grant) => grant.capability),
          );
        }),
      );
    }

    const plugins = await Promise.all(
      records.map(async (record) => {
        const loaded = live.get(record.id);

        let contributes: unknown = null;
        let capabilities: string[] = [];
        let icon: string | undefined;
        let dependencies: Record<string, string> = {};
        let optionalDependencies: Record<string, string> = {};
        let description: string | undefined;
        let author: string | undefined;
        let repository: string | undefined;
        try {
          const manifest = JSON.parse(record.manifestJson) as {
            contributes?: unknown;
            capabilities?: unknown;
            icon?: unknown;
            description?: unknown;
            author?: unknown;
            repository?: unknown;
            dependencies?: Record<string, string>;
            optionalDependencies?: Record<string, string>;
          };
          contributes = manifest?.contributes ?? null;
          capabilities = Array.isArray(manifest?.capabilities)
            ? (manifest.capabilities as string[])
            : [];
          icon = typeof manifest?.icon === "string" ? manifest.icon : undefined;
          dependencies = manifest?.dependencies ?? {};
          optionalDependencies = manifest?.optionalDependencies ?? {};
          description =
            typeof manifest?.description === "string"
              ? manifest.description
              : undefined;
          const rawAuthor = manifest?.author as { name?: unknown } | undefined;
          author =
            typeof rawAuthor?.name === "string" ? rawAuthor.name : undefined;
          repository =
            typeof manifest?.repository === "string"
              ? manifest.repository
              : undefined;
        } catch {
          contributes = null;
        }

        const summary = {
          id: record.id,
          name: record.name,
          version: record.version,
          enabled: record.state === "enabled",
          state: loaded?.state ?? record.state,
          contributes,
          icon,
          dependencies,
          optionalDependencies,
          ...describePluginFrontend(loaded),
        };

        if (!canManage) return summary;

        return {
          ...summary,
          tier: record.tier,
          source: record.source,
          registryId: record.registryId ?? null,
          autoUpdate: Boolean(record.autoUpdate),
          pinnedVersion: record.pinnedVersion ?? null,
          description,
          author,
          repository,
          signedBy: loaded?.signedBy ?? null,
          capabilities,
          grantedCapabilities: grantsByPlugin.get(record.id) ?? [],
          lastError: loaded?.lastError ?? record.lastError ?? null,
          publicRoutes: {
            http: getPluginPublicHttpRoutes(record.id),
            ws: getPluginPublicWsRoutes(record.id),
          },
        };
      }),
    );

    res.json(plugins);
  } catch (error) {
    databaseLogger.error(
      "Failed to list plugins",
      error instanceof Error ? error : new Error(String(error)),
      { operation: "plugin_list" },
    );
    res.status(500).json({ error: "Failed to list plugins" });
  }
});

async function isManagedByLinkedServer(pluginId: string): Promise<boolean> {
  if (process.env.ELECTRON_EMBEDDED !== "true") return false;
  const { getLink } = await import("../../sync/client/link-store.js");
  if (!(await getLink())) return false;
  const { isServerManaged } = await import("../../sync/client/plugins.js");
  return isServerManaged(pluginId);
}

async function auditPluginAction(
  req: Request,
  action: string,
  pluginId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const userId = (req as AuthenticatedRequest).userId as string;
  const { ipAddress, userAgent } = getRequestMeta(req);
  try {
    await logAudit({
      userId,
      username: await getAuditUsername(userId),
      action,
      resourceType: "plugin",
      resourceId: pluginId,
      resourceName: pluginId,
      details: JSON.stringify(details),
      ipAddress,
      userAgent,
      success: true,
    });
  } catch {
    // An audit failure must not undo a change that already happened.
  }
}

function sendManageError(
  res: Response,
  error: unknown,
  fallback: string,
  operation: string,
): void {
  if (error instanceof PluginManageError) {
    res.status(error.status).json({
      error: error.message,
      code: error.code,
      ...(error.details ?? {}),
    });
    return;
  }
  databaseLogger.error(
    fallback,
    error instanceof Error ? error : new Error(String(error)),
    { operation },
  );
  res.status(500).json({ error: fallback });
}

async function refuseOnLinkedDesktop(res: Response): Promise<boolean> {
  const { isLinkedDesktop } = await import("../../plugins/manage.js");
  if (!(await isLinkedDesktop())) return false;
  res.status(409).json({
    error: "Plugins on a linked desktop are managed by the server",
    code: "MANAGED_BY_SERVER",
  });
  return true;
}

/**
 * @openapi
 * /plugins/{id}/state:
 *   patch:
 *     summary: Enable or disable a plugin
 *     description: Persists the new state and starts or stops the plugin immediately. Disabling releases everything the plugin owns, including any port it was listening on. Enabling also starts any installed hard dependency that is off, and disabling also stops the running plugins that depend on it. With dryRun nothing changes and the response lists what would.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: dryRun
 *         schema:
 *           type: boolean
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: The plugin's new state.
 *       400:
 *         description: Invalid request body.
 *       403:
 *         description: The caller lacks admin.plugins.manage.
 *       404:
 *         description: No such plugin.
 *       409:
 *         description: This desktop is linked to a server, which decides whether the plugin runs.
 */
router.patch(
  "/:id/state",
  authenticateJWT,
  requireManagePlugins,
  async (req: Request, res: Response) => {
    const pluginId = String(req.params.id);
    const { enabled } = req.body ?? {};

    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }

    try {
      const record = await createCurrentPluginRepository().findById(pluginId);
      if (!record) {
        res.status(404).json({ error: "Plugin not found" });
        return;
      }

      // A linked desktop runs what its server runs.
      if (await isManagedByLinkedServer(pluginId)) {
        res.status(409).json({
          error: "Managed by the linked server",
          code: "MANAGED_BY_SERVER",
        });
        return;
      }

      const { planStateChange, setPluginState } =
        await import("../../plugins/manage.js");

      if (req.query.dryRun === "1" || req.query.dryRun === "true") {
        res.json({
          id: pluginId,
          enabled,
          ...(await planStateChange(pluginId, enabled)),
        });
        return;
      }

      const result = await setPluginState(pluginId, enabled);
      await auditPluginAction(
        req,
        enabled ? "enable_plugin" : "disable_plugin",
        pluginId,
        {
          enable: result.enable,
          disable: result.disable,
        },
      );

      databaseLogger.info(
        `Plugin ${pluginId} ${enabled ? "enabled" : "disabled"}`,
        { operation: "plugin_state_change", pluginId },
      );

      res.json({ id: pluginId, enabled, ...result });
    } catch (error) {
      sendManageError(
        res,
        error,
        "Failed to change plugin state",
        "plugin_state_change",
      );
    }
  },
);

/**
 * @openapi
 * /plugins/{id}/retry:
 *   post:
 *     summary: Start a plugin again after it failed
 *     description: >
 *       Clears the plugin's error budget and activates it. Use after fixing
 *       whatever made it fail, such as installing a missing dependency or
 *       freeing a port it needs.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The plugin's state after the attempt.
 *       403:
 *         description: The caller lacks admin.plugins.manage.
 *       404:
 *         description: No such plugin, or it is not on disk.
 *       500:
 *         description: The plugin failed to start again.
 */
router.post(
  "/:id/retry",
  authenticateJWT,
  requireManagePlugins,
  async (req: Request, res: Response) => {
    const pluginId = String(req.params.id);

    try {
      const repository = createCurrentPluginRepository();
      const record = await repository.findById(pluginId);
      if (!record) {
        res.status(404).json({ error: "Plugin not found" });
        return;
      }

      const { loader } = getPluginRuntime();
      if (!loader.get(pluginId)) {
        res.status(404).json({ error: "Plugin is not present on disk" });
        return;
      }

      await repository.update(pluginId, {
        state: "enabled",
        lastError: null,
      });
      await loader.retry(pluginId);

      databaseLogger.info(`Plugin ${pluginId} restarted`, {
        operation: "plugin_retry",
        pluginId,
      });

      res.json({ id: pluginId, state: loader.get(pluginId)?.state });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      databaseLogger.error(
        `Failed to retry plugin ${pluginId}`,
        error instanceof Error ? error : new Error(message),
        { operation: "plugin_retry" },
      );

      try {
        await createCurrentPluginRepository().update(pluginId, {
          state: "failed",
          lastError: message,
        });
      } catch {
        // Reporting the failure must not mask it.
      }

      res.status(500).json({ error: "Failed to start the plugin" });
    }
  },
);

/**
 * @openapi
 * /plugins/{id}/grants:
 *   post:
 *     summary: Grant a plugin one of its manifest-declared capabilities
 *     description: >
 *       The grant is install-wide, not per-user: it unlocks the capability for
 *       the plugin as a whole. What each call then does with the capability
 *       (e.g. whose hosts ctx.hosts.list() returns) is still scoped to
 *       whichever user's request triggered it.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               capability:
 *                 type: string
 *     responses:
 *       200:
 *         description: The capability is now granted.
 *       400:
 *         description: The capability is not declared in the plugin's manifest.
 *       403:
 *         description: The caller lacks admin.plugins.manage.
 *       404:
 *         description: No such plugin.
 */
router.post(
  "/:id/grants",
  authenticateJWT,
  requireManagePlugins,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId as string;
    const pluginId = String(req.params.id);
    const { capability } = req.body ?? {};

    if (typeof capability !== "string" || !capability) {
      res.status(400).json({ error: "capability is required" });
      return;
    }

    try {
      const repository = createCurrentPluginRepository();
      const record = await repository.findById(pluginId);
      if (!record) {
        res.status(404).json({ error: "Plugin not found" });
        return;
      }

      let declared: string[] = [];
      try {
        const manifest = JSON.parse(record.manifestJson) as {
          capabilities?: unknown;
        };
        declared = Array.isArray(manifest?.capabilities)
          ? (manifest.capabilities as string[])
          : [];
      } catch {
        declared = [];
      }

      if (!declared.includes(capability)) {
        res.status(400).json({
          error: "This capability is not declared in the plugin's manifest",
        });
        return;
      }

      const grantRepository = createCurrentPluginPermissionGrantRepository();
      const existing = await grantRepository.findGrant(pluginId, capability);
      if (!existing) {
        await grantRepository.grant({
          pluginId,
          capability,
          grantedBy: userId,
        });
        invalidatePluginPermissionCache(pluginId);
      }

      databaseLogger.info(`Granted ${capability} to plugin ${pluginId}`, {
        operation: "plugin_grant",
        pluginId,
      });

      res.json({ id: pluginId, capability, granted: true });
    } catch (error) {
      databaseLogger.error(
        `Failed to grant ${capability} to plugin ${pluginId}`,
        error instanceof Error ? error : new Error(String(error)),
        { operation: "plugin_grant" },
      );
      res.status(500).json({ error: "Failed to grant the capability" });
    }
  },
);

/**
 * @openapi
 * /plugins/{id}/grants/{capability}:
 *   delete:
 *     summary: Revoke a previously granted plugin capability
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: capability
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The capability is no longer granted.
 *       403:
 *         description: The caller lacks admin.plugins.manage.
 *       404:
 *         description: No such plugin, or the capability was not granted.
 */
router.delete(
  "/:id/grants/:capability",
  authenticateJWT,
  requireManagePlugins,
  async (req: Request, res: Response) => {
    const pluginId = String(req.params.id);
    const capability = String(req.params.capability);

    try {
      const revoked =
        await createCurrentPluginPermissionGrantRepository().revoke(
          pluginId,
          capability,
        );
      if (!revoked) {
        res.status(404).json({ error: "That capability was not granted" });
        return;
      }
      invalidatePluginPermissionCache(pluginId);

      databaseLogger.info(`Revoked ${capability} from plugin ${pluginId}`, {
        operation: "plugin_grant_revoke",
        pluginId,
      });

      res.json({ id: pluginId, capability, granted: false });
    } catch (error) {
      databaseLogger.error(
        `Failed to revoke ${capability} from plugin ${pluginId}`,
        error instanceof Error ? error : new Error(String(error)),
        { operation: "plugin_grant_revoke" },
      );
      res.status(500).json({ error: "Failed to revoke the capability" });
    }
  },
);

/**
 * @openapi
 * /plugins/{id}/data:
 *   delete:
 *     summary: Delete everything a plugin stores
 *     description: Drops every table under the plugin's prefix and clears its key/value state, settings and secrets, migration ledger and files. Role permissions stay, and the capabilities the admin agreed to are granted again. The plugin stays installed but is switched off, so nothing is writing while its tables go. It cannot be undone.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: What was removed.
 *       404:
 *         description: No such plugin.
 *       500:
 *         description: Failed to remove the plugin's data.
 */
router.delete(
  "/:id/data",
  authenticateJWT,
  requireManagePlugins,
  async (req: Request, res: Response) => {
    const pluginId = String(req.params.id);
    const userId = (req as AuthenticatedRequest).userId;

    try {
      const record = await createCurrentPluginRepository().findById(pluginId);
      if (!record) {
        res.status(404).json({ error: "No such plugin" });
        return;
      }

      if (await isManagedByLinkedServer(pluginId)) {
        res.status(409).json({
          error: "Managed by the linked server",
          code: "MANAGED_BY_SERVER",
        });
        return;
      }

      // The plugin is stopped first: dropping a table out from under a
      // running plugin turns its next query into an error.
      const { deletePluginData } = await import("../../plugins/manage.js");
      const removed = await deletePluginData(pluginId, userId ?? null);

      databaseLogger.warn(`Removed all data for plugin ${pluginId}`, {
        operation: "plugin_remove_data",
        pluginId,
        userId,
        tables: removed.tables.length,
        kvKeys: removed.kvKeys,
      });
      await auditPluginAction(req, "delete_plugin_data", pluginId, {
        tables: removed.tables.length,
        kvKeys: removed.kvKeys,
      });

      res.json({ id: pluginId, removed });
    } catch (error) {
      databaseLogger.error(
        `Failed to remove data for plugin ${pluginId}`,
        error instanceof Error ? error : new Error(String(error)),
        { operation: "plugin_remove_data" },
      );
      res.status(500).json({ error: "Failed to remove the plugin's data" });
    }
  },
);

/**
 * Loads a plugin's manifest for the settings routes.
 *
 * Read from the loader rather than the database row so the fields a request is
 * validated against are the ones the running build declares.
 */
async function loadManifestForSettings(
  pluginId: string,
): Promise<PluginManifest | null> {
  const { loader } = getPluginRuntime();
  const live = loader.get(pluginId);
  if (live?.manifest) return live.manifest;

  const record = await createCurrentPluginRepository().findById(pluginId);
  if (!record) return null;
  try {
    return JSON.parse(record.manifestJson) as PluginManifest;
  } catch {
    return null;
  }
}

/**
 * Whether the caller may write a given field.
 *
 * Admin fields fall back to admin.plugins.manage, so a plugin that declares no
 * permission of its own still cannot have its install-wide settings changed by
 * an ordinary user. A field naming its own permission uses that instead.
 */
async function canWriteField(
  userId: string,
  manifest: PluginManifest,
  scope: PluginSettingsScope,
  field: PluginSettingsField,
): Promise<boolean> {
  // Admin scope always needs admin.plugins.manage. A field-level permission
  // narrows who may write it; it never widens the scope's own gate, so a
  // plugin cannot hand an ordinary user install-wide configuration by naming
  // a permission that user happens to hold.
  if (
    scope === "admin" &&
    !(await permissionManager.hasPermission(userId, "admin.plugins.manage"))
  ) {
    return false;
  }

  if (field.permission) {
    const { resolvePermission } = await import("../../plugins/rbac.js");
    return permissionManager.hasPermission(
      userId,
      resolvePermission(manifest, field.permission),
    );
  }

  return true;
}

/** Applies a body of values to one scope, collecting per-field errors. */
async function applySettings(
  userId: string,
  manifest: PluginManifest,
  scope: PluginSettingsScope,
  scopeId: string | null,
  body: Record<string, unknown>,
  options: { isHostOwner?: boolean } = {},
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};

  for (const [key] of Object.entries(body)) {
    const field = findField(manifest, scope, key);
    if (!field) {
      errors[key] = "Not a settings field this plugin declares";
      continue;
    }
    if (!(await canWriteField(userId, manifest, scope, field))) {
      errors[key] = "You do not have permission to change this setting";
      continue;
    }
    if (scope === "host" && field.ownerOnly && !options.isHostOwner) {
      errors[key] = "Only the host's owner can change this setting";
    }
  }
  if (Object.keys(errors).length > 0) return errors;

  // The plugin's own checks see the whole save before anything is written.
  const rejected = await validateSettingsSave(
    manifest.id,
    scope,
    scopeId,
    body,
  );
  if (Object.keys(rejected).length > 0) return rejected;

  for (const [key, value] of Object.entries(body)) {
    const error = await setSetting(manifest, scope, scopeId, key, value);
    if (error) errors[key] = error;
  }

  return errors;
}

/**
 * @openapi
 * /plugins/{id}/settings/admin:
 *   get:
 *     summary: Read a plugin's install-wide settings
 *     description: >
 *       Returns every admin-scope field the plugin declares, with stored values
 *       over declared defaults. Secret fields come back as { set: boolean } and
 *       never carry their value, so a browser can render "configured" without
 *       ever holding the secret.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The plugin's admin settings.
 *       403:
 *         description: The caller lacks admin.plugins.manage.
 *       404:
 *         description: No such plugin.
 */
router.get(
  "/:id/settings/admin",
  authenticateJWT,
  requireManagePlugins,
  async (req: Request, res: Response) => {
    const pluginId = String(req.params.id);
    try {
      const manifest = await loadManifestForSettings(pluginId);
      if (!manifest) {
        res.status(404).json({ error: "No such plugin" });
        return;
      }
      const values = await getAllSettings(manifest, "admin", null, {
        redactSecrets: true,
      });
      res.json({ id: pluginId, values });
    } catch (error) {
      databaseLogger.error(
        `Failed to read admin settings for plugin ${pluginId}`,
        error instanceof Error ? error : new Error(String(error)),
        { operation: "plugin_settings_read" },
      );
      res.status(500).json({ error: "Failed to read the plugin's settings" });
    }
  },
);

/**
 * @openapi
 * /plugins/{id}/settings/admin:
 *   put:
 *     summary: Update a plugin's install-wide settings
 *     description: >
 *       Writes the given keys. Every value is validated against the field the
 *       manifest declares, and a key the manifest never declared is rejected
 *       rather than stored. Validation failures come back per field so a form
 *       can show every problem at once. Sending a secret field back as
 *       { set: true } leaves the stored value alone, so saving a form does not
 *       clear a key it was never shown.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: The updated settings.
 *       400:
 *         description: One or more fields were rejected.
 *       403:
 *         description: The caller lacks admin.plugins.manage.
 *       404:
 *         description: No such plugin.
 */
router.put(
  "/:id/settings/admin",
  authenticateJWT,
  requireManagePlugins,
  async (req: Request, res: Response) => {
    const pluginId = String(req.params.id);
    const userId = (req as AuthenticatedRequest).userId as string;

    if (!isPlainBody(req.body)) {
      res.status(400).json({ error: "Body must be an object of settings" });
      return;
    }

    try {
      const manifest = await loadManifestForSettings(pluginId);
      if (!manifest) {
        res.status(404).json({ error: "No such plugin" });
        return;
      }

      const errors = await applySettings(
        userId,
        manifest,
        "admin",
        null,
        req.body,
      );
      if (Object.keys(errors).length > 0) {
        res.status(400).json({ error: "Some settings were rejected", errors });
        return;
      }

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "update_plugin_settings",
        resourceType: "setting",
        resourceId: pluginId,
        resourceName: manifest.name,
        // Keys only: a value here could be the secret we just encrypted.
        details: JSON.stringify({
          scope: "admin",
          keys: Object.keys(req.body),
        }),
        ipAddress,
        userAgent,
        success: true,
      });

      const values = await getAllSettings(manifest, "admin", null, {
        redactSecrets: true,
      });
      res.json({ id: pluginId, values });
    } catch (error) {
      databaseLogger.error(
        `Failed to update admin settings for plugin ${pluginId}`,
        error instanceof Error ? error : new Error(String(error)),
        { operation: "plugin_settings_write" },
      );
      res.status(500).json({ error: "Failed to update the plugin's settings" });
    }
  },
);

/**
 * @openapi
 * /plugins/{id}/settings/user:
 *   get:
 *     summary: Read the caller's own settings for a plugin
 *     description: Returns every user-scope field the plugin declares for the authenticated user. The scope is always the caller, never a user id from the request.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The caller's settings for this plugin.
 *       404:
 *         description: No such plugin.
 */
router.get(
  "/:id/settings/user",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const pluginId = String(req.params.id);
    const userId = (req as AuthenticatedRequest).userId as string;

    try {
      const manifest = await loadManifestForSettings(pluginId);
      if (!manifest) {
        res.status(404).json({ error: "No such plugin" });
        return;
      }
      const values = await getAllSettings(manifest, "user", userId, {
        redactSecrets: true,
      });
      res.json({ id: pluginId, values });
    } catch (error) {
      databaseLogger.error(
        `Failed to read user settings for plugin ${pluginId}`,
        error instanceof Error ? error : new Error(String(error)),
        { operation: "plugin_settings_read" },
      );
      res.status(500).json({ error: "Failed to read the plugin's settings" });
    }
  },
);

/**
 * @openapi
 * /plugins/{id}/settings/user:
 *   put:
 *     summary: Update the caller's own settings for a plugin
 *     description: Writes user-scope values for the authenticated user. The scope is always the caller, so one user can never write another's settings.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: The updated settings.
 *       400:
 *         description: One or more fields were rejected.
 *       404:
 *         description: No such plugin.
 */
router.put(
  "/:id/settings/user",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const pluginId = String(req.params.id);
    const userId = (req as AuthenticatedRequest).userId as string;

    if (!isPlainBody(req.body)) {
      res.status(400).json({ error: "Body must be an object of settings" });
      return;
    }

    try {
      const manifest = await loadManifestForSettings(pluginId);
      if (!manifest) {
        res.status(404).json({ error: "No such plugin" });
        return;
      }

      const errors = await applySettings(
        userId,
        manifest,
        "user",
        userId,
        req.body,
      );
      if (Object.keys(errors).length > 0) {
        res.status(400).json({ error: "Some settings were rejected", errors });
        return;
      }

      const values = await getAllSettings(manifest, "user", userId, {
        redactSecrets: true,
      });
      res.json({ id: pluginId, values });
    } catch (error) {
      databaseLogger.error(
        `Failed to update user settings for plugin ${pluginId}`,
        error instanceof Error ? error : new Error(String(error)),
        { operation: "plugin_settings_write" },
      );
      res.status(500).json({ error: "Failed to update the plugin's settings" });
    }
  },
);

/**
 * @openapi
 * /plugins/{id}/settings/host/{hostId}:
 *   get:
 *     summary: Read a plugin's settings for one host
 *     description: Returns every host-scope field the plugin declares for that host. Requires edit access to the host, the same check the host editor itself uses.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: hostId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: The plugin's settings for that host.
 *       400:
 *         description: Invalid host id.
 *       403:
 *         description: No edit access to that host.
 *       404:
 *         description: No such plugin.
 */
router.get(
  "/:id/settings/host/:hostId",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const pluginId = String(req.params.id);
    const userId = (req as AuthenticatedRequest).userId as string;
    const hostId = Number(req.params.hostId);

    if (!Number.isInteger(hostId) || hostId <= 0) {
      res.status(400).json({ error: "Invalid host ID" });
      return;
    }

    try {
      const manifest = await loadManifestForSettings(pluginId);
      if (!manifest) {
        res.status(404).json({ error: "No such plugin" });
        return;
      }

      const access = await permissionManager.canAccessHost(
        userId,
        hostId,
        "edit",
      );
      if (!access.hasAccess) {
        res.status(403).json({ error: "Access denied to host" });
        return;
      }

      const values = await getAllSettings(manifest, "host", hostId, {
        redactSecrets: true,
      });
      res.json({ id: pluginId, hostId, values });
    } catch (error) {
      databaseLogger.error(
        `Failed to read host settings for plugin ${pluginId}`,
        error instanceof Error ? error : new Error(String(error)),
        { operation: "plugin_settings_read" },
      );
      res.status(500).json({ error: "Failed to read the plugin's settings" });
    }
  },
);

/**
 * @openapi
 * /plugins/{id}/settings/host/{hostId}:
 *   put:
 *     summary: Update a plugin's settings for one host
 *     description: Writes host-scope values. Requires edit access to the host, so a user who may only connect to a shared host cannot change how a plugin treats it. A value written here becomes the host's own rather than following the host defaults; list keys in `_inherit` to hand them back to the defaults.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: hostId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: The updated settings.
 *       400:
 *         description: Invalid host id, or one or more fields were rejected.
 *       403:
 *         description: No edit access to that host.
 *       404:
 *         description: No such plugin.
 */
router.put(
  "/:id/settings/host/:hostId",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const pluginId = String(req.params.id);
    const userId = (req as AuthenticatedRequest).userId as string;
    const hostId = Number(req.params.hostId);

    if (!Number.isInteger(hostId) || hostId <= 0) {
      res.status(400).json({ error: "Invalid host ID" });
      return;
    }
    if (!isPlainBody(req.body)) {
      res.status(400).json({ error: "Body must be an object of settings" });
      return;
    }

    try {
      const manifest = await loadManifestForSettings(pluginId);
      if (!manifest) {
        res.status(404).json({ error: "No such plugin" });
        return;
      }

      const access = await permissionManager.canAccessHost(
        userId,
        hostId,
        "edit",
      );
      if (!access.hasAccess) {
        res.status(403).json({ error: "Access denied to host" });
        return;
      }

      const { _inherit: inheritRaw, ...written } = req.body as Record<
        string,
        unknown
      >;
      const inherit = Array.isArray(inheritRaw)
        ? inheritRaw.filter((key): key is string => typeof key === "string")
        : [];
      const errors = await applySettings(
        userId,
        manifest,
        "host",
        String(hostId),
        written,
        { isHostOwner: access.isOwner === true },
      );
      if (Object.keys(errors).length > 0) {
        res.status(400).json({ error: "Some settings were rejected", errors });
        return;
      }
      const { touchHost } = await import("./host-plugin-settings.js");
      await touchHost(hostId);
      // A value set here is the host's own; a key in _inherit follows the
      // host defaults again.
      const { changeHostOverrides } =
        await import("../../hosts/defaults/overrides.js");
      await changeHostOverrides([hostId], {
        own: Object.keys(written).map((key) => [pluginId, key]),
        inherit: inherit.map((key) => [pluginId, key]),
      });

      const values = await getAllSettings(manifest, "host", hostId, {
        redactSecrets: true,
      });
      res.json({ id: pluginId, hostId, values });
    } catch (error) {
      databaseLogger.error(
        `Failed to update host settings for plugin ${pluginId}`,
        error instanceof Error ? error : new Error(String(error)),
        { operation: "plugin_settings_write" },
      );
      res.status(500).json({ error: "Failed to update the plugin's settings" });
    }
  },
);

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function readVersion(body: unknown): string | undefined | null {
  const version = (body as { version?: unknown } | undefined)?.version;
  if (version === undefined || version === null || version === "") {
    return undefined;
  }
  return typeof version === "string" && version.length <= 64 ? version : null;
}

/**
 * @openapi
 * /plugins/registry:
 *   get:
 *     summary: List the plugins in the official registry
 *     description: >
 *       Fetches the official registry index (cached for 15 minutes unless
 *       refresh is set) and merges it with what is installed here: the
 *       installed version, the newest release this build can run, whether an
 *       update asks for new capabilities, and the pin and auto-update choices.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: query
 *         name: refresh
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: The registry listing.
 *       403:
 *         description: The caller lacks admin.plugins.manage.
 *       502:
 *         description: The registry could not be reached.
 */
router.get(
  "/registry",
  authenticateJWT,
  requireManagePlugins,
  async (req: Request, res: Response) => {
    try {
      const { listRegistry } = await import("../../plugins/manage.js");
      const force = req.query.refresh === "1" || req.query.refresh === "true";
      res.json(await listRegistry({ force }));
    } catch (error) {
      databaseLogger.warn("Plugin registry fetch failed", {
        operation: "plugin_registry",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(502).json({
        error: "Could not reach the plugin registry",
        code: "REGISTRY_UNREACHABLE",
      });
    }
  },
);

/**
 * @openapi
 * /plugins/update-all:
 *   post:
 *     summary: Update every plugin that has a newer release
 *     description: Skips pinned plugins and any update that asks for new capabilities, which are returned under needsReview for the admin to look at one by one.
 *     tags:
 *       - Plugins
 *     responses:
 *       200:
 *         description: What was updated, what needs review and what failed.
 *       403:
 *         description: The caller lacks admin.plugins.manage.
 *       409:
 *         description: This desktop is linked to a server, which manages its plugins.
 */
router.post(
  "/update-all",
  authenticateJWT,
  requireManagePlugins,
  async (req: Request, res: Response) => {
    if (await refuseOnLinkedDesktop(res)) return;
    try {
      const { updateAllPlugins } = await import("../../plugins/manage.js");
      const userId = (req as AuthenticatedRequest).userId as string;
      const result = await updateAllPlugins({ userId });
      for (const done of result.updated) {
        await auditPluginAction(req, "update_plugin", done.id, {
          version: done.version,
        });
      }
      res.json(result);
    } catch (error) {
      sendManageError(res, error, "Failed to update plugins", "plugin_update");
    }
  },
);

/**
 * @openapi
 * /plugins/{id}/install:
 *   post:
 *     summary: Install a plugin from the official registry
 *     description: >
 *       Downloads the release, checks its sha256 and signature against a key
 *       this build trusts, loads it, grants the capabilities it declares and
 *       starts it along with any installed dependency that is off. Without a
 *       version the newest compatible release is used; naming an older one
 *       pins the plugin there. A bundled plugin at its shipped version needs
 *       no download.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               version:
 *                 type: string
 *     responses:
 *       200:
 *         description: The installed version and the plugin's state.
 *       400:
 *         description: Invalid id or version.
 *       403:
 *         description: The caller lacks admin.plugins.manage.
 *       404:
 *         description: Not in the official registry.
 *       409:
 *         description: Already installed, incompatible, or managed by a linked server.
 *       502:
 *         description: The registry could not be reached.
 */
router.post(
  "/:id/install",
  authenticateJWT,
  requireManagePlugins,
  async (req: Request, res: Response) => {
    const pluginId = String(req.params.id);
    const version = readVersion(req.body);
    if (!ID_PATTERN.test(pluginId) || version === null) {
      res.status(400).json({ error: "Invalid plugin id or version" });
      return;
    }
    if (await refuseOnLinkedDesktop(res)) return;
    try {
      const { installPlugin } = await import("../../plugins/manage.js");
      const userId = (req as AuthenticatedRequest).userId as string;
      const result = await installPlugin(pluginId, { version, userId });
      await auditPluginAction(req, "install_plugin", pluginId, {
        version: result.version,
      });
      res.json(result);
    } catch (error) {
      sendManageError(
        res,
        error,
        "Failed to install the plugin",
        "plugin_install",
      );
    }
  },
);

/**
 * @openapi
 * /plugins/{id}/update:
 *   post:
 *     summary: Update or change the installed version of a plugin
 *     description: >
 *       Swaps in another release from the official registry, newer or older.
 *       If the release declares capabilities the installed one does not, the
 *       request must set acceptCapabilities, otherwise it answers 409 with
 *       code CAPABILITIES_ADDED and the list. A running plugin is started
 *       again on the new version. Naming a version that is not the newest
 *       pins the plugin to it.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               version:
 *                 type: string
 *               acceptCapabilities:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: The new version and the plugin's state.
 *       400:
 *         description: Invalid id or version.
 *       403:
 *         description: The caller lacks admin.plugins.manage.
 *       404:
 *         description: Not installed, or the version is not in the registry.
 *       409:
 *         description: Same version, new capabilities need consent, or managed by a linked server.
 */
router.post(
  "/:id/update",
  authenticateJWT,
  requireManagePlugins,
  async (req: Request, res: Response) => {
    const pluginId = String(req.params.id);
    const version = readVersion(req.body);
    if (!ID_PATTERN.test(pluginId) || version === null) {
      res.status(400).json({ error: "Invalid plugin id or version" });
      return;
    }
    if (await refuseOnLinkedDesktop(res)) return;
    try {
      const { updatePlugin } = await import("../../plugins/manage.js");
      const userId = (req as AuthenticatedRequest).userId as string;
      const result = await updatePlugin(pluginId, {
        version,
        userId,
        acceptCapabilities: req.body?.acceptCapabilities === true,
      });
      await auditPluginAction(req, "update_plugin", pluginId, {
        version: result.version,
      });
      res.json(result);
    } catch (error) {
      sendManageError(
        res,
        error,
        "Failed to update the plugin",
        "plugin_update",
      );
    }
  },
);

/**
 * @openapi
 * /plugins/{id}:
 *   delete:
 *     summary: Uninstall a plugin
 *     description: >
 *       Stops the plugin, drops its tables, settings, secrets, grants and
 *       files, and removes it. A plugin that ships with Termix keeps its
 *       files in the image but is marked uninstalled and never loads again
 *       until it is installed from the Plugins tab. Refused while a running
 *       plugin depends on it.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: What was removed.
 *       403:
 *         description: The caller lacks admin.plugins.manage.
 *       404:
 *         description: No such plugin.
 *       409:
 *         description: Other running plugins depend on it, or managed by a linked server.
 */
router.delete(
  "/:id",
  authenticateJWT,
  requireManagePlugins,
  async (req: Request, res: Response) => {
    const pluginId = String(req.params.id);
    if (!ID_PATTERN.test(pluginId)) {
      res.status(400).json({ error: "Invalid plugin id" });
      return;
    }
    if (await refuseOnLinkedDesktop(res)) return;
    try {
      const { uninstallPlugin } = await import("../../plugins/manage.js");
      const result = await uninstallPlugin(pluginId);
      await auditPluginAction(req, "uninstall_plugin", pluginId, {
        tables: result.removed.tables.length,
      });
      res.json(result);
    } catch (error) {
      sendManageError(
        res,
        error,
        "Failed to uninstall the plugin",
        "plugin_uninstall",
      );
    }
  },
);

/**
 * @openapi
 * /plugins/{id}/options:
 *   patch:
 *     summary: Change a plugin's update choices
 *     description: autoUpdate lets the background check apply new releases that ask for nothing new. pinned holds the plugin at its installed version, which also stops auto-update.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               autoUpdate:
 *                 type: boolean
 *               pinned:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: The saved choices.
 *       400:
 *         description: Invalid request body.
 *       403:
 *         description: The caller lacks admin.plugins.manage.
 *       404:
 *         description: No such plugin.
 */
router.patch(
  "/:id/options",
  authenticateJWT,
  requireManagePlugins,
  async (req: Request, res: Response) => {
    const pluginId = String(req.params.id);
    const { autoUpdate, pinned } = req.body ?? {};
    if (
      (autoUpdate !== undefined && typeof autoUpdate !== "boolean") ||
      (pinned !== undefined && typeof pinned !== "boolean")
    ) {
      res.status(400).json({ error: "autoUpdate and pinned must be booleans" });
      return;
    }
    try {
      const { setPluginOptions } = await import("../../plugins/manage.js");
      const result = await setPluginOptions(pluginId, { autoUpdate, pinned });
      await auditPluginAction(req, "update_plugin_options", pluginId, result);
      res.json({ id: pluginId, ...result });
    } catch (error) {
      sendManageError(
        res,
        error,
        "Failed to save plugin options",
        "plugin_options",
      );
    }
  },
);

/**
 * @openapi
 * /plugins/{id}/data:
 *   get:
 *     summary: Summarize what a plugin stores
 *     description: The plugin's tables with row counts, key/value count, stored settings per scope, applied migrations, capability grants and the size of its files folder. No values are returned.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The summary.
 *       403:
 *         description: The caller lacks admin.plugins.manage.
 *       404:
 *         description: No such plugin.
 */
router.get(
  "/:id/data",
  authenticateJWT,
  requireManagePlugins,
  async (req: Request, res: Response) => {
    const pluginId = String(req.params.id);
    try {
      const { getPluginDataSummary } = await import("../../plugins/manage.js");
      res.json({ id: pluginId, ...(await getPluginDataSummary(pluginId)) });
    } catch (error) {
      sendManageError(
        res,
        error,
        "Failed to read the plugin's data",
        "plugin_data",
      );
    }
  },
);

export default router;
