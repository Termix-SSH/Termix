import type { Request, Response, Router } from "express";
import {
  LoginMethodError,
  type PluginContext,
} from "@termix/plugin-sdk/backend";
import {
  applyProviderDefaults,
  isValidOidcIssuer,
  validateLogoutToken,
} from "./oidc-protocol.js";
import { isSsoType, type ProviderStore } from "./providers.js";
import { METHOD_ID, redirectUriFor, type SsoLogin } from "./login.js";
import type { OidcConfig, ProviderRow, SsoProviderType } from "./types.js";

export const PUBLIC_PATHS = [
  "/start",
  "/callback",
  "/backchannel-logout",
  "/config",
];

const LOGOUT_JTI_TTL_MS = 5 * 60 * 1000;
const REQUIRED_OIDC_FIELDS = [
  "client_id",
  "client_secret",
  "issuer_url",
  "authorization_url",
  "token_url",
] as const;

function fail(
  ctx: PluginContext,
  res: Response,
  message: string,
  error: unknown,
) {
  ctx.log.error(
    message,
    error instanceof Error ? error : new Error(String(error)),
  );
  res.status(500).json({ error: message });
}

export function registerSsoRoutes(
  router: Router,
  ctx: PluginContext,
  store: ProviderStore,
  login: SsoLogin,
): void {
  // Replayed logout tokens are answered but not acted on twice.
  const seenLogoutJti = new Map<string, number>();

  async function present(req: Request, row: ProviderRow) {
    const config = await store.parseConfig(row.config);
    const { client_secret: secret, ...rest } = config;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      enabled: !!row.enabled,
      displayOrder: row.displayOrder,
      legacyCallback: !!row.legacyCallback,
      config: rest,
      hasClientSecret: typeof secret === "string" && secret.length > 0,
      redirectUri: redirectUriFor(ctx.http.baseUrl(req), {
        legacyCallback: !!row.legacyCallback,
      }),
    };
  }

  /** Checks a full provider config; returns the error to show, if any. */
  function validate(type: SsoProviderType, config: Partial<OidcConfig>) {
    if (type === "oidc") {
      const missing = REQUIRED_OIDC_FIELDS.filter((field) => !config[field]);
      if (missing.length > 0) {
        return `Missing required OIDC fields: ${missing.join(", ")}`;
      }
    } else if (!config.client_id || !config.client_secret) {
      return "Client ID and Client Secret are required";
    }
    if (config.issuer_url && !isValidOidcIssuer(config.issuer_url)) {
      return "Issuer URL must be an HTTP(S) issuer and not a userinfo endpoint";
    }
    return null;
  }

  /**
   * @openapi
   * /plugin-api/sso/start:
   *   get:
   *     summary: Start an SSO login in the browser
   *     description: Public. Sends the browser straight to the provider, so a link can start a login. The provider is picked by the provider query parameter, or the default one.
   *     tags:
   *       - SSO
   *     parameters:
   *       - in: query
   *         name: provider
   *         schema:
   *           type: string
   *     responses:
   *       302:
   *         description: Redirect to the identity provider.
   *       404:
   *         description: SSO is not configured.
   */
  router.get("/start", async (req: Request, res: Response) => {
    try {
      const instance =
        typeof req.query.provider === "string" ? req.query.provider : null;
      const { redirectUrl } = await login.start(req as never, instance);
      res.redirect(redirectUrl);
    } catch (error) {
      if (error instanceof LoginMethodError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      fail(ctx, res, "Failed to start SSO login", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/sso/callback:
   *   get:
   *     summary: SSO callback
   *     description: Public. The redirect URI to register with an identity provider. Exchanges the code and redirects back to the app with a session, a second-factor step or an error.
   *     tags:
   *       - SSO
   *     responses:
   *       302:
   *         description: Back to the app.
   *   post:
   *     summary: SSO callback (form post)
   *     description: Same as the GET form, for providers that post their answer.
   *     tags:
   *       - SSO
   *     responses:
   *       302:
   *         description: Back to the app.
   */
  const callback = (req: Request, res: Response) =>
    ctx.auth.completeRedirectLogin(METHOD_ID, req, res);
  router.get("/callback", callback);
  router.post("/callback", callback);

  /**
   * @openapi
   * /plugin-api/sso/backchannel-logout:
   *   post:
   *     summary: OIDC back-channel logout
   *     description: Public. Where an identity provider sends a signed logout token. Ends the Termix sessions that came from the matching provider login.
   *     tags:
   *       - SSO
   *     requestBody:
   *       required: true
   *       content:
   *         application/x-www-form-urlencoded:
   *           schema:
   *             type: object
   *             properties:
   *               logout_token:
   *                 type: string
   *     responses:
   *       200:
   *         description: Logout processed.
   *       400:
   *         description: Missing, invalid or unknown logout token.
   */
  router.post("/backchannel-logout", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const logoutToken = (req.body as Record<string, unknown> | undefined)
      ?.logout_token;
    if (typeof logoutToken !== "string" || !logoutToken) {
      res.status(400).json({ error: "missing logout_token" });
      return;
    }

    let issuer: string | null = null;
    try {
      const parts = logoutToken.split(".");
      if (parts.length === 3) {
        const claims = JSON.parse(Buffer.from(parts[1], "base64").toString());
        issuer = typeof claims.iss === "string" ? claims.iss : null;
      }
    } catch {
      issuer = null;
    }
    if (!issuer) {
      res.status(400).json({ error: "invalid logout_token" });
      return;
    }

    try {
      const provider = await store.resolveByIssuer(issuer);
      if (!provider) {
        ctx.log.warn(`Back-channel logout for unknown issuer ${issuer}`);
        res.status(400).json({ error: "unknown issuer" });
        return;
      }
      const claims = await validateLogoutToken(logoutToken, provider.config);

      const now = Date.now();
      for (const [key, expiry] of seenLogoutJti) {
        if (expiry <= now) seenLogoutJti.delete(key);
      }
      if (seenLogoutJti.has(claims.jti)) {
        res.status(200).json({ ok: true });
        return;
      }

      try {
        await ctx.auth.revokeSessions({
          providerId: provider.rowId,
          sub: claims.sub,
          sid: claims.sid,
        });
      } catch (error) {
        fail(ctx, res, "logout processing failed", error);
        return;
      }
      seenLogoutJti.set(claims.jti, now + LOGOUT_JTI_TTL_MS);
      res.status(200).json({ ok: true });
    } catch (error) {
      ctx.log.warn(`Back-channel logout failed: ${String(error)}`);
      res.status(400).json({ error: "invalid logout_token" });
    }
  });

  /**
   * @openapi
   * /plugin-api/sso/config:
   *   get:
   *     summary: Default provider's public configuration
   *     description: Public, for 2.8 clients. The client id, issuer, authorization URL and scopes of the default provider, or null.
   *     tags:
   *       - SSO
   *     responses:
   *       200:
   *         description: Public configuration, or null.
   */
  router.get("/config", async (_req: Request, res: Response) => {
    try {
      const provider = await store.resolve(null);
      if (!provider) {
        res.json(null);
        return;
      }
      const { config } = provider;
      res.json({
        client_id: config.client_id,
        issuer_url: config.issuer_url,
        authorization_url: config.authorization_url,
        scopes: config.scopes,
      });
    } catch (error) {
      fail(ctx, res, "Failed to get OIDC config", error);
    }
  });

  // Everything below manages providers.
  const manage = ctx.rbac.require("manage") as never;

  /**
   * @openapi
   * /plugin-api/sso/providers:
   *   get:
   *     summary: List SSO providers
   *     description: Every OIDC, GitHub and Google provider with its redirect URI. Secrets are never sent, only whether one is set. Needs sso.manage.
   *     tags:
   *       - SSO
   *     responses:
   *       200:
   *         description: Providers.
   *       403:
   *         description: Missing permission.
   */
  router.get("/providers", manage, async (req: Request, res: Response) => {
    try {
      const rows = await store.listRows();
      res.json({
        providers: await Promise.all(rows.map((row) => present(req, row))),
        newRedirectUri: redirectUriFor(ctx.http.baseUrl(req), {
          legacyCallback: false,
        }),
      });
    } catch (error) {
      fail(ctx, res, "Failed to list SSO providers", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/sso/providers:
   *   post:
   *     summary: Add an SSO provider
   *     description: Adds an OIDC, GitHub or Google provider. GitHub and Google fill in their own endpoints. Needs sso.manage.
   *     tags:
   *       - SSO
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               type:
   *                 type: string
   *                 enum: [oidc, github, google]
   *               enabled:
   *                 type: boolean
   *               config:
   *                 type: object
   *     responses:
   *       201:
   *         description: Provider added.
   *       400:
   *         description: Missing or invalid fields.
   *       403:
   *         description: Missing permission.
   */
  router.post("/providers", manage, async (req: Request, res: Response) => {
    try {
      const {
        name,
        type,
        enabled = true,
        displayOrder = 0,
        config = {},
      } = req.body ?? {};
      if (typeof name !== "string" || !name.trim()) {
        res.status(400).json({ error: "Provider name is required" });
        return;
      }
      if (!isSsoType(type)) {
        res.status(400).json({ error: "Invalid provider type" });
        return;
      }
      const full = applyProviderDefaults(config as OidcConfig, type);
      const invalid = validate(type, full);
      if (invalid) {
        res.status(400).json({ error: invalid });
        return;
      }
      const row = await store.create({
        name: name.trim(),
        type,
        enabled: !!enabled,
        displayOrder: Number(displayOrder) || 0,
        config: { ...(config as Record<string, unknown>) },
      });
      await ctx.audit.record({
        action: "sso_provider_create",
        resourceType: "sso_provider",
        resourceId: String(row.id),
        resourceName: row.name,
        success: true,
      });
      res.status(201).json(await present(req, row));
    } catch (error) {
      fail(ctx, res, "Failed to create SSO provider", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/sso/providers/{id}:
   *   put:
   *     summary: Update an SSO provider
   *     description: Changes a provider. Config fields are merged over the stored ones; an empty client secret keeps the stored secret. legacyCallback false moves it to the new redirect URI. Needs sso.manage.
   *     tags:
   *       - SSO
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Provider updated.
   *       400:
   *         description: Invalid fields.
   *       403:
   *         description: Missing permission.
   *       404:
   *         description: Provider not found.
   */
  router.put("/providers/:id", manage, async (req: Request, res: Response) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      const row = Number.isInteger(id) ? await store.findRow(id) : null;
      if (!row) {
        res.status(404).json({ error: "Provider not found" });
        return;
      }
      const { name, enabled, displayOrder, config, legacyCallback } =
        req.body ?? {};
      const values: Parameters<ProviderStore["update"]>[1] = {};
      if (name !== undefined) {
        if (typeof name !== "string" || !name.trim()) {
          res.status(400).json({ error: "Provider name is required" });
          return;
        }
        values.name = name.trim();
      }
      if (enabled !== undefined) values.enabled = !!enabled;
      if (displayOrder !== undefined) {
        values.displayOrder = Number(displayOrder) || 0;
      }
      if (legacyCallback !== undefined) {
        values.legacyCallback = !!legacyCallback;
      }
      if (config && typeof config === "object") {
        const incoming = { ...(config as Record<string, unknown>) };
        if (!incoming.client_secret) delete incoming.client_secret;
        const merged = {
          ...(await store.parseConfig(row.config)),
          ...incoming,
        };
        const invalid = validate(
          row.type as SsoProviderType,
          applyProviderDefaults(merged as unknown as OidcConfig, row.type),
        );
        if (invalid) {
          res.status(400).json({ error: invalid });
          return;
        }
        values.config = merged;
      }
      const updated = await store.update(id, values);
      await ctx.audit.record({
        action: "sso_provider_update",
        resourceType: "sso_provider",
        resourceId: String(id),
        resourceName: updated?.name ?? row.name,
        success: true,
      });
      res.json(await present(req, updated ?? row));
    } catch (error) {
      fail(ctx, res, "Failed to update SSO provider", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/sso/providers/{id}:
   *   delete:
   *     summary: Delete an SSO provider
   *     description: Refused while users still sign in with it. Needs sso.manage.
   *     tags:
   *       - SSO
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Provider deleted.
   *       403:
   *         description: Missing permission.
   *       404:
   *         description: Provider not found.
   *       409:
   *         description: Users are still linked to it.
   */
  router.delete(
    "/providers/:id",
    manage,
    async (req: Request, res: Response) => {
      try {
        const id = Number.parseInt(String(req.params.id), 10);
        const row = Number.isInteger(id) ? await store.findRow(id) : null;
        if (!row) {
          res.status(404).json({ error: "Provider not found" });
          return;
        }
        if ((await ctx.auth.countLinkedUsers(String(id))) > 0) {
          res.status(409).json({
            error:
              "Users still sign in with this provider. Disable it instead, or remove those users first.",
          });
          return;
        }
        await store.remove(id);
        await ctx.audit.record({
          action: "sso_provider_delete",
          resourceType: "sso_provider",
          resourceId: String(id),
          resourceName: row.name,
          success: true,
        });
        res.json({ message: "SSO provider deleted" });
      } catch (error) {
        fail(ctx, res, "Failed to delete SSO provider", error);
      }
    },
  );
}
