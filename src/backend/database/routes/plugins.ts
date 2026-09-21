// Plugin management: what is installed, and enabling/disabling it.
//
// Distinct from plugin-api-routes.ts, which dispatches traffic INTO a running
// plugin. This is the control plane for the plugins themselves.

import type { AuthenticatedRequest } from "../../../types/index.js";
import express, { type Request, type Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { createCurrentPluginRepository } from "../repositories/factory.js";
import { getPluginRuntime } from "../../plugins/index.js";

const router = express.Router();

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * @openapi
 * /plugins:
 *   get:
 *     summary: List installed plugins and their runtime state
 *     description: Returns every plugin known to the database, merged with the loader's live state so the UI can tell "enabled but crashed" from "disabled".
 *     tags:
 *       - Plugins
 *     responses:
 *       200:
 *         description: List of plugins.
 */
router.get("/", authenticateJWT, async (_req: Request, res: Response) => {
  try {
    const records = await createCurrentPluginRepository().listAll();
    const { loader } = getPluginRuntime();
    const live = new Map(loader.list().map((p) => [p.id, p]));

    const plugins = records.map((record) => {
      const loaded = live.get(record.id);
      let contributes: unknown = null;
      try {
        contributes = JSON.parse(record.manifestJson)?.contributes ?? null;
      } catch {
        contributes = null;
      }

      return {
        id: record.id,
        name: record.name,
        version: record.version,
        tier: record.tier,
        source: record.source,
        enabled: record.state === "enabled",
        runtimeState: loaded?.state ?? "stopped",
        lastError: loaded?.lastError ?? null,
        contributes,
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
 *       404:
 *         description: No such plugin.
 */
router.patch(
  "/:id/state",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
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
      });

      const { activatePlugin, deactivatePlugin } =
        await import("../../plugins/index.js");

      if (enabled) await activatePlugin(pluginId, userId);
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

export default router;
