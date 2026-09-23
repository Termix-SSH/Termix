import type { Router } from "express";
import { verifyLdapLogin } from "../../auth/legacy/ldap-login.js";
import { respondWithLogin, sendLoginError } from "../../auth/login-pipeline.js";

export function registerLDAPAuthRoutes(router: Router): void {
  /**
   * @openapi
   * /users/ldap/login:
   *   post:
   *     summary: LDAP login
   *     description: Authenticates a user against an LDAP server, then runs the same second factors and session issuing as every other login.
   *     tags:
   *       - SSO
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               providerId:
   *                 type: integer
   *               username:
   *                 type: string
   *               password:
   *                 type: string
   *               rememberMe:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Login successful, or a second factor is required.
   *       400:
   *         description: Missing fields.
   *       401:
   *         description: Invalid credentials.
   *       403:
   *         description: User not allowed or registration disabled.
   *       404:
   *         description: Provider not found.
   *       429:
   *         description: Too many login attempts.
   */
  router.post("/ldap/login", async (req, res) => {
    try {
      const identity = await verifyLdapLogin({ body: req.body, ip: req.ip });
      await respondWithLogin(req, res, identity, {
        methodId: "ldap",
        rememberMe: !!req.body?.rememberMe,
      });
    } catch (error) {
      sendLoginError(res, error);
    }
  });
}
