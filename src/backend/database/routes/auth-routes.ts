/**
 * The generic login surface: every registered login method and second factor
 * is reachable here, core's and plugins' alike. The older per-method routes
 * (/users/login, /users/oidc/*, /users/ldap/login, ...) stay as thin wrappers
 * so existing clients keep working.
 */

import type { Request, Response, Router } from "express";
import { authLogger } from "../../utils/logger.js";
import { isOidcTokenCallback } from "../../utils/oidc-desktop-callback.js";
import { ensureCoreLoginProviders } from "../../auth/core-auth.js";
import {
  readPendingLogin,
  redirectWithLoginError,
  respondWithLogin,
  respondWithRedirectLogin,
  sendLoginError,
  verifySecondFactorAndRespond,
  evaluateSecondFactors,
} from "../../auth/login-pipeline.js";
import {
  getLoginMethod,
  listLoginMethods,
  type LoginMethod,
} from "../../auth/registry.js";
import { isTrustedProxyAuthEnabled } from "../../utils/trusted-proxy-auth.js";
import { LoginMethodError, type VerifiedIdentity } from "../../auth/types.js";

export interface PublicLoginMethod {
  id: string;
  pluginId: string;
  kind: "redirect" | "form";
  labelKey: string;
  icon?: string;
  instances: Array<{ id: string; label: string }>;
}

async function enabledInstances(method: LoginMethod) {
  return (await method.describe!()).filter((instance) => instance.enabled);
}

/** External methods with at least one enabled instance. */
export async function listExternalLoginMethods(): Promise<LoginMethod[]> {
  ensureCoreLoginProviders();
  const found: LoginMethod[] = [];
  for (const method of listLoginMethods()) {
    if (!method.external) continue;
    if (!method.describe) {
      found.push(method);
      continue;
    }
    try {
      if ((await enabledInstances(method)).length > 0) found.push(method);
    } catch {
      // A method that cannot describe itself signs nobody in.
    }
  }
  return found;
}

/** The 2.8 `GET /users/sso-providers` shape, built from external methods. */
export async function listLegacySsoProviders(): Promise<
  Array<{
    id: number | string;
    name: string;
    type: string;
    displayOrder: number;
  }>
> {
  const providers: Array<{
    id: number | string;
    name: string;
    type: string;
    displayOrder: number;
  }> = [];
  for (const method of await listExternalLoginMethods()) {
    if (!method.describe) continue;
    for (const instance of await enabledInstances(method)) {
      const numeric = Number(instance.id);
      providers.push({
        id: Number.isInteger(numeric) ? numeric : instance.id,
        name: instance.label,
        type: instance.type ?? method.id,
        displayOrder: providers.length,
      });
    }
  }
  return providers;
}

/** What the login screen may know: ids, labels and enabled instances. */
export async function listPublicLoginMethods(): Promise<PublicLoginMethod[]> {
  ensureCoreLoginProviders();
  const methods: PublicLoginMethod[] = [];
  for (const method of listLoginMethods()) {
    let instances: Array<{ id: string; label: string }> = [];
    if (method.describe) {
      try {
        instances = (await method.describe())
          .filter((instance) => instance.enabled)
          .map((instance) => ({ id: instance.id, label: instance.label }));
      } catch (error) {
        authLogger.warn("Login method could not describe itself", {
          operation: "login_method_describe",
          methodId: method.id,
          error,
        });
        continue;
      }
      if (instances.length === 0) continue;
    }
    methods.push({
      id: method.id,
      pluginId: method.pluginId,
      kind: method.kind,
      labelKey: method.labelKey,
      icon: method.icon,
      instances,
    });
  }
  return methods;
}

function instanceParam(req: Request): string | null {
  const value = req.query.instance ?? req.body?.instanceId;
  return typeof value === "string" && value ? value : null;
}

/**
 * Trusted proxy login and external methods don't mix: the proxy already
 * decided who the user is.
 */
function refusedByTrustedProxy(method: LoginMethod, res: Response): boolean {
  if (!method.external || !isTrustedProxyAuthEnabled()) return false;
  res.status(409).json({
    error:
      "External login is disabled while trusted proxy authentication is enabled",
  });
  return true;
}

function methodOr404(req: Request, res: Response, id?: string) {
  ensureCoreLoginProviders();
  const method = getLoginMethod(id ?? String(req.params.methodId));
  if (!method) {
    res.status(404).json({ error: "Unknown login method" });
    return null;
  }
  if (refusedByTrustedProxy(method, res)) return null;
  return method;
}

/**
 * A redirect method's callback, for core's route and for a plugin's own
 * public route through ctx.auth.completeRedirectLogin.
 */
export async function handleRedirectCallback(
  method: LoginMethod,
  req: Request,
  res: Response,
): Promise<void> {
  if (refusedByTrustedProxy(method, res)) return;
  if (!method.callback) {
    res.status(400).json({ error: "Not a redirect login method" });
    return;
  }
  let identity: VerifiedIdentity;
  try {
    identity = await method.callback(req as never);
  } catch (error) {
    const returnTo = (error as { returnTo?: string }).returnTo;
    if (returnTo) return redirectWithLoginError(res, returnTo, error);
    sendLoginError(res, error);
    return;
  }
  await respondWithRedirectLogin(
    req,
    res,
    identity,
    { methodId: method.id, rememberMe: !!identity.rememberMe },
    isOidcTokenCallback,
  );
}

/** Starts a redirect method, answering with its URL. */
export async function startRedirectLogin(
  req: Request,
  res: Response,
  methodId: string,
  instanceId: string | null,
): Promise<void> {
  const method = methodOr404(req, res, methodId);
  if (!method) return;
  if (method.kind !== "redirect" || !method.start) {
    res.status(400).json({ error: "Not a redirect login method" });
    return;
  }
  try {
    const result = await method.start(req as never, instanceId);
    // auth_url is the name 2.8 clients read.
    res.json({ ...result, auth_url: result.redirectUrl });
  } catch (error) {
    sendLoginError(res, error);
  }
}

/** Runs a form method and answers with a session or a second-factor step. */
export async function verifyFormLogin(
  req: Request,
  res: Response,
  methodId: string,
  instanceId: string | null,
): Promise<void> {
  const method = methodOr404(req, res, methodId);
  if (!method) return;
  if (method.kind !== "form" || !method.verify) {
    res.status(400).json({ error: "Not a form login method" });
    return;
  }
  try {
    const identity = await method.verify(req as never, instanceId);
    await respondWithLogin(req, res, identity, {
      methodId: method.id,
      rememberMe: !!identity.rememberMe || !!req.body?.rememberMe,
    });
  } catch (error) {
    if (!(error instanceof LoginMethodError)) {
      authLogger.error("Form login failed", error, { methodId: method.id });
    }
    sendLoginError(res, error);
  }
}

export function registerAuthRoutes(router: Router): void {
  /**
   * @openapi
   * /users/auth/methods:
   *   get:
   *     summary: List login methods
   *     description: Public. The login methods with at least one enabled instance, for the login screen. Carries ids and labels only.
   *     tags:
   *       - Auth
   *     responses:
   *       200:
   *         description: Login methods.
   */
  router.get("/auth/methods", async (_req, res) => {
    try {
      res.json({ methods: await listPublicLoginMethods() });
    } catch (error) {
      authLogger.error("Failed to list login methods", error);
      res.status(500).json({ error: "Failed to list login methods" });
    }
  });

  /**
   * @openapi
   * /users/auth/second-factor/{factorId}/challenge:
   *   post:
   *     summary: Start a second factor
   *     description: Returns whatever the factor needs the client to have before the user answers, for a login waiting on a second factor.
   *     tags:
   *       - Auth
   *     parameters:
   *       - in: path
   *         name: factorId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Challenge data.
   *       401:
   *         description: No pending login.
   *       404:
   *         description: Factor not enabled for this user.
   */
  router.post("/auth/second-factor/:factorId/challenge", async (req, res) => {
    try {
      const lookup = await readPendingLogin(req);
      if (!lookup) {
        return res.status(401).json({ error: "Invalid temporary token" });
      }
      const { required } = await evaluateSecondFactors(lookup.userId);
      const factor = required.find(
        (candidate) => candidate.id === req.params.factorId,
      );
      if (!factor) {
        return res.status(404).json({ error: "Second factor not enabled" });
      }
      res.json({
        challenge: (await factor.challenge?.(lookup.userId)) ?? null,
      });
    } catch (error) {
      sendLoginError(res, error);
    }
  });

  /**
   * @openapi
   * /users/auth/second-factor/{factorId}/verify:
   *   post:
   *     summary: Finish a second factor
   *     description: Checks the user's answer for a login waiting on a second factor and issues the session. The pending token comes from temp_token in the body or the pending-login cookie.
   *     tags:
   *       - Auth
   *     parameters:
   *       - in: path
   *         name: factorId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Login successful.
   *       401:
   *         description: Wrong answer or no pending login.
   *       403:
   *         description: An enrolled factor is unavailable.
   *       429:
   *         description: Too many attempts.
   */
  router.post("/auth/second-factor/:factorId/verify", async (req, res) => {
    try {
      await verifySecondFactorAndRespond(req, res, String(req.params.factorId));
    } catch (error) {
      sendLoginError(res, error);
    }
  });

  /**
   * @openapi
   * /users/totp/verify-login:
   *   post:
   *     summary: Finish a login with a second factor (2.8 route)
   *     description: Kept for clients built against 2.8, such as Termix-Mobile. Verifies the pending login against the factor named in `factor`, or the user's first enrolled factor, the same way as /users/auth/second-factor/{factorId}/verify.
   *     tags:
   *       - Auth
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               temp_token:
   *                 type: string
   *               totp_code:
   *                 type: string
   *               factor:
   *                 type: string
   *     responses:
   *       200:
   *         description: Login finished.
   *       400:
   *         description: Token and code are required.
   *       401:
   *         description: Invalid temporary token or code.
   */
  router.post("/totp/verify-login", async (req, res) => {
    if (!req.body?.temp_token || !req.body?.totp_code) {
      return res.status(400).json({ error: "Token and code are required" });
    }
    try {
      await verifySecondFactorAndRespond(
        req,
        res,
        typeof req.body.factor === "string" ? req.body.factor : undefined,
      );
    } catch (error) {
      sendLoginError(res, error);
    }
  });

  /**
   * @openapi
   * /users/auth/{methodId}/start:
   *   get:
   *     summary: Start a redirect login
   *     description: Returns the URL to send the browser to for a redirect login method, such as an SSO provider.
   *     tags:
   *       - Auth
   *     parameters:
   *       - in: path
   *         name: methodId
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: instance
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Redirect URL.
   *       404:
   *         description: Unknown login method.
   */
  router.get("/auth/:methodId/start", (req, res) =>
    startRedirectLogin(
      req,
      res,
      String(req.params.methodId),
      instanceParam(req),
    ),
  );

  const callback = async (req: Request, res: Response) => {
    const method = methodOr404(req, res);
    if (!method) return;
    await handleRedirectCallback(method, req, res);
  };

  /**
   * @openapi
   * /users/auth/{methodId}/callback:
   *   get:
   *     summary: Redirect login callback
   *     description: Where a redirect login method's provider sends the browser back. Redirects to the app with a session, a second-factor step, or an error.
   *     tags:
   *       - Auth
   *     parameters:
   *       - in: path
   *         name: methodId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       302:
   *         description: Back to the app.
   *   post:
   *     summary: Redirect login callback (form post)
   *     description: Same as the GET form, for providers that post their answer.
   *     tags:
   *       - Auth
   *     parameters:
   *       - in: path
   *         name: methodId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       302:
   *         description: Back to the app.
   */
  router.get("/auth/:methodId/callback", callback);
  router.post("/auth/:methodId/callback", callback);

  /**
   * @openapi
   * /users/auth/{methodId}/verify:
   *   post:
   *     summary: Form login
   *     description: Checks what the user typed for a form login method, then issues a session or asks for a second factor.
   *     tags:
   *       - Auth
   *     parameters:
   *       - in: path
   *         name: methodId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Login successful, or a second factor is required.
   *       401:
   *         description: Wrong credentials.
   *       404:
   *         description: Unknown login method.
   */
  router.post("/auth/:methodId/verify", (req, res) =>
    verifyFormLogin(req, res, String(req.params.methodId), instanceParam(req)),
  );
}
