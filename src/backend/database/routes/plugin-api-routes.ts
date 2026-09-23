// Mounted at /plugin-api. Every plugin that serves HTTP registers a router
// through ctx.http.router(), and this dispatcher forwards requests to it by
// plugin id. The routers themselves live in src/backend/plugins/http.ts, which
// also owns the middleware stack in front of them: auth, the actor, the
// enabled check, body limits and the error wrapper.
//
// The dispatcher stays deliberately thin. It resolves a plugin id to a router
// and nothing else, so there is no place here for a check keyed on a
// particular plugin.
//
// WebSocket note: plugin sockets do NOT ride this router, and they do not get
// their own port either. They are served at /plugin-ws/<id>/<path> from the
// main server's upgrade event by src/backend/plugins/ws.ts. (An earlier
// comment here described a named-channel envelope multiplexed over the
// existing WS servers; A4 replaced that with the /plugin-ws prefix.)

import express, { type Request, type Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { getPluginRouter } from "../../plugins/http.js";

const router = express.Router();

/**
 * @openapi
 * /plugin-api/{pluginId}/{path}:
 *   get:
 *     summary: Dispatch a request to an installed plugin's backend router
 *     description: >
 *       Forwards the request to the router the plugin with the given id
 *       registered through ctx.http.router(). Returns 404 if the plugin is not
 *       installed or serves no routes, and 503 if it is installed but not
 *       currently running. All HTTP methods are dispatched the same way.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: path
 *         name: pluginId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Response from the plugin's router.
 *       401:
 *         description: Authentication required.
 *       404:
 *         description: Plugin not installed or serves no routes.
 *       503:
 *         description: Plugin is installed but not running.
 */
router.use("/:pluginId", (req: Request, res: Response, next) => {
  const pluginId = String(req.params.pluginId);
  const pluginRouter = getPluginRouter(pluginId);

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

/**
 * Mounts the dispatcher. No auth in front of it: each plugin router runs
 * core auth itself and skips it only for the paths it declared public, so a
 * webhook or OIDC callback a plugin serves can actually be reached.
 */
export function mountPluginApi(app: express.Express): void {
  app.use("/plugin-api", router);
}

export default router;
