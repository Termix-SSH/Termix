// Mounted at /plugin-api. Every installed plugin that exposes backend routes
// registers a sub-router here under its own plugin id, and this dispatcher
// forwards matching requests to it. Nothing registers yet, this only proves
// the path resolves end to end (nginx -> Express -> 404) ahead of the plugin
// loader landing.
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
