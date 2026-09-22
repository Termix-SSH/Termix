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
import { invalidatePluginPermissionCache } from "../../plugins/permissions.js";

const router = express.Router();

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const permissionManager = PermissionManager.getInstance();
const requireManagePlugins = permissionManager.requirePermission(
  "admin.plugins.manage",
);

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
 *       details, so capabilities, grants and lastError are included only for
 *       holders of admin.plugins.manage.
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

    const plugins = records.map((record) => {
      const loaded = live.get(record.id);

      let contributes: unknown = null;
      let capabilities: string[] = [];
      try {
        const manifest = JSON.parse(record.manifestJson) as {
          contributes?: unknown;
          capabilities?: unknown;
        };
        contributes = manifest?.contributes ?? null;
        capabilities = Array.isArray(manifest?.capabilities)
          ? (manifest.capabilities as string[])
          : [];
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
      };

      if (!canManage) return summary;

      return {
        ...summary,
        tier: record.tier,
        source: record.source,
        capabilities,
        grantedCapabilities: grantsByPlugin.get(record.id) ?? [],
        lastError: loaded?.lastError ?? record.lastError ?? null,
      };
    });

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

/**
 * @openapi
 * /plugins/{id}/state:
 *   patch:
 *     summary: Enable or disable a plugin
 *     description: Persists the new state and starts or stops the plugin immediately. Disabling releases everything the plugin owns, including any port it was listening on.
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
      const repository = createCurrentPluginRepository();
      const record = await repository.findById(pluginId);
      if (!record) {
        res.status(404).json({ error: "Plugin not found" });
        return;
      }

      // Persist first: if the start or stop below throws, the recorded
      // intent still matches what the user asked for, and the next boot
      // acts on it rather than silently reverting.
      await repository.update(pluginId, {
        state: enabled ? "enabled" : "disabled",
        lastError: null,
      });

      const { activatePlugin, deactivatePlugin } =
        await import("../../plugins/index.js");

      if (enabled) await activatePlugin(pluginId);
      else await deactivatePlugin(pluginId);

      databaseLogger.info(
        `Plugin ${pluginId} ${enabled ? "enabled" : "disabled"}`,
        { operation: "plugin_state_change", pluginId },
      );

      res.json({ id: pluginId, enabled });
    } catch (error) {
      databaseLogger.error(
        `Failed to change state for plugin ${pluginId}`,
        error instanceof Error ? error : new Error(String(error)),
        { operation: "plugin_state_change" },
      );
      res.status(500).json({ error: "Failed to change plugin state" });
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

export default router;
