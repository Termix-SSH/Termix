/**
 * The 2.8 login URLs that something outside Termix still depends on:
 * identity providers configured with the old callback and back-channel
 * logout URLs, and clients built against 2.8 such as Termix-Mobile. Each one
 * forwards to the login method or plugin route that replaced it, so none of
 * them can sign anyone in on its own.
 */

import type { Request, Router } from "express";
import { authLogger } from "../../utils/logger.js";
import { getRequestBasePath } from "../../utils/request-origin.js";
import {
  listLegacySsoProviders,
  startRedirectLogin,
  verifyFormLogin,
} from "./auth-routes.js";

/**
 * A path on this install, keeping the query string. Relative, so the browser
 * stays on the scheme and host it used, whatever a proxy told us.
 */
function pluginUrl(req: Request, path: string): string {
  const query = req.originalUrl.indexOf("?");
  return `${getRequestBasePath(req)}${path}${
    query >= 0 ? req.originalUrl.slice(query) : ""
  }`;
}

export function registerAuthCompatRoutes(router: Router): void {
  /**
   * @openapi
   * /users/oidc-config:
   *   get:
   *     summary: Get the default SSO provider's public configuration (2.8 route)
   *     description: Kept for 2.8 clients. Redirects to the sso plugin's /plugin-api/sso/config.
   *     tags:
   *       - Auth
   *     responses:
   *       307:
   *         description: Redirect to the sso plugin.
   */
  router.get("/oidc-config", (req, res) => {
    res.redirect(307, pluginUrl(req, "/plugin-api/sso/config"));
  });

  /**
   * @openapi
   * /users/oidc/authorize:
   *   get:
   *     summary: Start an SSO login (2.8 route)
   *     description: Kept for 2.8 clients such as Termix-Mobile. Same as /users/auth/oidc/start, with the provider in providerId.
   *     tags:
   *       - Auth
   *     parameters:
   *       - in: query
   *         name: providerId
   *         schema:
   *           type: string
   *       - in: query
   *         name: rememberMe
   *         schema:
   *           type: boolean
   *     responses:
   *       200:
   *         description: The authorization URL in auth_url.
   *       404:
   *         description: SSO is not available.
   */
  router.get("/oidc/authorize", (req, res) =>
    startRedirectLogin(
      req,
      res,
      "oidc",
      typeof req.query.providerId === "string" && req.query.providerId
        ? req.query.providerId
        : null,
    ),
  );

  /**
   * @openapi
   * /users/oidc/callback:
   *   get:
   *     summary: SSO callback (2.8 URL)
   *     description: The redirect URI identity providers were set up with before 2.9. Permanently redirects to /plugin-api/sso/callback with the same query, so existing provider configurations keep working.
   *     tags:
   *       - Auth
   *     responses:
   *       308:
   *         description: Redirect to the sso plugin's callback.
   *   post:
   *     summary: SSO callback, form post (2.8 URL)
   *     description: Same as the GET form.
   *     tags:
   *       - Auth
   *     responses:
   *       308:
   *         description: Redirect to the sso plugin's callback.
   */
  router.all("/oidc/callback", (req, res) => {
    res.redirect(308, pluginUrl(req, "/plugin-api/sso/callback"));
  });

  /**
   * @openapi
   * /users/oidc/backchannel-logout:
   *   post:
   *     summary: OIDC back-channel logout (2.8 URL)
   *     description: Permanently redirects to /plugin-api/sso/backchannel-logout, so identity providers set up before 2.9 keep working.
   *     tags:
   *       - Auth
   *     responses:
   *       308:
   *         description: Redirect to the sso plugin.
   */
  router.post("/oidc/backchannel-logout", (req, res) => {
    res.redirect(308, pluginUrl(req, "/plugin-api/sso/backchannel-logout"));
  });

  /**
   * @openapi
   * /users/sso-providers:
   *   get:
   *     summary: List sign-in providers (2.8 route)
   *     description: Kept for 2.8 clients. Every enabled instance of every external login method, in the 2.8 shape. /users/auth/methods is the current route.
   *     tags:
   *       - Auth
   *     responses:
   *       200:
   *         description: Providers.
   */
  router.get("/sso-providers", async (_req, res) => {
    try {
      res.json(await listLegacySsoProviders());
    } catch (error) {
      authLogger.error("Failed to list SSO providers", error);
      res.status(500).json({ error: "Failed to list SSO providers" });
    }
  });

  /**
   * @openapi
   * /users/ldap/login:
   *   post:
   *     summary: LDAP login (2.8 route)
   *     description: Kept for 2.8 clients. Same as /users/auth/ldap/verify, with the provider in providerId.
   *     tags:
   *       - Auth
   *     responses:
   *       200:
   *         description: Login successful, or a second factor is required.
   *       401:
   *         description: Invalid credentials.
   *       404:
   *         description: LDAP is not available.
   */
  router.post("/ldap/login", (req, res) =>
    verifyFormLogin(
      req,
      res,
      "ldap",
      req.body?.providerId != null ? String(req.body.providerId) : null,
    ),
  );
}
