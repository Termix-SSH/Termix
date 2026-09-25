/**
 * The 2.8 auth callback URLs something outside Termix still depends on: the
 * OPKSSH and Step CA redirect URIs registered with identity providers, and
 * the Vault one listed in Vault OIDC roles.
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

export function registerVaultCompatRoutes(router: Router): void {
  /**
   * @openapi
   * /vault/oidc/callback:
   *   get:
   *     summary: Vault OIDC callback (2.8 URL)
   *     description: The redirect URI Vault OIDC roles allowed before 2.9. Redirects to /plugin-api/vault/oidc/callback with the same query, so existing Vault roles keep working.
   *     tags:
   *       - Vault
   *     responses:
   *       307:
   *         description: Redirect to the vault plugin's callback.
   */
  router.get("/oidc/callback", (req, res) => {
    res.redirect(307, localUrl(req, "/plugin-api/vault/oidc/callback"));
  });
}

/**
 * The 2.8 Termix ID resolver URLs, which servers fetch from provisioning
 * scripts. Permanently redirected to the termix-identity plugin's public
 * resolver; curl -L follows them.
 */
export function registerTermixIdCompatRoutes(router: Router): void {
  /**
   * @openapi
   * /termix-id/u/{handle}:
   *   get:
   *     summary: Termix ID resolver (2.8 URL)
   *     description: Permanently redirects to /plugin-api/termix-identity/u/{handle}, and likewise for /termix-id/u/{handle}/{algo} and /termix-id/u/{handle}/ca, so servers provisioned with the old URL keep working.
   *     tags:
   *       - Termix ID
   *     parameters:
   *       - in: path
   *         name: handle
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       308:
   *         description: Redirect to the termix-identity plugin's resolver.
   */
  router.get(["/u/:handle", "/u/:handle/:algo"], (req, res) => {
    const rest = req.path.slice("/u".length);
    res.redirect(308, localUrl(req, `/plugin-api/termix-identity/u${rest}`));
  });
}
