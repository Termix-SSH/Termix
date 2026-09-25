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
import { getRequestBasePath } from "../../utils/request-origin.js";
import type { PluginLegacyRedirect } from "@termix/plugin-sdk/manifest";

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

export interface ActiveLegacyRoutes {
  id: string;
  legacyPaths: string[];
  legacyRedirects: PluginLegacyRedirect[];
}

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Serves the old URLs plugins declare in contributes.http. A legacyPaths
 * entry, under "/<plugin id>/", runs through that plugin's router with the
 * prefix removed. A legacyRedirects entry redirects to the plugin's own URL,
 * keeping the rest of the path and the query. Mounted after every core route,
 * so core wins a clash.
 */
export function mountPluginLegacyPaths(
  app: express.Express,
  listActive: () => ActiveLegacyRoutes[],
): void {
  app.use((req: Request, res: Response, next) => {
    for (const plugin of listActive()) {
      const redirect = plugin.legacyRedirects.find((entry) =>
        under(req.path, entry.from),
      );
      if (redirect) {
        const rest = req.path.slice(redirect.from.length);
        const query = req.originalUrl.indexOf("?");
        res.redirect(
          redirect.status ?? 307,
          `${getRequestBasePath(req)}/plugin-api/${plugin.id}${redirect.to}${rest}${
            query >= 0 ? req.originalUrl.slice(query) : ""
          }`,
        );
        return;
      }
      if (!plugin.legacyPaths.some((path) => under(req.path, path))) continue;
      const pluginRouter = getPluginRouter(plugin.id);
      if (!pluginRouter) {
        res.status(404).json({ error: "Plugin not installed or not running" });
        return;
      }
      req.url = req.url.slice(plugin.id.length + 1) || "/";
      pluginRouter(req, res, next);
      return;
    }
    next();
  });
}

export default router;
