/**
 * The 2.8 URLs under /host that something outside Termix still depends on:
 * the OPKSSH and Step CA redirect URIs registered with identity providers.
 * Each forwards to the plugin route that replaced it, so with the plugin off
 * it signs nobody in.
 */

import type { Request, Router } from "express";
import { getRequestBasePath } from "../../utils/request-origin.js";

/** A path on this install, keeping the query string. */
function localUrl(req: Request, path: string): string {
  const query = req.originalUrl.indexOf("?");
  return `${getRequestBasePath(req)}${path}${
    query >= 0 ? req.originalUrl.slice(query) : ""
  }`;
}

export function registerHostAuthCompatRoutes(router: Router): void {
  /**
   * @openapi
   * /host/opkssh-callback:
   *   get:
   *     summary: OPKSSH callback (2.8 URL)
   *     description: The redirect URI OPKSSH identity providers were set up with before 2.9. Redirects to /plugin-api/opkssh/callback with the same subpath and query, so existing provider configurations keep working.
   *     tags:
   *       - Auth
   *     responses:
   *       307:
   *         description: Redirect to the opkssh plugin's callback.
   */
  router.all(["/opkssh-callback", "/opkssh-callback/*rest"], (req, res) => {
    const rest = req.path.slice("/opkssh-callback".length);
    res.redirect(307, localUrl(req, `/plugin-api/opkssh/callback${rest}`));
  });

  /**
   * @openapi
   * /host/step-ca-callback:
   *   get:
   *     summary: Step CA callback (2.8 URL)
   *     description: The redirect URI Step CA identity providers were set up with before 2.9. Redirects to /plugin-api/step-ca/callback with the same query, so existing provider configurations keep working.
   *     tags:
   *       - Auth
   *     responses:
   *       307:
   *         description: Redirect to the step-ca plugin's callback.
   */
  router.get("/step-ca-callback", (req, res) => {
    res.redirect(307, localUrl(req, "/plugin-api/step-ca/callback"));
  });
}
