// Mounted at /plugin-api. Every installed plugin that exposes backend routes
// registers a sub-router here under its own plugin id, and this dispatcher
// forwards matching requests to it. The plugin runtime populates the map via
// registerPluginRouter when a plugin activates, and clears it on deactivate,
// so an inactive plugin falls back to the 404 below.
//
// WebSocket note: plugin WS traffic does NOT get its own port from the
// 30001-30006 range. It rides the existing WS servers (e.g. the terminal or
// tunnel WS servers) using a named-channel envelope, the same way other
// features multiplex over a shared connection. This is a settled decision,
// not a placeholder, so it should not need revisiting when plugin WS support
// is implemented.

import express, { type Request, type Response, type Router } from "express";
import { databaseLogger } from "../../utils/logger.js";

const router = express.Router();

const activePluginRouters = new Map<string, Router>();

/**
 * Called by the plugin runtime when a plugin activates. Replacing an existing
 * entry is normal: a crash-restart re-registers under the same id.
 */
export function registerPluginRouter(
  pluginId: string,
  pluginRouter: Router,
): void {
  activePluginRouters.set(pluginId, pluginRouter);
  databaseLogger.info("Registered plugin API router", {
    operation: "plugin_api_register",
    pluginId,
  });
}

export function unregisterPluginRouter(pluginId: string): void {
  if (!activePluginRouters.delete(pluginId)) return;
  databaseLogger.info("Unregistered plugin API router", {
    operation: "plugin_api_register",
    pluginId,
  });
}

export function getRegisteredPluginIds(): string[] {
  return [...activePluginRouters.keys()];
}

/**
 * @openapi
 * /plugin-api/{pluginId}/{path}:
 *   get:
 *     summary: Dispatch a request to an installed plugin's backend router
 *     description: >
 *       Forwards the request to the sub-router registered by the plugin with
 *       the given id. Returns 404 if the plugin is not installed or not
 *       currently running. All HTTP methods are dispatched the same way.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: pluginId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Response from the plugin's router.
 *       404:
 *         description: Plugin not installed or not running.
 */
router.use("/:pluginId", (req: Request, res: Response, next) => {
  const pluginId = String(req.params.pluginId);
  const pluginRouter = activePluginRouters.get(pluginId);

  if (!pluginRouter) {
    databaseLogger.warn("Plugin API request for unregistered plugin", {
      operation: "plugin_api_dispatch",
      pluginId,
    });
    res.status(404).json({ error: "Plugin not installed or not running" });
    return;
  }

  pluginRouter(req, res, next);
});

export default router;
