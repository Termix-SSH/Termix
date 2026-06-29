import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import { users, settings, roles, userRoles } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import type { Request, Response } from "express";
import { authLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import {
  parseUserAgent,
  generateDeviceFingerprint,
} from "../../utils/user-agent-parser.js";
import { loginRateLimiter } from "../../utils/login-rate-limiter.js";
import {
  getRequestBasePath,
  getRequestBaseUrlWithForceHTTPS,
} from "../../utils/request-origin.js";
import { deleteUserAndRelatedData } from "./delete-user-data.js";
import {
  getOIDCConfigFromEnv,
  isOIDCUserAllowed,
  verifyOIDCToken,
  extractOidcGroups,
  loadProviderConfig,
  buildFetchOptions,
} from "./user-oidc-utils.js";
import { registerUserApiKeyRoutes } from "./user-api-key-routes.js";
import { registerUserSettingsRoutes } from "./user-settings-routes.js";
import { registerAcmeSSLRoutes } from "./acme-ssl-routes.js";
import { registerUserTotpRoutes } from "./user-totp-routes.js";
import { registerUserSessionRoutes } from "./user-session-routes.js";
import { registerUserOidcAccountRoutes } from "./user-oidc-account-routes.js";
import { registerUserPasswordResetRoutes } from "./user-password-reset-routes.js";
import { registerUserAdminRoutes } from "./user-admin-routes.js";
import { registerUserDataAccessRoutes } from "./user-data-access-routes.js";
import { registerUserWebAuthnRoutes } from "./user-webauthn-routes.js";
import { registerSSOProviderRoutes } from "./sso-provider-routes.js";
import { registerLDAPAuthRoutes } from "./ldap-auth-routes.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";

const authManager = AuthManager.getInstance();

const router = express.Router();

async function syncSharedCredentialsForUserRoles(
  userId: string,
  operation: string,
) {
  try {
    const { SharedCredentialManager } =
      await import("../../utils/shared-credential-manager.js");
    const sharedCredManager = SharedCredentialManager.getInstance();
    await sharedCredManager.createSharedCredentialsForUserRoles(userId);
    await sharedCredManager.reEncryptPendingCredentialsForUser(userId);
  } catch (error) {
    authLogger.warn("Failed to sync role shared credentials", {
      operation,
      userId,
      error,
    });
  }
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

function isRegistrationAllowed(): boolean {
  const envVal = process.env.ALLOW_REGISTRATION;
  if (envVal !== undefined) return envVal.trim().toLowerCase() === "true";
  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'allow_registration'")
      .get() as { value: string } | undefined;
    return row ? row.value === "true" : true;
  } catch {
    return true;
  }
}

function isPasswordLoginAllowed(): boolean {
  const envVal = process.env.ALLOW_PASSWORD_LOGIN;
  if (envVal !== undefined) return envVal.trim().toLowerCase() === "true";
  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'allow_password_login'")
      .get() as { value: string } | undefined;
    return row ? row.value === "true" : true;
  } catch {
    return true;
  }
}

function isPasswordResetAllowed(): boolean {
  const envVal = process.env.ALLOW_PASSWORD_RESET;
  if (envVal !== undefined) return envVal.trim().toLowerCase() === "true";
  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'allow_password_reset'")
      .get() as { value: string } | undefined;
    return row ? row.value === "true" : true;
  } catch {
    return true;
  }
}

function isNativeAppRequest(req: Request): boolean {
  return (
    (req.get("User-Agent") || "").startsWith("Termix-Mobile/") ||
    req.get("X-Electron-App") === "true"
  );
}

const authenticateJWT = authManager.createAuthMiddleware();
const requireAdmin = authManager.createAdminMiddleware();

/**
 * @openapi
 * /users/create:
 *   post:
 *     summary: Create a new user
 *     description: Creates a new user with a username and password.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: User created successfully.
 *       400:
 *         description: Username and password are required.
 *       403:
 *         description: Registration is currently disabled.
 *       409:
 *         description: Username already exists.
 *       500:
 *         description: Failed to create user.
 */
router.post("/create", async (req, res) => {
  if (!isRegistrationAllowed()) {
    return res
      .status(403)
      .json({ error: "Registration is currently disabled" });
  }

  const { username, password } = req.body;
  authLogger.info("User registration attempt", {
    operation: "user_register_attempt",
    username,
  });

  if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
    authLogger.warn(
      "Invalid user creation attempt - missing username or password",
      {
        operation: "user_create",
        hasUsername: !!username,
        hasPassword: !!password,
      },
    );
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  try {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    if (existing && existing.length > 0) {
      authLogger.warn("Registration failed - username exists", {
        operation: "user_register_failed",
        username,
        reason: "username_exists",
      });
      return res.status(409).json({ error: "Username already exists" });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const id = nanoid();

    const isFirstUser = db.$client.transaction(() => {
      const countResult = db.$client
        .prepare("SELECT COUNT(*) as count FROM users")
        .get() as { count?: number };
      const first = (countResult?.count || 0) === 0;
      db.$client
        .prepare(
          "INSERT INTO users (id, username, password_hash, is_admin, is_oidc, client_id, client_secret, issuer_url, authorization_url, token_url, identifier_path, name_path, scopes, totp_secret, totp_enabled, totp_backup_codes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          username,
          password_hash,
          first ? 1 : 0,
          0,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "openid email profile",
          null,
          0,
          null,
        );
      return first;
    })();

    try {
      const defaultRoleName = isFirstUser ? "admin" : "user";
      const defaultRole = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, defaultRoleName))
        .limit(1);

      if (defaultRole.length > 0) {
        await db.insert(userRoles).values({
          userId: id,
          roleId: defaultRole[0].id,
          grantedBy: id,
        });
      } else {
        authLogger.warn("Default role not found during user registration", {
          operation: "assign_default_role",
          userId: id,
          roleName: defaultRoleName,
        });
      }
    } catch (roleError) {
      authLogger.error("Failed to assign default role", roleError, {
        operation: "assign_default_role",
        userId: id,
      });
    }

    try {
      await authManager.registerUser(id, password);
    } catch (encryptionError) {
      await db.delete(users).where(eq(users.id, id));
      authLogger.error(
        "Failed to setup user encryption, user creation rolled back",
        encryptionError,
        {
          operation: "user_create_encryption_failed",
          userId: id,
        },
      );
      return res.status(500).json({
        error: "Failed to setup user security - user creation cancelled",
      });
    }

    try {
      const { saveMemoryDatabaseToFile } = await import("../db/index.js");
      await saveMemoryDatabaseToFile();
    } catch (saveError) {
      authLogger.error("Failed to persist user to disk", saveError, {
        operation: "user_create_save_failed",
        userId: id,
      });
    }

    authLogger.success("User registration successful", {
      operation: "user_register_success",
      userId: id,
      username,
      isAdmin: isFirstUser,
    });

    const { ipAddress, userAgent } = getRequestMeta(req);
    await logAudit({
      userId: id,
      username,
      action: "create_user",
      resourceType: "user",
      resourceId: id,
      resourceName: username,
      ipAddress,
      userAgent,
      success: true,
    });

    res.json({
      message: "User created",
      is_admin: isFirstUser,
      toast: { type: "success", message: `User created: ${username}` },
    });
  } catch (err) {
    authLogger.error("Failed to create user", err);
    res.status(500).json({ error: "Failed to create user" });
  }
});

/**
 * @openapi
 * /users/oidc-config:
 *   post:
 *     summary: Configure OIDC provider
 *     description: Creates or updates the OIDC provider configuration.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: OIDC configuration updated.
 *       403:
 *         description: Not authorized.
 *       500:
 *         description: Failed to update OIDC config.
 */
router.post("/oidc-config", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0 || !user[0].isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const {
      client_id,
      client_secret,
      issuer_url,
      authorization_url,
      token_url,
      userinfo_url,
      identifier_path,
      name_path,
      scopes,
      allowed_users,
      admin_group,
      group_claim,
    } = req.body;

    const isDisableRequest =
      (client_id === "" || client_id === null || client_id === undefined) &&
      (client_secret === "" ||
        client_secret === null ||
        client_secret === undefined) &&
      (issuer_url === "" || issuer_url === null || issuer_url === undefined) &&
      (authorization_url === "" ||
        authorization_url === null ||
        authorization_url === undefined) &&
      (token_url === "" || token_url === null || token_url === undefined);

    const isEnableRequest =
      isNonEmptyString(client_id) &&
      isNonEmptyString(client_secret) &&
      isNonEmptyString(issuer_url) &&
      isNonEmptyString(authorization_url) &&
      isNonEmptyString(token_url) &&
      isNonEmptyString(identifier_path) &&
      isNonEmptyString(name_path);

    if (!isDisableRequest && !isEnableRequest) {
      authLogger.warn(
        "OIDC validation failed - neither disable nor enable request",
        {
          operation: "oidc_config_update",
          userId,
          isDisableRequest,
          isEnableRequest,
        },
      );
      return res
        .status(400)
        .json({ error: "All OIDC configuration fields are required" });
    }

    if (isDisableRequest) {
      db.$client
        .prepare("DELETE FROM settings WHERE key = 'oidc_config'")
        .run();
      authLogger.info("OIDC configuration disabled", {
        operation: "oidc_disable",
        userId,
      });
      res.json({ message: "OIDC configuration disabled" });
    } else {
      const config = {
        client_id,
        client_secret,
        issuer_url,
        authorization_url,
        token_url,
        userinfo_url: userinfo_url || "",
        identifier_path,
        name_path,
        scopes: scopes || "openid email profile",
        allowed_users: allowed_users || "",
        admin_group: admin_group || "",
        group_claim: group_claim || "",
      };

      let encryptedConfig;
      try {
        const adminDataKey = DataCrypto.getUserDataKey(userId);
        if (adminDataKey) {
          const configWithId = { ...config, id: `oidc-config-${userId}` };
          encryptedConfig = DataCrypto.encryptRecord(
            "settings",
            configWithId,
            userId,
            adminDataKey,
          );
        } else {
          encryptedConfig = {
            ...config,
            client_secret: `encrypted:${Buffer.from(client_secret).toString("base64")}`,
          };
          authLogger.warn(
            "OIDC configuration stored with basic encoding - admin should re-save with password",
            {
              operation: "oidc_config_basic_encoding",
              userId,
            },
          );
        }
      } catch (encryptError) {
        authLogger.error(
          "Failed to encrypt OIDC configuration, storing with basic encoding",
          encryptError,
          {
            operation: "oidc_config_encrypt_failed",
            userId,
          },
        );
        encryptedConfig = {
          ...config,
          client_secret: `encoded:${Buffer.from(client_secret).toString("base64")}`,
        };
      }

      db.$client
        .prepare(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('oidc_config', ?)",
        )
        .run(JSON.stringify(encryptedConfig));
      authLogger.info("OIDC configuration updated", {
        operation: "oidc_update",
        userId,
        hasUserinfoUrl: !!userinfo_url,
      });
      res.json({ message: "OIDC configuration updated" });
    }
  } catch (err) {
    authLogger.error("Failed to update OIDC config", err);
    res.status(500).json({ error: "Failed to update OIDC config" });
  }
});

/**
 * @openapi
 * /users/oidc-config:
 *   delete:
 *     summary: Disable OIDC configuration
 *     description: Disables the OIDC provider configuration.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: OIDC configuration disabled.
 *       403:
 *         description: Not authorized.
 *       500:
 *         description: Failed to disable OIDC config.
 */
router.delete("/oidc-config", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0 || !user[0].isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }

    db.$client.prepare("DELETE FROM settings WHERE key = 'oidc_config'").run();
    authLogger.success("OIDC configuration disabled", {
      operation: "oidc_disable",
      userId,
    });
    res.json({ message: "OIDC configuration disabled" });
  } catch (err) {
    authLogger.error("Failed to disable OIDC config", err);
    res.status(500).json({ error: "Failed to disable OIDC config" });
  }
});

/**
 * @openapi
 * /users/oidc-config:
 *   get:
 *     summary: Get OIDC configuration
 *     description: Returns the public OIDC configuration.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Public OIDC configuration.
 *       500:
 *         description: Failed to get OIDC config.
 */
router.get("/oidc-config", async (_req, res) => {
  try {
    const providerResult = await loadProviderConfig(undefined);
    if (!providerResult) {
      return res.json(null);
    }
    const { config } = providerResult;
    return res.json({
      client_id: config.client_id,
      issuer_url: config.issuer_url,
      authorization_url: config.authorization_url,
      scopes: config.scopes,
    });
  } catch (err) {
    authLogger.error("Failed to get OIDC config", err);
    res.status(500).json({ error: "Failed to get OIDC config" });
  }
});

/**
 * @openapi
 * /users/oidc-config/admin:
 *   get:
 *     summary: Get OIDC configuration for admin
 *     description: Returns the full OIDC configuration for an admin.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Full OIDC configuration.
 *       500:
 *         description: Failed to get OIDC config for admin.
 */
router.get("/oidc-config/admin", requireAdmin, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'oidc_config'")
      .get();
    if (!row) {
      const envConfig = getOIDCConfigFromEnv();
      return res.json(envConfig);
    }

    let config = JSON.parse((row as Record<string, unknown>).value as string);

    if (config.client_secret?.startsWith("encrypted:")) {
      try {
        const adminDataKey = DataCrypto.getUserDataKey(userId);
        if (adminDataKey) {
          config = DataCrypto.decryptRecord(
            "settings",
            config,
            userId,
            adminDataKey,
          );
        } else {
          config.client_secret = "[ENCRYPTED - PASSWORD REQUIRED]";
        }
      } catch {
        authLogger.warn("Failed to decrypt OIDC config for admin", {
          operation: "oidc_config_decrypt_failed",
          userId,
        });
        config.client_secret = "[ENCRYPTED - DECRYPTION FAILED]";
      }
    } else if (config.client_secret?.startsWith("encoded:")) {
      try {
        const decoded = Buffer.from(
          config.client_secret.substring(8),
          "base64",
        ).toString("utf8");
        config.client_secret = decoded;
      } catch {
        authLogger.warn("Failed to decode OIDC config for admin", {
          operation: "oidc_config_decode_failed",
          userId,
        });
        config.client_secret = "[ENCODING ERROR]";
      }
    }

    res.json(config);
  } catch (err) {
    authLogger.error("Failed to get OIDC config for admin", err);
    res.status(500).json({ error: "Failed to get OIDC config for admin" });
  }
});

/**
 * @openapi
 * /users/oidc/authorize:
 *   get:
 *     summary: Get OIDC authorization URL
 *     description: Returns the OIDC authorization URL.
 *     tags:
 *       - Users
 *     parameters:
 *       - in: query
 *         name: rememberMe
 *         schema:
 *           type: boolean
 *         description: Whether to extend the session to 30 days instead of 2 hours.
 *     responses:
 *       200:
 *         description: OIDC authorization URL.
 *       404:
 *         description: OIDC not configured.
 *       500:
 *         description: Failed to generate authorization URL.
 */
router.get("/oidc/authorize", async (req, res) => {
  try {
    const {
      rememberMe,
      desktopCallbackPort,
      appCallbackUrl,
      providerId: providerIdStr,
    } = req.query;
    const publicBaseUrl = getRequestBaseUrlWithForceHTTPS(req);
    const backendCallbackUri = `${publicBaseUrl}/users/oidc/callback`;

    const resolvedProviderId = providerIdStr
      ? parseInt(providerIdStr as string, 10)
      : null;
    const providerResult = await loadProviderConfig(
      resolvedProviderId || undefined,
    );
    if (!providerResult) {
      return res.status(404).json({ error: "OIDC not configured" });
    }
    const { config, providerDbId } = providerResult;
    const state = nanoid();
    const nonce = nanoid();

    const referer = req.get("Referer");
    let frontendOrigin;
    if (desktopCallbackPort) {
      frontendOrigin = `http://127.0.0.1:${desktopCallbackPort}/oidc-callback`;
    } else if (typeof appCallbackUrl === "string" && appCallbackUrl) {
      let callbackUrl: URL;
      try {
        callbackUrl = new URL(appCallbackUrl);
      } catch {
        return res.status(400).json({ error: "Invalid app callback URL" });
      }
      if (callbackUrl.protocol !== "termix-mobile:") {
        return res.status(400).json({ error: "Unsupported app callback URL" });
      }
      frontendOrigin = callbackUrl.toString();
    } else if (referer) {
      const refererUrl = new URL(referer);
      frontendOrigin = `${refererUrl.protocol}//${refererUrl.host}${getRequestBasePath(req)}`;
    } else {
      frontendOrigin = publicBaseUrl;
    }

    db.$client
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(`oidc_state_${state}`, nonce);

    db.$client
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(`oidc_backend_callback_${state}`, backendCallbackUri);

    db.$client
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(`oidc_frontend_origin_${state}`, frontendOrigin);

    db.$client
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(
        `oidc_remember_me_${state}`,
        rememberMe === "true" ? "true" : "false",
      );

    if (providerDbId != null) {
      db.$client
        .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .run(`oidc_provider_${state}`, String(providerDbId));
    }

    const authUrl = new URL(config.authorization_url);
    authUrl.searchParams.set("client_id", config.client_id);
    authUrl.searchParams.set("redirect_uri", backendCallbackUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", config.scopes);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("nonce", nonce);

    res.json({ auth_url: authUrl.toString(), state, nonce });
  } catch (err) {
    authLogger.error("Failed to generate OIDC auth URL", err);
    res.status(500).json({ error: "Failed to generate authorization URL" });
  }
});

/**
 * @openapi
 * /users/oidc/callback:
 *   get:
 *     summary: OIDC callback
 *     description: Handles the OIDC callback, exchanges the code for a token, and creates or logs in the user.
 *     tags:
 *       - Users
 *     responses:
 *       302:
 *         description: Redirects to the frontend with a success or error message.
 *       400:
 *         description: Code and state are required.
 */
router.get("/oidc/callback", async (req, res) => {
  const { code, state } = req.query;

  if (!isNonEmptyString(code) || !isNonEmptyString(state)) {
    return res.status(400).json({ error: "Code and state are required" });
  }

  const storedBackendCallbackRow = db.$client
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(`oidc_backend_callback_${state}`);
  const storedFrontendOriginRow = db.$client
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(`oidc_frontend_origin_${state}`);
  const storedRememberMeRow = db.$client
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(`oidc_remember_me_${state}`);

  if (!storedBackendCallbackRow || !storedFrontendOriginRow) {
    return res
      .status(400)
      .json({ error: "Invalid state parameter - redirect URIs not found" });
  }

  const backendCallbackUri = (
    storedBackendCallbackRow as Record<string, unknown>
  ).value as string;
  const frontendOrigin = (storedFrontendOriginRow as Record<string, unknown>)
    .value as string;
  const storedRememberMe =
    (storedRememberMeRow as Record<string, unknown> | null)?.value === "true";

  try {
    const storedNonce = db.$client
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(`oidc_state_${state}`);
    if (!storedNonce) {
      return res.status(400).json({ error: "Invalid state parameter" });
    }

    const storedProviderIdRow = db.$client
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(`oidc_provider_${state}`) as { value: string } | null;
    const callbackProviderId = storedProviderIdRow
      ? parseInt(storedProviderIdRow.value, 10)
      : null;

    const providerResult = await loadProviderConfig(
      callbackProviderId || undefined,
    );
    if (!providerResult) {
      return res.status(500).json({ error: "OIDC not configured" });
    }
    const {
      config,
      providerType: callbackProviderType,
      providerDbId: callbackProviderDbId,
    } = providerResult;

    // Clean up provider state key
    if (storedProviderIdRow) {
      db.$client
        .prepare("DELETE FROM settings WHERE key = ?")
        .run(`oidc_provider_${state}`);
    }

    const caCert = config.ca_cert;
    const fetchOptions = buildFetchOptions(caCert);

    // GitHub does not issue OIDC id_tokens; handle its token exchange separately
    if (callbackProviderType === "github") {
      const ghTokenResponse = await fetch(config.token_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.client_id,
          client_secret: config.client_secret,
          code: code,
          redirect_uri: backendCallbackUri,
        }),
        ...fetchOptions,
      });

      if (!ghTokenResponse.ok) {
        const errorText = await ghTokenResponse.text();
        authLogger.error("GitHub token exchange failed", {
          operation: "github_token_exchange_failed",
          status: ghTokenResponse.status,
          errorResponse: errorText,
        });
        return res
          .status(400)
          .json({ error: "Failed to exchange authorization code" });
      }

      const ghTokenData = (await ghTokenResponse.json()) as Record<
        string,
        unknown
      >;
      db.$client
        .prepare("DELETE FROM settings WHERE key = ?")
        .run(`oidc_state_${state}`);
      db.$client
        .prepare("DELETE FROM settings WHERE key = ?")
        .run(`oidc_backend_callback_${state}`);
      db.$client
        .prepare("DELETE FROM settings WHERE key = ?")
        .run(`oidc_frontend_origin_${state}`);
      db.$client
        .prepare("DELETE FROM settings WHERE key = ?")
        .run(`oidc_remember_me_${state}`);

      const ghUserInfoResponse = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${ghTokenData.access_token}`,
          Accept: "application/json",
          "User-Agent": "Termix",
        },
        ...fetchOptions,
      });
      if (!ghUserInfoResponse.ok) {
        return res
          .status(400)
          .json({ error: "Failed to get GitHub user information" });
      }
      const ghUserInfo = (await ghUserInfoResponse.json()) as Record<
        string,
        unknown
      >;

      const emailRes = await fetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${ghTokenData.access_token}`,
          Accept: "application/json",
          "User-Agent": "Termix",
        },
      });
      if (emailRes.ok) {
        const emails = (await emailRes.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        const primary = emails.find((e) => e.primary && e.verified);
        if (primary) ghUserInfo.email = primary.email;
      }

      const ghIdentifier = `github:${callbackProviderDbId}:${String(ghUserInfo.id ?? ghUserInfo.login)}`;
      const ghName = (ghUserInfo.name ||
        ghUserInfo.login ||
        ghIdentifier) as string;
      const deviceInfo = parseUserAgent(req);

      let ghUser = await db
        .select()
        .from(users)
        .where(eq(users.oidcIdentifier, ghIdentifier));
      if (!ghUser || ghUser.length === 0) {
        const preCheckCount = db.$client
          .prepare("SELECT COUNT(*) as count FROM users")
          .get() as { count?: number };
        const isFirstUser = (preCheckCount?.count || 0) === 0;

        if (!isFirstUser && config.allowed_users) {
          const email = ghUserInfo.email as string | undefined;
          if (!isOIDCUserAllowed(config.allowed_users, ghIdentifier, email)) {
            const redirectUrl = new URL(frontendOrigin);
            redirectUrl.searchParams.set("error", "user_not_allowed");
            return res.redirect(redirectUrl.toString());
          }
        }

        let ghAutoProvision = false;
        try {
          const r = db.$client
            .prepare(
              "SELECT value FROM settings WHERE key = 'oidc_auto_provision'",
            )
            .get() as { value: string } | undefined;
          if (r) ghAutoProvision = r.value === "true";
        } catch {
          /* */
        }
        if (!ghAutoProvision)
          ghAutoProvision =
            (process.env.OIDC_ALLOW_REGISTRATION || "").trim().toLowerCase() ===
            "true";

        if (!isFirstUser && !ghAutoProvision) {
          const redirectUrl = new URL(frontendOrigin);
          redirectUrl.searchParams.set("error", "registration_disabled");
          return res.redirect(redirectUrl.toString());
        }

        const ghId = nanoid();
        const ghIsFirst = db.$client.transaction(() => {
          const c =
            (
              db.$client
                .prepare("SELECT COUNT(*) as count FROM users")
                .get() as { count?: number }
            )?.count || 0;
          const first = c === 0;
          db.$client
            .prepare(
              "INSERT INTO users (id, username, password_hash, is_admin, is_oidc, oidc_identifier, sso_provider_id) VALUES (?, ?, ?, ?, 1, ?, ?)",
            )
            .run(
              ghId,
              ghName,
              "",
              first ? 1 : 0,
              ghIdentifier,
              callbackProviderDbId,
            );
          return first;
        })();

        try {
          const defaultRoleName = ghIsFirst ? "admin" : "user";
          const defaultRole = await db
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.name, defaultRoleName))
            .limit(1);
          if (defaultRole.length > 0)
            await db.insert(userRoles).values({
              userId: ghId,
              roleId: defaultRole[0].id,
              grantedBy: ghId,
            });
        } catch {
          /* */
        }

        try {
          const sessionDurationMs =
            deviceInfo.type === "desktop" || deviceInfo.type === "mobile"
              ? 30 * 24 * 60 * 60 * 1000
              : 24 * 60 * 60 * 1000;
          await authManager.registerOIDCUser(ghId, sessionDurationMs);
        } catch {
          await db.delete(users).where(eq(users.id, ghId));
          return res.status(500).json({
            error: "Failed to setup user security - user creation cancelled",
          });
        }

        ghUser = await db.select().from(users).where(eq(users.id, ghId));
      }

      const ghUserRecord = ghUser[0];
      try {
        await authManager.authenticateOIDCUser(
          ghUserRecord.id,
          deviceInfo.type,
        );
      } catch {
        /* */
      }
      await syncSharedCredentialsForUserRoles(
        ghUserRecord.id,
        "github_oidc_role_shared_credentials",
      );
      const ghToken = await authManager.generateJWTToken(ghUserRecord.id, {
        deviceType: deviceInfo.type,
        deviceInfo: deviceInfo.deviceInfo,
        rememberMe: storedRememberMe,
      });
      const ghRedirectUrl = new URL(frontendOrigin);
      ghRedirectUrl.searchParams.set("success", "true");
      const ghIsTokenCallback =
        frontendOrigin.startsWith("http://127.0.0.1:") ||
        frontendOrigin.startsWith("termix-mobile:");
      const ghMaxAge =
        deviceInfo.type === "desktop" || deviceInfo.type === "mobile"
          ? 30 * 24 * 60 * 60 * 1000
          : storedRememberMe
            ? 30 * 24 * 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;
      res.clearCookie("jwt", authManager.getClearCookieOptions(req));
      if (ghIsTokenCallback) {
        ghRedirectUrl.searchParams.set("token", ghToken);
        return res.redirect(ghRedirectUrl.toString());
      }
      return res
        .cookie(
          "jwt",
          ghToken,
          authManager.getSecureCookieOptions(req, ghMaxAge),
        )
        .redirect(ghRedirectUrl.toString());
    }

    const tokenResponse = await fetch(config.token_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.client_id,
        client_secret: config.client_secret,
        code: code,
        redirect_uri: backendCallbackUri,
      }),
      ...fetchOptions,
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      authLogger.error("OIDC token exchange failed", {
        operation: "oidc_token_exchange_failed",
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        backendCallbackUri,
        frontendOrigin,
        errorResponse: errorText,
      });
      return res
        .status(400)
        .json({ error: "Failed to exchange authorization code" });
    }

    const tokenData = (await tokenResponse.json()) as Record<string, unknown>;

    db.$client
      .prepare("DELETE FROM settings WHERE key = ?")
      .run(`oidc_state_${state}`);
    db.$client
      .prepare("DELETE FROM settings WHERE key = ?")
      .run(`oidc_backend_callback_${state}`);
    db.$client
      .prepare("DELETE FROM settings WHERE key = ?")
      .run(`oidc_frontend_origin_${state}`);
    db.$client
      .prepare("DELETE FROM settings WHERE key = ?")
      .run(`oidc_remember_me_${state}`);

    let userInfo: Record<string, unknown> = null;
    const userInfoUrls: string[] = [];

    const normalizedIssuerUrl = config.issuer_url.endsWith("/")
      ? config.issuer_url.slice(0, -1)
      : config.issuer_url;
    const baseUrl = normalizedIssuerUrl.replace(/\/application\/o\/[^/]+$/, "");

    try {
      const discoveryUrl = `${normalizedIssuerUrl}/.well-known/openid-configuration`;
      const discoveryResponse = await fetch(discoveryUrl, fetchOptions);
      if (discoveryResponse.ok) {
        const discovery = (await discoveryResponse.json()) as Record<
          string,
          unknown
        >;
        if (discovery.userinfo_endpoint) {
          userInfoUrls.push(discovery.userinfo_endpoint as string);
        }
      }
    } catch (discoveryError) {
      authLogger.error(`OIDC discovery failed: ${discoveryError}`);
    }

    if (config.userinfo_url) {
      userInfoUrls.unshift(config.userinfo_url);
    }

    userInfoUrls.push(
      `${baseUrl}/userinfo/`,
      `${baseUrl}/userinfo`,
      `${normalizedIssuerUrl}/userinfo/`,
      `${normalizedIssuerUrl}/userinfo`,
      `${baseUrl}/oauth2/userinfo/`,
      `${baseUrl}/oauth2/userinfo`,
      `${normalizedIssuerUrl}/oauth2/userinfo/`,
      `${normalizedIssuerUrl}/oauth2/userinfo`,
    );

    if (tokenData.id_token) {
      try {
        userInfo = await verifyOIDCToken(
          tokenData.id_token as string,
          config.issuer_url,
          config.client_id,
          caCert,
        );
      } catch {
        try {
          const parts = (tokenData.id_token as string).split(".");
          if (parts.length === 3) {
            const payload = JSON.parse(
              Buffer.from(parts[1], "base64").toString(),
            );
            userInfo = payload;
          }
        } catch (decodeError) {
          authLogger.error("Failed to decode ID token payload:", decodeError);
        }
      }
    }

    if (tokenData.access_token) {
      for (const userInfoUrl of userInfoUrls) {
        try {
          const userInfoResponse = await fetch(userInfoUrl, {
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
            },
            ...fetchOptions,
          });

          if (userInfoResponse.ok) {
            const fetchedUserInfo = (await userInfoResponse.json()) as Record<
              string,
              unknown
            >;
            userInfo = { ...userInfo, ...fetchedUserInfo };
            break;
          } else {
            authLogger.error(
              `Userinfo endpoint ${userInfoUrl} failed with status: ${userInfoResponse.status}`,
            );
          }
        } catch (error) {
          authLogger.error(`Userinfo endpoint ${userInfoUrl} failed:`, error);
          continue;
        }
      }
    }

    if (!userInfo) {
      authLogger.error("Failed to get user information from all sources");
      authLogger.error(`Tried userinfo URLs: ${userInfoUrls.join(", ")}`);
      authLogger.error(`Token data keys: ${Object.keys(tokenData).join(", ")}`);
      authLogger.error(`Has id_token: ${!!tokenData.id_token}`);
      authLogger.error(`Has access_token: ${!!tokenData.access_token}`);
      return res.status(400).json({ error: "Failed to get user information" });
    }

    const getNestedValue = (
      obj: Record<string, unknown>,
      path: string,
    ): unknown => {
      if (!path || !obj) return null;
      return path.split(".").reduce((current, key) => current?.[key], obj);
    };

    const identifier = (getNestedValue(userInfo, config.identifier_path) ||
      userInfo[config.identifier_path] ||
      userInfo.sub ||
      userInfo.email ||
      userInfo.preferred_username) as string;

    const name = (getNestedValue(userInfo, config.name_path) ||
      userInfo[config.name_path] ||
      userInfo.name ||
      userInfo.given_name ||
      identifier) as string;

    if (!identifier) {
      authLogger.error(
        `Identifier not found at path: ${config.identifier_path}`,
      );
      authLogger.error(`Available fields: ${Object.keys(userInfo).join(", ")}`);
      return res.status(400).json({
        error: `User identifier not found at path: ${config.identifier_path}. Available fields: ${Object.keys(userInfo).join(", ")}`,
      });
    }

    const deviceInfo = parseUserAgent(req);
    let user = await db
      .select()
      .from(users)
      .where(eq(users.oidcIdentifier, identifier));

    let isFirstUser = false;
    if (!user || user.length === 0) {
      const preCheckCount = db.$client
        .prepare("SELECT COUNT(*) as count FROM users")
        .get();
      isFirstUser = ((preCheckCount as { count?: number })?.count || 0) === 0;

      if (!isFirstUser && config.allowed_users) {
        const email = userInfo.email as string | undefined;
        if (!isOIDCUserAllowed(config.allowed_users, identifier, email)) {
          authLogger.warn("OIDC user not in allowed list", {
            operation: "oidc_user_not_allowed",
            identifier,
            email,
          });
          const redirectUrl = new URL(frontendOrigin);
          redirectUrl.searchParams.set("error", "user_not_allowed");
          return res.redirect(redirectUrl.toString());
        }
      }

      let oidcAutoProvision = false;
      try {
        const oidcProvRow = db.$client
          .prepare(
            "SELECT value FROM settings WHERE key = 'oidc_auto_provision'",
          )
          .get();
        if (oidcProvRow) {
          oidcAutoProvision =
            (oidcProvRow as Record<string, unknown>).value === "true";
        }
      } catch {
        // fall through to env var check
      }

      if (!oidcAutoProvision) {
        oidcAutoProvision =
          (process.env.OIDC_ALLOW_REGISTRATION || "").trim().toLowerCase() ===
          "true";
      }

      if (!isFirstUser && !oidcAutoProvision) {
        authLogger.warn(
          "OIDC user attempted to register but auto-provisioning is disabled",
          {
            operation: "oidc_registration_disabled",
            identifier,
            name,
          },
        );
        const redirectUrl = new URL(frontendOrigin);
        redirectUrl.searchParams.set("error", "registration_disabled");
        return res.redirect(redirectUrl.toString());
      }

      const id = nanoid();
      isFirstUser = db.$client.transaction(() => {
        const countResult = db.$client
          .prepare("SELECT COUNT(*) as count FROM users")
          .get() as { count?: number };
        const first = (countResult?.count || 0) === 0;
        db.$client
          .prepare(
            "INSERT INTO users (id, username, password_hash, is_admin, is_oidc, oidc_identifier, sso_provider_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            id,
            name,
            "",
            first ? 1 : 0,
            1,
            identifier,
            callbackProviderDbId,
          );
        return first;
      })();

      try {
        const defaultRoleName = isFirstUser ? "admin" : "user";
        const defaultRole = await db
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.name, defaultRoleName))
          .limit(1);

        if (defaultRole.length > 0) {
          await db.insert(userRoles).values({
            userId: id,
            roleId: defaultRole[0].id,
            grantedBy: id,
          });
        } else {
          authLogger.warn(
            "Default role not found during OIDC user registration",
            {
              operation: "assign_default_role_oidc",
              userId: id,
              roleName: defaultRoleName,
            },
          );
        }
      } catch (roleError) {
        authLogger.error(
          "Failed to assign default role to OIDC user",
          roleError,
          {
            operation: "assign_default_role_oidc",
            userId: id,
          },
        );
      }

      try {
        const sessionDurationMs =
          deviceInfo.type === "desktop" || deviceInfo.type === "mobile"
            ? 30 * 24 * 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;
        await authManager.registerOIDCUser(id, sessionDurationMs);
      } catch (encryptionError) {
        await db.delete(users).where(eq(users.id, id));
        authLogger.error(
          "Failed to setup OIDC user encryption, user creation rolled back",
          encryptionError,
          {
            operation: "oidc_user_create_encryption_failed",
            userId: id,
          },
        );
        return res.status(500).json({
          error: "Failed to setup user security - user creation cancelled",
        });
      }

      try {
        const { saveMemoryDatabaseToFile } = await import("../db/index.js");
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        authLogger.error("Failed to persist OIDC user to disk", saveError, {
          operation: "oidc_user_create_save_failed",
          userId: id,
        });
      }

      user = await db.select().from(users).where(eq(users.id, id));
    } else {
      if (config.allowed_users) {
        const email = userInfo.email as string | undefined;
        if (!isOIDCUserAllowed(config.allowed_users, identifier, email)) {
          authLogger.warn("OIDC user not in allowed list (existing user)", {
            operation: "oidc_user_not_allowed_existing",
            identifier,
            email,
            userId: user[0].id,
          });
          const redirectUrl = new URL(frontendOrigin);
          redirectUrl.searchParams.set("error", "user_not_allowed");
          return res.redirect(redirectUrl.toString());
        }
      }

      const isDualAuth =
        user[0].passwordHash && user[0].passwordHash.trim() !== "";

      if (!isDualAuth) {
        await db
          .update(users)
          .set({ username: name })
          .where(eq(users.id, user[0].id));
      }

      user = await db.select().from(users).where(eq(users.id, user[0].id));
    }

    const userRecord = user[0];

    // Sync admin status based on OIDC group membership
    if (config.admin_group) {
      const groups = extractOidcGroups(
        userInfo as Record<string, unknown>,
        config.group_claim,
      );

      authLogger.info(
        `Evaluating OIDC admin group sync. parsedGroups: ${JSON.stringify(groups)}, configuredAdminGroup: ${config.admin_group}, groupClaim: ${config.group_claim || "(default)"}, availableUserInfoKeys: ${Object.keys(userInfo).join(",")}`,
        {
          operation: "oidc_admin_group_sync_eval",
          userId: userRecord.id,
        },
      );

      const shouldBeAdmin = groups.includes(config.admin_group);
      if (!!userRecord.isAdmin !== shouldBeAdmin) {
        authLogger.info("Syncing admin status based on OIDC group membership", {
          operation: "oidc_admin_group_sync",
          userId: userRecord.id,
          group: config.admin_group,
          isAdmin: shouldBeAdmin,
        });
        await db
          .update(users)
          .set({ isAdmin: shouldBeAdmin })
          .where(eq(users.id, userRecord.id));
        userRecord.isAdmin = shouldBeAdmin;
        try {
          const newRoleName = shouldBeAdmin ? "admin" : "user";
          const oldRoleName = shouldBeAdmin ? "user" : "admin";
          const newRole = await db
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.name, newRoleName))
            .limit(1);
          const oldRole = await db
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.name, oldRoleName))
            .limit(1);
          if (oldRole.length > 0) {
            await db
              .delete(userRoles)
              .where(
                and(
                  eq(userRoles.userId, userRecord.id),
                  eq(userRoles.roleId, oldRole[0].id),
                ),
              );
          }
          if (newRole.length > 0) {
            await db.insert(userRoles).values({
              userId: userRecord.id,
              roleId: newRole[0].id,
              grantedBy: userRecord.id,
            });
          }
        } catch {
          /* non-fatal */
        }
        authLogger.info("OIDC admin status synced", {
          operation: "oidc_admin_group_sync",
          userId: userRecord.id,
          group: config.admin_group,
          isAdmin: shouldBeAdmin,
        });
      }
    }

    try {
      await authManager.authenticateOIDCUser(userRecord.id, deviceInfo.type);
    } catch (setupError) {
      authLogger.error("Failed to setup OIDC user encryption", setupError, {
        operation: "oidc_user_encryption_setup_failed",
        userId: userRecord.id,
      });
    }

    await syncSharedCredentialsForUserRoles(
      userRecord.id,
      "oidc_role_shared_credentials",
    );

    const token = await authManager.generateJWTToken(userRecord.id, {
      deviceType: deviceInfo.type,
      deviceInfo: deviceInfo.deviceInfo,
      rememberMe: storedRememberMe,
    });

    authLogger.success("OIDC login successful", {
      operation: "oidc_login_complete",
      userId: userRecord.id,
      username: userRecord.username,
    });

    const redirectUrl = new URL(frontendOrigin);
    redirectUrl.searchParams.set("success", "true");

    const isTokenCallback =
      frontendOrigin.startsWith("http://127.0.0.1:") ||
      frontendOrigin.startsWith("termix-mobile:");

    const maxAge =
      deviceInfo.type === "desktop" || deviceInfo.type === "mobile"
        ? 30 * 24 * 60 * 60 * 1000
        : storedRememberMe
          ? 30 * 24 * 60 * 60 * 1000
          : 24 * 60 * 60 * 1000;

    res.clearCookie("jwt", authManager.getClearCookieOptions(req));

    if (isTokenCallback) {
      redirectUrl.searchParams.set("token", token);
      return res.redirect(redirectUrl.toString());
    }

    return res
      .cookie("jwt", token, authManager.getSecureCookieOptions(req, maxAge))
      .redirect(redirectUrl.toString());
  } catch (err) {
    authLogger.error("OIDC callback failed", err);

    const redirectUrl = new URL(frontendOrigin);
    redirectUrl.searchParams.set("error", "OIDC authentication failed");

    res.redirect(redirectUrl.toString());
  }
});

/**
 * @openapi
 * /users/login:
 *   post:
 *     summary: User login
 *     description: Authenticates a user and returns a JWT.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful.
 *       400:
 *         description: Invalid username or password.
 *       401:
 *         description: Invalid username or password.
 *       403:
 *         description: Password authentication is currently disabled.
 *       429:
 *         description: Too many login attempts.
 *       500:
 *         description: Login failed.
 */
router.post("/login", async (req, res) => {
  const { username, password, rememberMe } = req.body;
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  authLogger.info("User login request received", {
    operation: "user_login_request",
    username,
  });

  if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
    authLogger.warn("Invalid traditional login attempt", {
      operation: "user_login",
      hasUsername: !!username,
      hasPassword: !!password,
    });
    return res.status(400).json({ error: "Invalid username or password" });
  }

  const lockStatus = loginRateLimiter.isLocked(clientIp, username);
  if (lockStatus.locked) {
    authLogger.warn("Login attempt blocked due to rate limiting", {
      operation: "user_login_blocked",
      username,
      ip: clientIp,
      remainingTime: lockStatus.remainingTime,
    });
    return res.status(429).json({
      error: "Too many login attempts. Please try again later.",
      remainingTime: lockStatus.remainingTime,
    });
  }

  if (!isPasswordLoginAllowed()) {
    return res
      .status(403)
      .json({ error: "Password authentication is currently disabled" });
  }

  try {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.username, username));

    if (!user || user.length === 0) {
      loginRateLimiter.recordFailedAttempt(clientIp, username);
      authLogger.warn(`Login failed: user not found`, {
        operation: "user_login",
        username,
        ip: clientIp,
        remainingAttempts: loginRateLimiter.getRemainingAttempts(
          clientIp,
          username,
        ),
      });
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const userRecord = user[0];

    if (
      userRecord.isOidc &&
      (!userRecord.passwordHash || userRecord.passwordHash.trim() === "")
    ) {
      authLogger.warn("OIDC-only user attempted traditional login", {
        operation: "user_login",
        username,
        userId: userRecord.id,
      });
      return res
        .status(403)
        .json({ error: "This user uses external authentication" });
    }

    const isMatch = await bcrypt.compare(password, userRecord.passwordHash);
    if (!isMatch) {
      loginRateLimiter.recordFailedAttempt(clientIp, username);
      authLogger.warn(`Login failed: incorrect password`, {
        operation: "user_login",
        username,
        userId: userRecord.id,
        ip: clientIp,
        remainingAttempts: loginRateLimiter.getRemainingAttempts(
          clientIp,
          username,
        ),
      });
      return res.status(401).json({ error: "Invalid username or password" });
    }

    try {
      const kekSalt = await db
        .select()
        .from(settings)
        .where(eq(settings.key, `user_kek_salt_${userRecord.id}`));

      if (kekSalt.length === 0) {
        await authManager.registerUser(userRecord.id, password);
      }
    } catch {
      // expected - KEK salt registration may fail for existing users
    }

    const deviceInfo = parseUserAgent(req);

    let dataUnlocked = false;
    if (userRecord.isOidc) {
      dataUnlocked = await authManager.authenticateOIDCUser(
        userRecord.id,
        deviceInfo.type,
      );
    } else {
      dataUnlocked = await authManager.authenticateUser(
        userRecord.id,
        password,
        deviceInfo.type,
      );
    }

    if (!dataUnlocked) {
      return res.status(401).json({ error: "Incorrect password" });
    }

    await syncSharedCredentialsForUserRoles(
      userRecord.id,
      "login_role_shared_credentials",
    );

    if (userRecord.totpEnabled) {
      const deviceFingerprint = generateDeviceFingerprint(deviceInfo);

      const isTrusted = await authManager.isTrustedDevice(
        userRecord.id,
        deviceFingerprint,
      );

      if (isTrusted) {
        authLogger.info("TOTP bypassed for trusted device", {
          operation: "totp_bypass",
          userId: userRecord.id,
          deviceFingerprint,
        });
      } else {
        const tempToken = await authManager.generateJWTToken(userRecord.id, {
          pendingTOTP: true,
          expiresIn: "10m",
        });
        return res.json({
          success: true,
          requires_totp: true,
          temp_token: tempToken,
          rememberMe: !!rememberMe,
        });
      }
    }

    const token = await authManager.generateJWTToken(userRecord.id, {
      rememberMe: !!rememberMe,
      deviceType: deviceInfo.type,
      deviceInfo: deviceInfo.deviceInfo,
    });

    loginRateLimiter.resetAttempts(clientIp, username);

    const payload = await authManager.verifyJWTToken(token);
    authLogger.success("User login successful", {
      operation: "user_login_complete",
      userId: userRecord.id,
      username,
      sessionId: payload?.sessionId,
    });

    const { ipAddress: loginIp, userAgent: loginUa } = getRequestMeta(req);
    await logAudit({
      userId: userRecord.id,
      username,
      action: "login",
      resourceType: "session",
      ipAddress: loginIp,
      userAgent: loginUa,
      success: true,
    });

    const response: Record<string, unknown> = {
      success: true,
      is_admin: !!userRecord.isAdmin,
      username: userRecord.username,
      ...(isNativeAppRequest(req) ? { token } : {}),
    };

    const timeoutRow = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'session_timeout_hours'")
      .get() as { value: string } | undefined;
    const timeoutHours = timeoutRow ? parseInt(timeoutRow.value, 10) || 24 : 24;
    const maxAge = rememberMe
      ? 30 * 24 * 60 * 60 * 1000
      : timeoutHours * 60 * 60 * 1000;

    return res
      .cookie("jwt", token, authManager.getSecureCookieOptions(req, maxAge))
      .json(response);
  } catch (err) {
    authLogger.error("Failed to log in user", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

/**
 * @openapi
 * /users/logout:
 *   post:
 *     summary: User logout
 *     description: Logs out the user and clears the JWT cookie.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Logged out successfully.
 *       500:
 *         description: Logout failed.
 */
router.post("/logout", authenticateJWT, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;

    if (userId) {
      const sessionId = authReq.sessionId;

      await authManager.logoutUser(userId, sessionId);
      authLogger.info("User logged out", {
        operation: "user_logout",
        userId,
        sessionId,
      });
    }

    return res
      .clearCookie("jwt", authManager.getClearCookieOptions(req))
      .json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    authLogger.error("Logout failed", err);
    return res.status(500).json({ error: "Logout failed" });
  }
});

/**
 * @openapi
 * /users/me:
 *   get:
 *     summary: Get current user's info
 *     description: Retrieves information about the currently authenticated user.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: User information.
 *       401:
 *         description: Invalid userId or user not found.
 *       500:
 *         description: Failed to get username.
 */
router.get("/me", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;

  if (!isNonEmptyString(userId)) {
    authLogger.warn("Invalid userId in JWT for /users/me");
    return res.status(401).json({ error: "Invalid userId" });
  }
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0) {
      authLogger.warn(`User not found for /users/me: ${userId}`);
      return res.status(401).json({ error: "User not found" });
    }

    const hasPassword =
      user[0].passwordHash && user[0].passwordHash.trim() !== "";
    const hasOidc = user[0].isOidc && user[0].oidcIdentifier;
    const isDualAuth = hasPassword && hasOidc;

    res.json({
      userId: user[0].id,
      username: user[0].username,
      is_admin: !!user[0].isAdmin,
      is_oidc: !!user[0].isOidc,
      is_dual_auth: isDualAuth,
      totp_enabled: !!user[0].totpEnabled,
      data_unlocked: authManager.isUserUnlocked(userId),
    });
  } catch (err) {
    authLogger.error("Failed to get username", err);
    res.status(500).json({ error: "Failed to get username" });
  }
});

/**
 * @openapi
 * /users/me/token:
 *   get:
 *     summary: Get current session token
 *     description: Returns the JWT for the currently authenticated session. Intended for mobile WebView clients that cannot read HTTP-only cookies.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Current session token.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *       401:
 *         description: Not authenticated.
 */
router.get("/me/token", authenticateJWT, (req: Request, res: Response) => {
  const token = (req as Request & { cookies: Record<string, string> }).cookies
    ?.jwt;
  res.json({ token: token || null });
});

/**
 * @openapi
 * /users/setup-required:
 *   get:
 *     summary: Check if setup is required
 *     description: Checks if the system requires initial setup (i.e., no users exist).
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Setup status.
 *       500:
 *         description: Failed to check setup status.
 */
router.get("/setup-required", async (req, res) => {
  try {
    const countResult = db.$client
      .prepare("SELECT COUNT(*) as count FROM users")
      .get();
    const count = (countResult as { count?: number })?.count || 0;

    res.json({
      setup_required: count === 0,
    });
  } catch (err) {
    authLogger.error("Failed to check setup status", err);
    res.status(500).json({ error: "Failed to check setup status" });
  }
});

/**
 * @openapi
 * /users/count:
 *   get:
 *     summary: Count users
 *     description: Returns the total number of users in the system.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: User count.
 *       403:
 *         description: Admin access required.
 *       500:
 *         description: Failed to count users.
 */
router.get("/count", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user[0] || !user[0].isAdmin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const countResult = db.$client
      .prepare("SELECT COUNT(*) as count FROM users")
      .get();
    const count = (countResult as { count?: number })?.count || 0;
    res.json({ count });
  } catch (err) {
    authLogger.error("Failed to count users", err);
    res.status(500).json({ error: "Failed to count users" });
  }
});

/**
 * @openapi
 * /users/db-health:
 *   get:
 *     summary: Database health check
 *     description: Checks if the database is accessible.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Database is accessible.
 *       500:
 *         description: Database not accessible.
 */
router.get("/db-health", requireAdmin, async (req, res) => {
  try {
    db.$client.prepare("SELECT 1").get();
    res.json({ status: "ok" });
  } catch (err) {
    authLogger.error("DB health check failed", err);
    res.status(500).json({ error: "Database not accessible" });
  }
});

/**
 * @openapi
 * /users/registration-allowed:
 *   get:
 *     summary: Get registration status
 *     description: Checks if user registration is currently allowed.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Registration status.
 *       500:
 *         description: Failed to get registration allowed status.
 */
router.get("/registration-allowed", async (req, res) => {
  try {
    res.json({ allowed: isRegistrationAllowed() });
  } catch (err) {
    authLogger.error("Failed to get registration allowed", err);
    res.status(500).json({ error: "Failed to get registration allowed" });
  }
});

/**
 * @openapi
 * /users/registration-allowed:
 *   patch:
 *     summary: Set registration status
 *     description: Enables or disables user registration.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               allowed:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Registration status updated.
 *       400:
 *         description: Invalid value for allowed.
 *       403:
 *         description: Not authorized.
 *       500:
 *         description: Failed to set registration allowed status.
 */
router.patch("/registration-allowed", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0 || !user[0].isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const { allowed } = req.body;
    if (typeof allowed !== "boolean") {
      return res.status(400).json({ error: "Invalid value for allowed" });
    }
    db.$client
      .prepare("UPDATE settings SET value = ? WHERE key = 'allow_registration'")
      .run(allowed ? "true" : "false");
    res.json({ allowed });
  } catch (err) {
    authLogger.error("Failed to set registration allowed", err);
    res.status(500).json({ error: "Failed to set registration allowed" });
  }
});

router.get("/oidc-auto-provision", async (_req, res) => {
  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'oidc_auto_provision'")
      .get();
    res.json({
      enabled: row ? (row as Record<string, unknown>).value === "true" : false,
    });
  } catch (err) {
    authLogger.error("Failed to get OIDC auto-provision setting", err);
    res
      .status(500)
      .json({ error: "Failed to get OIDC auto-provision setting" });
  }
});

router.patch("/oidc-auto-provision", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0 || !user[0].isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const { enabled } = req.body;
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "Invalid value for enabled" });
    }
    const existing = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'oidc_auto_provision'")
      .get();
    if (existing) {
      db.$client
        .prepare(
          "UPDATE settings SET value = ? WHERE key = 'oidc_auto_provision'",
        )
        .run(enabled ? "true" : "false");
    } else {
      db.$client
        .prepare(
          "INSERT INTO settings (key, value) VALUES ('oidc_auto_provision', ?)",
        )
        .run(enabled ? "true" : "false");
    }
    res.json({ enabled });
  } catch (err) {
    authLogger.error("Failed to set OIDC auto-provision", err);
    res.status(500).json({ error: "Failed to set OIDC auto-provision" });
  }
});

/**
 * @openapi
 * /users/oidc-silent-login-default:
 *   get:
 *     summary: Get OIDC silent login default setting
 *     description: Returns whether silent OIDC login is enabled as the default behavior.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Silent login default setting.
 *       500:
 *         description: Failed to get setting.
 */
router.get("/oidc-silent-login-default", async (_req, res) => {
  try {
    const row = db.$client
      .prepare(
        "SELECT value FROM settings WHERE key = 'oidc_silent_login_default'",
      )
      .get();
    res.json({
      enabled: row ? (row as Record<string, unknown>).value === "true" : false,
    });
  } catch (err) {
    authLogger.error("Failed to get OIDC silent login default", err);
    res.status(500).json({ error: "Failed to get OIDC silent login default" });
  }
});

/**
 * @openapi
 * /users/oidc-silent-login-default:
 *   patch:
 *     summary: Set OIDC silent login default setting
 *     description: Enables or disables silent OIDC login as the default behavior on the login page.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Setting updated.
 *       400:
 *         description: Invalid value.
 *       403:
 *         description: Not authorized.
 *       500:
 *         description: Failed to update setting.
 */
router.patch(
  "/oidc-silent-login-default",
  authenticateJWT,
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const user = await db.select().from(users).where(eq(users.id, userId));
      if (!user || user.length === 0 || !user[0].isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "Invalid value for enabled" });
      }
      const existing = db.$client
        .prepare(
          "SELECT value FROM settings WHERE key = 'oidc_silent_login_default'",
        )
        .get();
      if (existing) {
        db.$client
          .prepare(
            "UPDATE settings SET value = ? WHERE key = 'oidc_silent_login_default'",
          )
          .run(enabled ? "true" : "false");
      } else {
        db.$client
          .prepare(
            "INSERT INTO settings (key, value) VALUES ('oidc_silent_login_default', ?)",
          )
          .run(enabled ? "true" : "false");
      }
      const { saveMemoryDatabaseToFile } = await import("../db/index.js");
      await saveMemoryDatabaseToFile();
      res.json({ enabled });
    } catch (err) {
      authLogger.error("Failed to set OIDC silent login default", err);
      res
        .status(500)
        .json({ error: "Failed to set OIDC silent login default" });
    }
  },
);

/**
 * @openapi
 * /users/password-login-allowed:
 *   get:
 *     summary: Get password login status
 *     description: Checks if password-based login is currently allowed.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Password login status.
 *       500:
 *         description: Failed to get password login allowed status.
 */
router.get("/password-login-allowed", async (req, res) => {
  try {
    res.json({ allowed: isPasswordLoginAllowed() });
  } catch (err) {
    authLogger.error("Failed to get password login allowed", err);
    res.status(500).json({ error: "Failed to get password login allowed" });
  }
});

/**
 * @openapi
 * /users/password-login-allowed:
 *   patch:
 *     summary: Set password login status
 *     description: Enables or disables password-based login.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               allowed:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Password login status updated.
 *       400:
 *         description: Invalid value for allowed.
 *       403:
 *         description: Not authorized.
 *       500:
 *         description: Failed to set password login allowed status.
 */
router.patch("/password-login-allowed", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0 || !user[0].isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const { allowed } = req.body;
    if (typeof allowed !== "boolean") {
      return res.status(400).json({ error: "Invalid value for allowed" });
    }
    if (!allowed) {
      const totpRow = db.$client
        .prepare("SELECT COUNT(*) as count FROM users WHERE totp_enabled = 1")
        .get() as { count?: number };
      if ((totpRow?.count || 0) > 0) {
        return res.status(409).json({
          error:
            "Cannot disable password login while 2FA is enabled for one or more users. Disable 2FA first.",
        });
      }
    }
    db.$client
      .prepare(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('allow_password_login', ?)",
      )
      .run(allowed ? "true" : "false");
    const { saveMemoryDatabaseToFile } = await import("../db/index.js");
    await saveMemoryDatabaseToFile();
    res.json({ allowed });
  } catch (err) {
    authLogger.error("Failed to set password login allowed", err);
    res.status(500).json({ error: "Failed to set password login allowed" });
  }
});

/**
 * @openapi
 * /users/password-reset-allowed:
 *   get:
 *     summary: Get password reset status
 *     description: Checks if password reset is currently allowed.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Password reset status.
 *       500:
 *         description: Failed to get password reset allowed status.
 */
router.get("/password-reset-allowed", async (req, res) => {
  try {
    res.json({ allowed: isPasswordResetAllowed() });
  } catch (err) {
    authLogger.error("Failed to get password reset allowed", err);
    res.status(500).json({ error: "Failed to get password reset allowed" });
  }
});

/**
 * @openapi
 * /users/password-reset-allowed:
 *   patch:
 *     summary: Set password reset status
 *     description: Enables or disables password reset.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               allowed:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Password reset status updated.
 *       400:
 *         description: Invalid value for allowed.
 *       403:
 *         description: Not authorized.
 *       500:
 *         description: Failed to set password reset allowed status.
 */
router.patch("/password-reset-allowed", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0 || !user[0].isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const { allowed } = req.body;
    if (typeof allowed !== "boolean") {
      return res.status(400).json({ error: "Invalid value for allowed" });
    }
    db.$client
      .prepare(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('allow_password_reset', ?)",
      )
      .run(allowed ? "true" : "false");
    res.json({ allowed });
  } catch (err) {
    authLogger.error("Failed to set password reset allowed", err);
    res.status(500).json({ error: "Failed to set password reset allowed" });
  }
});

/**
 * @openapi
 * /users/delete-account:
 *   delete:
 *     summary: Delete user account
 *     description: Deletes the authenticated user's account.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Account deleted successfully.
 *       400:
 *         description: Password is required.
 *       401:
 *         description: Incorrect password.
 *       403:
 *         description: Cannot delete external authentication accounts or the last admin user.
 *       404:
 *         description: User not found.
 *       500:
 *         description: Failed to delete account.
 */
router.delete("/delete-account", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { password } = req.body;

  if (!isNonEmptyString(password)) {
    return res
      .status(400)
      .json({ error: "Password is required to delete account" });
  }

  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userRecord = user[0];

    if (userRecord.isOidc) {
      return res.status(403).json({
        error:
          "Cannot delete external authentication accounts through this endpoint",
      });
    }

    const isMatch = await bcrypt.compare(password, userRecord.passwordHash);
    if (!isMatch) {
      authLogger.warn(
        `Incorrect password provided for account deletion: ${userRecord.username}`,
      );
      return res.status(401).json({ error: "Incorrect password" });
    }

    if (userRecord.isAdmin) {
      const adminCount = db.$client
        .prepare("SELECT COUNT(*) as count FROM users WHERE is_admin = 1")
        .get();
      if (((adminCount as { count?: number })?.count || 0) <= 1) {
        return res
          .status(403)
          .json({ error: "Cannot delete the last admin user" });
      }
    }

    await db.delete(users).where(eq(users.id, userId));

    authLogger.success(`User account deleted: ${userRecord.username}`);
    res.json({ message: "Account deleted successfully" });
  } catch (err) {
    authLogger.error("Failed to delete user account", err);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

registerUserPasswordResetRoutes(router, { authManager });

/**
 * @openapi
 * /users/change-password:
 *   post:
 *     summary: Change user password
 *     description: Changes the authenticated user's password.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               oldPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password changed successfully.
 *       400:
 *         description: Old and new passwords are required.
 *       401:
 *         description: Incorrect current password.
 *       500:
 *         description: Failed to update password and re-encrypt data.
 */
router.post("/change-password", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { oldPassword, newPassword } = req.body;
  authLogger.info("Password change request", {
    operation: "password_change_request",
    userId,
  });

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  if (!oldPassword || !newPassword) {
    return res
      .status(400)
      .json({ error: "Old and new passwords are required." });
  }

  const user = await db.select().from(users).where(eq(users.id, userId));
  if (!user || user.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  const isMatch = await bcrypt.compare(oldPassword, user[0].passwordHash);
  if (!isMatch) {
    authLogger.warn("Password change failed - old password incorrect", {
      operation: "password_change_failed",
      userId,
      reason: "old_password_wrong",
    });
    return res.status(401).json({ error: "Incorrect current password" });
  }

  const success = await authManager.changeUserPassword(
    userId,
    oldPassword,
    newPassword,
  );
  if (!success) {
    return res
      .status(500)
      .json({ error: "Failed to update password and re-encrypt data." });
  }

  const password_hash = await bcrypt.hash(newPassword, 10);
  await db
    .update(users)
    .set({ passwordHash: password_hash })
    .where(eq(users.id, userId));

  authManager.logoutUser(userId);
  authLogger.success("Password changed successfully", {
    operation: "password_change_complete",
    userId,
  });

  const { ipAddress: pwIp, userAgent: pwUa } = getRequestMeta(req);
  const pwUser = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  await logAudit({
    userId,
    username: pwUser[0]?.username ?? userId,
    action: "change_password",
    resourceType: "user",
    resourceId: userId,
    ipAddress: pwIp,
    userAgent: pwUa,
    success: true,
  });

  res.json({ message: "Password changed successfully. Please log in again." });
});

registerUserAdminRoutes(router, authenticateJWT);

registerUserTotpRoutes(router, {
  authenticateJWT,
  authManager,
  isNativeAppRequest,
});

registerUserWebAuthnRoutes(router, {
  authenticateJWT,
  authManager,
  isNativeAppRequest,
});

/**
 * @openapi
 * /users/delete-user:
 *   delete:
 *     summary: Delete user (admin only)
 *     description: Allows an admin to delete another user and all related data.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *     responses:
 *       200:
 *         description: User deleted successfully.
 *       400:
 *         description: Username is required or cannot delete yourself.
 *       403:
 *         description: Not authorized or cannot delete last admin.
 *       404:
 *         description: User not found.
 *       500:
 *         description: Failed to delete user.
 */
router.delete("/delete-user", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { username } = req.body;

  if (!isNonEmptyString(username)) {
    return res.status(400).json({ error: "Username is required" });
  }

  try {
    const adminUser = await db.select().from(users).where(eq(users.id, userId));
    if (!adminUser || adminUser.length === 0 || !adminUser[0].isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }

    if (adminUser[0].username === username) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }

    const targetUser = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    if (!targetUser || targetUser.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    if (targetUser[0].isAdmin) {
      const adminCount = db.$client
        .prepare("SELECT COUNT(*) as count FROM users WHERE is_admin = 1")
        .get();
      if (((adminCount as { count?: number })?.count || 0) <= 1) {
        return res
          .status(403)
          .json({ error: "Cannot delete the last admin user" });
      }
    }

    const targetUserId = targetUser[0].id;

    await deleteUserAndRelatedData(targetUserId);

    authLogger.warn("User account deleted by admin", {
      operation: "admin_delete_user",
      adminId: userId,
      targetUserId,
      targetUsername: username,
    });

    const { ipAddress: deleteIp, userAgent: deleteUa } = getRequestMeta(req);
    const delAdminRecord = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    await logAudit({
      userId,
      username: delAdminRecord[0]?.username ?? userId,
      action: "delete_user",
      resourceType: "user",
      resourceId: targetUserId,
      resourceName: username,
      ipAddress: deleteIp,
      userAgent: deleteUa,
      success: true,
    });

    res.json({ message: `User ${username} deleted successfully` });
  } catch (err) {
    authLogger.error("Failed to delete user", err);

    if (err && typeof err === "object" && "code" in err) {
      if (err.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
        res.status(400).json({
          error:
            "Cannot delete user: User has associated data that cannot be removed",
        });
      } else {
        res.status(500).json({ error: `Database error: ${err.code}` });
      }
    } else {
      res.status(500).json({ error: "Failed to delete account" });
    }
  }
});

registerUserDataAccessRoutes(router, {
  authenticateJWT,
  authManager,
});

registerUserSessionRoutes(router, {
  authenticateJWT,
  authManager,
});

registerUserOidcAccountRoutes(router, {
  authenticateJWT,
  authManager,
});

registerUserSettingsRoutes(router, authenticateJWT);
registerAcmeSSLRoutes(router, authenticateJWT);

registerUserApiKeyRoutes(router, requireAdmin);

registerSSOProviderRoutes(router);
registerLDAPAuthRoutes(router);

export default router;
