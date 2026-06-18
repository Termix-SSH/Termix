import type {
  AuthenticatedRequest,
  OIDCProviderConfig,
} from "../../../types/index.js";
import type { Router } from "express";
import { db } from "../db/index.js";
import { ssoProviders } from "../db/schema.js";
import { eq, asc } from "drizzle-orm";
import { authLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import type { SSOProviderType } from "../../../types/index.js";
import { getOIDCConfigFromEnv } from "./user-oidc-utils.js";

const authManager = AuthManager.getInstance();

function decryptProviderConfig(
  configJson: string,
  _userId: string,
): Record<string, unknown> {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(configJson);
  } catch {
    return {};
  }

  for (const field of ["client_secret", "bindPassword"] as const) {
    const val = config[field] as string | undefined;
    if (val?.startsWith("encoded:")) {
      try {
        config[field] = Buffer.from(val.substring(8), "base64").toString(
          "utf8",
        );
      } catch {
        config[field] = "[ENCODING ERROR]";
      }
    }
  }
  return config;
}

function encryptProviderConfig(
  config: Record<string, unknown>,
  _userId: string,
  _providerId: string,
): string {
  const encoded: Record<string, unknown> = { ...config };
  if (
    typeof config.client_secret === "string" &&
    !config.client_secret.startsWith("encoded:")
  ) {
    encoded.client_secret = `encoded:${Buffer.from(config.client_secret).toString("base64")}`;
  }
  if (
    typeof config.bindPassword === "string" &&
    !config.bindPassword.startsWith("encoded:")
  ) {
    encoded.bindPassword = `encoded:${Buffer.from(config.bindPassword).toString("base64")}`;
  }
  return JSON.stringify(encoded);
}

function applyProviderDefaults(
  type: SSOProviderType,
  config: Partial<OIDCProviderConfig>,
): Partial<OIDCProviderConfig> {
  if (type === "github") {
    return {
      authorization_url: "https://github.com/login/oauth/authorize",
      token_url: "https://github.com/login/oauth/access_token",
      issuer_url: "https://github.com",
      identifier_path: "id",
      name_path: "name",
      scopes: "read:user user:email",
      userinfo_url: "https://api.github.com/user",
      ...config,
    };
  }
  if (type === "google") {
    return {
      authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
      token_url: "https://oauth2.googleapis.com/token",
      issuer_url: "https://accounts.google.com",
      identifier_path: "sub",
      name_path: "name",
      scopes: "openid email profile",
      ...config,
    };
  }
  return config;
}

export function registerSSOProviderRoutes(router: Router): void {
  const authenticateJWT = authManager.createAuthMiddleware();
  const requireAdmin = authManager.createAdminMiddleware();

  /**
   * @openapi
   * /users/sso-providers:
   *   get:
   *     summary: List enabled SSO providers (public)
   *     description: Returns public info for all enabled SSO providers for the login page.
   *     tags:
   *       - SSO
   *     responses:
   *       200:
   *         description: Array of public SSO provider objects.
   */
  router.get("/sso-providers", async (_req, res) => {
    try {
      const providers = await db
        .select({
          id: ssoProviders.id,
          name: ssoProviders.name,
          type: ssoProviders.type,
          displayOrder: ssoProviders.displayOrder,
        })
        .from(ssoProviders)
        .where(eq(ssoProviders.enabled, true))
        .orderBy(asc(ssoProviders.displayOrder), asc(ssoProviders.id));

      // If no DB providers exist, synthesize one from env vars so SSO login
      // remains available when configured purely via environment variables.
      if (providers.length === 0) {
        const envConfig = getOIDCConfigFromEnv();
        if (envConfig) {
          providers.push({ id: 0, name: "SSO", type: "oidc", displayOrder: 0 });
        }
      }

      res.json(providers);
    } catch (err) {
      authLogger.error("Failed to list SSO providers", err);
      res.status(500).json({ error: "Failed to list SSO providers" });
    }
  });

  /**
   * @openapi
   * /users/sso-providers/admin:
   *   get:
   *     summary: List all SSO providers (admin)
   *     description: Returns full SSO provider list with decrypted configs for the admin panel.
   *     tags:
   *       - SSO
   *     responses:
   *       200:
   *         description: Array of full SSO provider objects with decrypted config.
   */
  router.get("/sso-providers/admin", requireAdmin, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const rows = await db
        .select()
        .from(ssoProviders)
        .orderBy(asc(ssoProviders.displayOrder), asc(ssoProviders.id));

      const result = rows.map((row) => ({
        ...row,
        config: decryptProviderConfig(row.config, userId),
      }));
      res.json(result);
    } catch (err) {
      authLogger.error("Failed to list SSO providers (admin)", err);
      res.status(500).json({ error: "Failed to list SSO providers" });
    }
  });

  /**
   * @openapi
   * /users/sso-providers:
   *   post:
   *     summary: Create SSO provider
   *     description: Creates a new SSO provider configuration.
   *     tags:
   *       - SSO
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       201:
   *         description: Provider created.
   *       400:
   *         description: Validation error.
   */
  router.post("/sso-providers", requireAdmin, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const {
        name,
        type,
        enabled = true,
        displayOrder = 0,
        config: rawConfig = {},
      } = req.body as {
        name: string;
        type: SSOProviderType;
        enabled?: boolean;
        displayOrder?: number;
        config?: Record<string, unknown>;
      };

      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Provider name is required" });
      }
      const validTypes: SSOProviderType[] = [
        "oidc",
        "ldap",
        "github",
        "google",
      ];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: "Invalid provider type" });
      }

      const configWithDefaults =
        type === "github" || type === "google"
          ? applyProviderDefaults(
              type,
              rawConfig as Partial<OIDCProviderConfig>,
            )
          : rawConfig;

      if (type === "oidc" || type === "github" || type === "google") {
        const c = configWithDefaults as Partial<OIDCProviderConfig>;
        const missing = [
          "client_id",
          "client_secret",
          "issuer_url",
          "authorization_url",
          "token_url",
        ].filter((f) => !c[f as keyof OIDCProviderConfig]);
        if (missing.length > 0 && type === "oidc") {
          return res.status(400).json({
            error: `Missing required OIDC fields: ${missing.join(", ")}`,
          });
        }
        if (
          (type === "github" || type === "google") &&
          (!c.client_id || !c.client_secret)
        ) {
          return res
            .status(400)
            .json({ error: "Client ID and Client Secret are required" });
        }
      }

      if (type === "ldap") {
        const c = configWithDefaults as Record<string, unknown>;
        const missing = [
          "host",
          "port",
          "bindDN",
          "bindPassword",
          "userSearchBase",
          "userSearchFilter",
          "usernameAttribute",
        ].filter((f) => !c[f]);
        if (missing.length > 0) {
          return res.status(400).json({
            error: `Missing required LDAP fields: ${missing.join(", ")}`,
          });
        }
      }

      const tempId = `new-${Date.now()}`;
      const encryptedConfig = encryptProviderConfig(
        configWithDefaults as Record<string, unknown>,
        userId,
        tempId,
      );

      const [inserted] = await db
        .insert(ssoProviders)
        .values({
          name: name.trim(),
          type,
          enabled,
          displayOrder,
          config: encryptedConfig,
        })
        .returning();

      authLogger.info("SSO provider created", {
        operation: "sso_provider_create",
        userId,
        type,
        providerId: inserted.id,
      });
      res.status(201).json({
        ...inserted,
        config: decryptProviderConfig(inserted.config, userId),
      });
    } catch (err) {
      authLogger.error("Failed to create SSO provider", err);
      res.status(500).json({ error: "Failed to create SSO provider" });
    }
  });

  /**
   * @openapi
   * /users/sso-providers/{id}:
   *   put:
   *     summary: Update SSO provider
   *     description: Updates an existing SSO provider configuration.
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
   *       404:
   *         description: Provider not found.
   */
  router.put("/sso-providers/:id", requireAdmin, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const providerId = parseInt(req.params.id as string, 10);
    if (isNaN(providerId)) {
      return res.status(400).json({ error: "Invalid provider ID" });
    }
    try {
      const existing = await db
        .select()
        .from(ssoProviders)
        .where(eq(ssoProviders.id, providerId))
        .limit(1);
      if (existing.length === 0) {
        return res.status(404).json({ error: "SSO provider not found" });
      }

      const {
        name,
        type,
        enabled,
        displayOrder,
        config: rawConfig,
      } = req.body as {
        name?: string;
        type?: SSOProviderType;
        enabled?: boolean;
        displayOrder?: number;
        config?: Record<string, unknown>;
      };

      let encryptedConfig = existing[0].config;
      if (rawConfig !== undefined) {
        const existingDecrypted = decryptProviderConfig(
          existing[0].config,
          userId,
        );
        const mergedConfig = {
          ...JSON.parse(
            existingDecrypted ? JSON.stringify(existingDecrypted) : "{}",
          ),
          ...rawConfig,
        };
        encryptedConfig = encryptProviderConfig(
          mergedConfig,
          userId,
          String(providerId),
        );
      }

      const [updated] = await db
        .update(ssoProviders)
        .set({
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(type !== undefined ? { type } : {}),
          ...(enabled !== undefined ? { enabled } : {}),
          ...(displayOrder !== undefined ? { displayOrder } : {}),
          config: encryptedConfig,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(ssoProviders.id, providerId))
        .returning();

      authLogger.info("SSO provider updated", {
        operation: "sso_provider_update",
        userId,
        providerId,
      });
      res.json({
        ...updated,
        config: decryptProviderConfig(updated.config, userId),
      });
    } catch (err) {
      authLogger.error("Failed to update SSO provider", err);
      res.status(500).json({ error: "Failed to update SSO provider" });
    }
  });

  /**
   * @openapi
   * /users/sso-providers/{id}:
   *   delete:
   *     summary: Delete SSO provider
   *     description: Deletes an SSO provider. Blocked if users are associated.
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
   *       409:
   *         description: Users are associated with this provider.
   *       404:
   *         description: Provider not found.
   */
  router.delete("/sso-providers/:id", requireAdmin, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const providerId = parseInt(req.params.id as string, 10);
    if (isNaN(providerId)) {
      return res.status(400).json({ error: "Invalid provider ID" });
    }
    try {
      const existing = await db
        .select()
        .from(ssoProviders)
        .where(eq(ssoProviders.id, providerId))
        .limit(1);
      if (existing.length === 0) {
        return res.status(404).json({ error: "SSO provider not found" });
      }

      const associatedUsers = db.$client
        .prepare(
          "SELECT COUNT(*) as count FROM users WHERE sso_provider_id = ?",
        )
        .get(providerId) as { count: number };
      if (associatedUsers.count > 0) {
        return res.status(409).json({
          error: `Cannot delete provider: ${associatedUsers.count} user(s) are associated with it`,
        });
      }

      await db.delete(ssoProviders).where(eq(ssoProviders.id, providerId));
      authLogger.info("SSO provider deleted", {
        operation: "sso_provider_delete",
        userId,
        providerId,
      });
      res.json({ message: "SSO provider deleted" });
    } catch (err) {
      authLogger.error("Failed to delete SSO provider", err);
      res.status(500).json({ error: "Failed to delete SSO provider" });
    }
  });
}

export { decryptProviderConfig, encryptProviderConfig };
