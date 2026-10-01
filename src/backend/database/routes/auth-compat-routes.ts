/**
 * The 2.8 login URLs clients built against 2.8 (Termix-Mobile) still call.
 * Each forwards to the login pipeline for the method it names, so none of
 * them can sign anyone in on its own. Old identity provider callbacks are
 * redirected by the owning plugin's manifest (contributes.http.legacyRedirects).
 */

import type { Router } from "express";
import { authLogger } from "../../utils/logger.js";
import {
  listLegacySsoProviders,
  startRedirectLogin,
  verifyFormLogin,
} from "./auth-routes.js";

export function registerAuthCompatRoutes(router: Router): void {
  /**
   * @openapi
   * /users/{method}/authorize:
   *   get:
   *     summary: Start a redirect login (2.8 route)
   *     description: Kept for 2.8 clients such as Termix-Mobile, which call /users/oidc/authorize. Same as /users/auth/{method}/start, with the provider in providerId.
   *     tags:
   *       - Auth
   *     parameters:
   *       - in: path
   *         name: method
   *         required: true
   *         schema:
   *           type: string
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
   *         description: That login method is not available.
   */
  router.get("/:method/authorize", (req, res) =>
    startRedirectLogin(
      req,
      res,
      String(req.params.method),
      typeof req.query.providerId === "string" && req.query.providerId
        ? req.query.providerId
        : null,
    ),
  );

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
   * /users/{method}/login:
   *   post:
   *     summary: Form login (2.8 route)
   *     description: Kept for 2.8 clients, which call /users/ldap/login. Same as /users/auth/{method}/verify, with the provider in providerId.
   *     tags:
   *       - Auth
   *     parameters:
   *       - in: path
   *         name: method
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Login successful, or a second factor is required.
   *       401:
   *         description: Invalid credentials.
   *       404:
   *         description: That login method is not available.
   */
  router.post("/:method/login", (req, res) =>
    verifyFormLogin(
      req,
      res,
      String(req.params.method),
      req.body?.providerId != null ? String(req.body.providerId) : null,
    ),
  );
}
