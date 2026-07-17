import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import type { Request, Response } from "express";
import { authLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import {
  parseUserAgent,
  generateDeviceFingerprint,
} from "../../utils/user-agent-parser.js";
import { loginRateLimiter } from "../../utils/login-rate-limiter.js";
import { getRequestOriginWithForceHTTPS } from "../../utils/request-origin.js";
import {
  getDesktopOidcCallbackUrl,
  isOidcTokenCallback,
} from "../../utils/oidc-desktop-callback.js";
import { deleteUserAndRelatedData } from "./delete-user-data.js";
import { shouldShowDonationModal } from "./donation-modal-utils.js";
import {
  getOIDCConfigFromEnv,
  isOIDCUserAllowed,
  verifyOIDCToken,
  extractOidcGroups,
  loadProviderConfig,
  buildFetchOptions,
  resolveProviderByIssuer,
  validateLogoutToken,
} from "./user-oidc-utils.js";
import { registerUserApiKeyRoutes } from "./user-api-key-routes.js";
import { registerUserSettingsRoutes } from "./user-settings-routes.js";
import { registerAcmeSSLRoutes } from "./acme-ssl-routes.js";
import { registerUserTotpRoutes } from "./user-totp-routes.js";
import { registerUserWebAuthnRoutes } from "./user-webauthn-routes.js";
import { registerUserSessionRoutes } from "./user-session-routes.js";
import { registerUserOidcAccountRoutes } from "./user-oidc-account-routes.js";
import { registerUserPasswordResetRoutes } from "./user-password-reset-routes.js";
import { registerUserAdminRoutes } from "./user-admin-routes.js";
import { registerUserDataAccessRoutes } from "./user-data-access-routes.js";
import { registerSSOProviderRoutes } from "./sso-provider-routes.js";
import { registerLDAPAuthRoutes } from "./ldap-auth-routes.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";
import {
  createCurrentSettingsRepository,
  getCurrentSettingValue,
  createCurrentRoleRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";
import type { UserRecord } from "../repositories/user-repository.js";

const authManager = AuthManager.getInstance();

const router = express.Router();

async function syncSharedCredentialsForUserRoles(
  userId: string,
  operation: string,
) {
  try {
    const { SharedHostSecretsManager } =
      await import("../../utils/shared-host-secrets-manager.js");
    await SharedHostSecretsManager.getInstance().snapshotForUserRoles(userId);
  } catch (error) {
    authLogger.warn("Failed to sync role shared host secrets", {
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
    const value = getCurrentSettingValue("allow_registration");
    return value ? value === "true" : true;
  } catch {
    return true;
  }
}

function isPasswordLoginAllowed(): boolean {
  const envVal = process.env.ALLOW_PASSWORD_LOGIN;
  if (envVal !== undefined) return envVal.trim().toLowerCase() === "true";
  try {
    const value = getCurrentSettingValue("allow_password_login");
    return value ? value === "true" : true;
  } catch {
    return true;
  }
}

function isPasswordResetAllowed(): boolean {
  const envVal = process.env.ALLOW_PASSWORD_RESET;
  if (envVal !== undefined) return envVal.trim().toLowerCase() === "true";
  try {
    const value = getCurrentSettingValue("allow_password_reset");
    return value ? value === "true" : true;
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

async function findCurrentUser(userId: string): Promise<UserRecord | null> {
  return createCurrentUserRepository().findById(userId);
}

async function requireCurrentAdmin(userId: string): Promise<UserRecord | null> {
  const user = await findCurrentUser(userId);
  return user?.isAdmin ? user : null;
}

async function deleteOIDCStateSettings(state: string): Promise<void> {
  const settingsRepository = createCurrentSettingsRepository();
  await settingsRepository.delete(`oidc_state_${state}`);
  await settingsRepository.delete(`oidc_backend_callback_${state}`);
  await settingsRepository.delete(`oidc_frontend_origin_${state}`);
  await settingsRepository.delete(`oidc_remember_me_${state}`);
  await settingsRepository.delete(`oidc_provider_${state}`);
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
    const userRepository = createCurrentUserRepository();
    const existing = await userRepository.findByUsername(username);
    if (existing) {
      authLogger.warn("Registration failed - username exists", {
        operation: "user_register_failed",
        username,
        reason: "username_exists",
      });
      return res.status(409).json({ error: "Username already exists" });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const id = nanoid();

    const { isFirstUser } = await userRepository.createFirstLocalUser({
      id,
      username,
      passwordHash: password_hash,
      isOidc: false,
      clientId: "",
      clientSecret: "",
      issuerUrl: "",
      authorizationUrl: "",
      tokenUrl: "",
      identifierPath: "",
      namePath: "",
      scopes: "openid email profile",
      totpSecret: null,
      totpEnabled: false,
      totpBackupCodes: null,
    });

    try {
      const defaultRoleName = isFirstUser ? "admin" : "user";
      const assigned = await createCurrentRoleRepository().assignRoleNameToUser(
        {
          userId: id,
          roleName: defaultRoleName,
          grantedBy: id,
        },
      );

      if (!assigned) {
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
      await userRepository.delete(id);
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
      await DatabaseSaveTrigger.forceSave("user_create_explicit_save");
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
    const user = await requireCurrentAdmin(userId);
    if (!user) {
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

    const settingsRepository = createCurrentSettingsRepository();

    if (isDisableRequest) {
      await settingsRepository.delete("oidc_config");
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

      await settingsRepository.set(
        "oidc_config",
        JSON.stringify(encryptedConfig),
      );
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
    const user = await requireCurrentAdmin(userId);
    if (!user) {
      return res.status(403).json({ error: "Not authorized" });
    }

    await createCurrentSettingsRepository().delete("oidc_config");
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
    const value = await createCurrentSettingsRepository().get("oidc_config");
    if (!value) {
      const envConfig = getOIDCConfigFromEnv();
      return res.json(envConfig);
    }

    let config = JSON.parse(value);

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
    const origin = getRequestOriginWithForceHTTPS(req);
    const basePath = (process.env.BASE_PATH || "").replace(/\/+$/, "");
    const backendCallbackUri = `${origin}${basePath}/users/oidc/callback`;

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
      frontendOrigin = getDesktopOidcCallbackUrl(desktopCallbackPort);
      if (!frontendOrigin) {
        return res.status(400).json({ error: "Invalid desktop callback port" });
      }
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
      frontendOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
    } else {
      frontendOrigin = origin;
    }

    const settingsRepository = createCurrentSettingsRepository();
    await settingsRepository.set(`oidc_state_${state}`, nonce);
    await settingsRepository.set(
      `oidc_backend_callback_${state}`,
      backendCallbackUri,
    );
    await settingsRepository.set(
      `oidc_frontend_origin_${state}`,
      frontendOrigin,
    );
    await settingsRepository.set(
      `oidc_remember_me_${state}`,
      rememberMe === "true" ? "true" : "false",
    );

    if (providerDbId != null) {
      await settingsRepository.set(
        `oidc_provider_${state}`,
        String(providerDbId),
      );
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

  const settingsRepository = createCurrentSettingsRepository();
  const storedBackendCallback = await settingsRepository.get(
    `oidc_backend_callback_${state}`,
  );
  const storedFrontendOrigin = await settingsRepository.get(
    `oidc_frontend_origin_${state}`,
  );
  const storedRememberMeValue = await settingsRepository.get(
    `oidc_remember_me_${state}`,
  );

  if (!storedBackendCallback || !storedFrontendOrigin) {
    return res
      .status(400)
      .json({ error: "Invalid state parameter - redirect URIs not found" });
  }

  const backendCallbackUri = storedBackendCallback;
  const frontendOrigin = storedFrontendOrigin;
  const storedRememberMe = storedRememberMeValue === "true";

  try {
    const storedNonce = await settingsRepository.get(`oidc_state_${state}`);
    if (!storedNonce) {
      return res.status(400).json({ error: "Invalid state parameter" });
    }

    const storedProviderId = await settingsRepository.get(
      `oidc_provider_${state}`,
    );
    const callbackProviderId = storedProviderId
      ? parseInt(storedProviderId, 10)
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

    await settingsRepository.delete(`oidc_provider_${state}`);

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
      await deleteOIDCStateSettings(state);

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
      const userRepository = createCurrentUserRepository();

      let ghUserRecord =
        await userRepository.findByOidcIdentifier(ghIdentifier);
      if (!ghUserRecord) {
        const isFirstUser = (await userRepository.countAll()) === 0;

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
          ghAutoProvision = await settingsRepository.getBoolean(
            "oidc_auto_provision",
            false,
          );
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
        const createdUser = await userRepository.createFirstLocalUser({
          id: ghId,
          username: ghName,
          passwordHash: "",
          isOidc: true,
          oidcIdentifier: ghIdentifier,
          ssoProviderId: callbackProviderDbId,
        });
        ghUserRecord = createdUser.user;

        try {
          const defaultRoleName = createdUser.isFirstUser ? "admin" : "user";
          await createCurrentRoleRepository().assignRoleNameToUser({
            userId: ghId,
            roleName: defaultRoleName,
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
          await userRepository.delete(ghId);
          return res.status(500).json({
            error: "Failed to setup user security - user creation cancelled",
          });
        }
      }

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
      const ghIsTokenCallback = isOidcTokenCallback(frontendOrigin);
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

    await deleteOIDCStateSettings(state);

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
      userInfo = await verifyOIDCToken(
        tokenData.id_token as string,
        config.issuer_url,
        config.client_id,
        caCert,
      );

      const expectedNonce = storedNonce;
      if (userInfo.nonce !== expectedNonce) {
        authLogger.warn("OIDC ID token nonce mismatch", {
          operation: "oidc_nonce_mismatch",
          providerId: callbackProviderId,
        });
        return res.status(401).json({ error: "Invalid OIDC token nonce" });
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
    const userRepository = createCurrentUserRepository();
    let userRecord = await userRepository.findByOidcIdentifier(identifier);

    let isFirstUser = false;
    if (!userRecord) {
      isFirstUser = (await userRepository.countAll()) === 0;

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
        oidcAutoProvision = await settingsRepository.getBoolean(
          "oidc_auto_provision",
          false,
        );
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
      const createdUser = await userRepository.createFirstLocalUser({
        id,
        username: name,
        passwordHash: "",
        isOidc: true,
        oidcIdentifier: identifier,
        ssoProviderId: callbackProviderDbId,
      });
      isFirstUser = createdUser.isFirstUser;
      userRecord = createdUser.user;

      try {
        const defaultRoleName = isFirstUser ? "admin" : "user";
        const assigned =
          await createCurrentRoleRepository().assignRoleNameToUser({
            userId: id,
            roleName: defaultRoleName,
            grantedBy: id,
          });

        if (!assigned) {
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
        await userRepository.delete(id);
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
        await DatabaseSaveTrigger.forceSave("oidc_user_create_explicit_save");
      } catch (saveError) {
        authLogger.error("Failed to persist OIDC user to disk", saveError, {
          operation: "oidc_user_create_save_failed",
          userId: id,
        });
      }
    } else {
      if (config.allowed_users) {
        const email = userInfo.email as string | undefined;
        if (!isOIDCUserAllowed(config.allowed_users, identifier, email)) {
          authLogger.warn("OIDC user not in allowed list (existing user)", {
            operation: "oidc_user_not_allowed_existing",
            identifier,
            email,
            userId: userRecord.id,
          });
          const redirectUrl = new URL(frontendOrigin);
          redirectUrl.searchParams.set("error", "user_not_allowed");
          return res.redirect(redirectUrl.toString());
        }
      }

      const isDualAuth =
        userRecord.passwordHash && userRecord.passwordHash.trim() !== "";

      if (!isDualAuth) {
        userRecord =
          (await userRepository.update(userRecord.id, { username: name })) ??
          userRecord;
      }
    }

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
        userRecord =
          (await userRepository.update(userRecord.id, {
            isAdmin: shouldBeAdmin,
          })) ?? userRecord;
        try {
          const newRoleName = shouldBeAdmin ? "admin" : "user";
          const oldRoleName = shouldBeAdmin ? "user" : "admin";
          await createCurrentRoleRepository().switchUserRoleName({
            userId: userRecord.id,
            addRoleName: newRoleName,
            removeRoleName: oldRoleName,
            grantedBy: userRecord.id,
          });
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

    const oidcSub = typeof userInfo.sub === "string" ? userInfo.sub : null;
    const oidcSid = typeof userInfo.sid === "string" ? userInfo.sid : null;

    const token = await authManager.generateJWTToken(userRecord.id, {
      deviceType: deviceInfo.type,
      deviceInfo: deviceInfo.deviceInfo,
      rememberMe: storedRememberMe,
      oidcSub,
      oidcSid,
      ssoProviderId: callbackProviderDbId ?? null,
    });

    authLogger.success("OIDC login successful", {
      operation: "oidc_login_complete",
      userId: userRecord.id,
      username: userRecord.username,
    });

    const redirectUrl = new URL(frontendOrigin);
    redirectUrl.searchParams.set("success", "true");

    const isTokenCallback = isOidcTokenCallback(frontendOrigin);

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
    const userRecord =
      await createCurrentUserRepository().findByUsername(username);

    if (!userRecord) {
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

    const deviceInfo = parseUserAgent(req);

    let authenticated = false;
    if (userRecord.isOidc) {
      authenticated = await authManager.authenticateOIDCUser(
        userRecord.id,
        deviceInfo.type,
      );
    } else {
      authenticated = await authManager.authenticateUser(
        userRecord.id,
        password,
        deviceInfo.type,
      );
    }

    if (!authenticated) {
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

    const sessionTimeoutHoursValue =
      await createCurrentSettingsRepository().get("session_timeout_hours");
    const timeoutHours = sessionTimeoutHoursValue
      ? parseInt(sessionTimeoutHoursValue, 10) || 24
      : 24;
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

const seenLogoutJti = new Map<string, number>();
const LOGOUT_JTI_TTL_MS = 5 * 60 * 1000;

function pruneLogoutJti(now: number): void {
  for (const [key, expiry] of seenLogoutJti) {
    if (expiry <= now) seenLogoutJti.delete(key);
  }
}

function isReplayedJti(jti: string): boolean {
  const now = Date.now();
  pruneLogoutJti(now);
  return seenLogoutJti.has(jti);
}

function markLogoutJti(jti: string): void {
  const now = Date.now();
  pruneLogoutJti(now);
  seenLogoutJti.set(jti, now + LOGOUT_JTI_TTL_MS);
}

router.post("/oidc/backchannel-logout", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  try {
    const logoutToken = (req.body as Record<string, unknown> | undefined)
      ?.logout_token;
    if (typeof logoutToken !== "string" || !logoutToken) {
      return res.status(400).json({ error: "missing logout_token" });
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
      return res.status(400).json({ error: "invalid logout_token" });
    }

    const provider = await resolveProviderByIssuer(issuer);
    if (!provider) {
      authLogger.warn("Back-channel logout for unknown issuer", { issuer });
      return res.status(400).json({ error: "unknown issuer" });
    }

    const claims = await validateLogoutToken(logoutToken, provider.config);

    if (claims.jti && isReplayedJti(claims.jti)) {
      return res.status(200).json({ ok: true });
    }

    try {
      await authManager.revokeSessionsByOidc({
        ssoProviderId: provider.providerDbId,
        sub: claims.sub,
        sid: claims.sid,
      });
    } catch (err) {
      authLogger.error("OIDC back-channel session revocation failed", err);
      return res.status(500).json({ error: "logout processing failed" });
    }

    markLogoutJti(claims.jti);

    return res.status(200).json({ ok: true });
  } catch (err) {
    authLogger.error("OIDC back-channel logout failed", err);
    return res.status(400).json({ error: "invalid logout_token" });
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
    const user = await findCurrentUser(userId);
    if (!user) {
      authLogger.warn(`User not found for /users/me: ${userId}`);
      return res.status(401).json({ error: "User not found" });
    }

    const hasPassword = user.passwordHash && user.passwordHash.trim() !== "";
    const hasOidc = user.isOidc && user.oidcIdentifier;
    const isDualAuth = hasPassword && hasOidc;

    const showDonationModal = shouldShowDonationModal(
      user.registeredAt,
      !!user.donationModalDismissed,
    );

    res.json({
      userId: user.id,
      username: user.username,
      is_admin: !!user.isAdmin,
      is_oidc: !!user.isOidc,
      is_dual_auth: isDualAuth,
      totp_enabled: !!user.totpEnabled,
      show_donation_modal: showDonationModal,
    });
  } catch (err) {
    authLogger.error("Failed to get username", err);
    res.status(500).json({ error: "Failed to get username" });
  }
});

/**
 * @openapi
 * /users/me/dismiss-donation-modal:
 *   post:
 *     summary: Permanently dismiss the donation reminder modal
 *     description: Marks the donation reminder modal as dismissed for the currently authenticated user so it is never shown to them again.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Donation modal dismissed.
 *       401:
 *         description: Invalid userId or user not found.
 *       500:
 *         description: Failed to dismiss donation modal.
 */
router.post(
  "/me/dismiss-donation-modal",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    if (!isNonEmptyString(userId)) {
      return res.status(401).json({ error: "Invalid userId" });
    }
    try {
      const updated = await createCurrentUserRepository().update(userId, {
        donationModalDismissed: true,
      });
      if (!updated) {
        return res.status(401).json({ error: "User not found" });
      }
      return res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to dismiss donation modal", err);
      return res
        .status(500)
        .json({ error: "Failed to dismiss donation modal" });
    }
  },
);

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
    const count = await createCurrentUserRepository().countAll();

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
    const user = await requireCurrentAdmin(userId);
    if (!user) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const count = await createCurrentUserRepository().countAll();
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
    await createCurrentUserRepository().countAll();
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
    const user = await requireCurrentAdmin(userId);
    if (!user) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const { allowed } = req.body;
    if (typeof allowed !== "boolean") {
      return res.status(400).json({ error: "Invalid value for allowed" });
    }
    await createCurrentSettingsRepository().set(
      "allow_registration",
      allowed ? "true" : "false",
    );
    res.json({ allowed });
  } catch (err) {
    authLogger.error("Failed to set registration allowed", err);
    res.status(500).json({ error: "Failed to set registration allowed" });
  }
});

router.get("/oidc-auto-provision", async (_req, res) => {
  try {
    res.json({
      enabled: await createCurrentSettingsRepository().getBoolean(
        "oidc_auto_provision",
        false,
      ),
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
    const user = await requireCurrentAdmin(userId);
    if (!user) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const { enabled } = req.body;
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "Invalid value for enabled" });
    }
    await createCurrentSettingsRepository().set(
      "oidc_auto_provision",
      enabled ? "true" : "false",
    );
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
    res.json({
      enabled: await createCurrentSettingsRepository().getBoolean(
        "oidc_silent_login_default",
        false,
      ),
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
      const user = await requireCurrentAdmin(userId);
      if (!user) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "Invalid value for enabled" });
      }
      await createCurrentSettingsRepository().set(
        "oidc_silent_login_default",
        enabled ? "true" : "false",
      );
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
    const user = await requireCurrentAdmin(userId);
    if (!user) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const { allowed } = req.body;
    if (typeof allowed !== "boolean") {
      return res.status(400).json({ error: "Invalid value for allowed" });
    }
    if (!allowed) {
      const totpEnabledCount =
        await createCurrentUserRepository().countTotpEnabled();
      if (totpEnabledCount > 0) {
        return res.status(409).json({
          error:
            "Cannot disable password login while 2FA is enabled for one or more users. Disable 2FA first.",
        });
      }
    }
    await createCurrentSettingsRepository().set(
      "allow_password_login",
      allowed ? "true" : "false",
    );
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
    const user = await requireCurrentAdmin(userId);
    if (!user) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const { allowed } = req.body;
    if (typeof allowed !== "boolean") {
      return res.status(400).json({ error: "Invalid value for allowed" });
    }
    await createCurrentSettingsRepository().set(
      "allow_password_reset",
      allowed ? "true" : "false",
    );
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
    const userRecord = await findCurrentUser(userId);
    if (!userRecord) {
      return res.status(404).json({ error: "User not found" });
    }

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
      const adminCount = await createCurrentUserRepository().countAdmins();
      if (adminCount <= 1) {
        return res
          .status(403)
          .json({ error: "Cannot delete the last admin user" });
      }
    }

    await createCurrentUserRepository().delete(userId);

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

  const user = await findCurrentUser(userId);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const isMatch = await bcrypt.compare(oldPassword, user.passwordHash);
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
  await createCurrentUserRepository().update(userId, {
    passwordHash: password_hash,
  });

  authManager.logoutUser(userId);
  authLogger.success("Password changed successfully", {
    operation: "password_change_complete",
    userId,
  });

  const { ipAddress: pwIp, userAgent: pwUa } = getRequestMeta(req);
  await logAudit({
    userId,
    username: user.username ?? userId,
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
    const userRepository = createCurrentUserRepository();
    const adminUser = await userRepository.findById(userId);
    if (!adminUser?.isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }

    if (adminUser.username === username) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }

    const targetUser = await userRepository.findByUsername(username);
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (targetUser.isAdmin) {
      if ((await userRepository.countAdmins()) <= 1) {
        return res
          .status(403)
          .json({ error: "Cannot delete the last admin user" });
      }
    }

    const targetUserId = targetUser.id;

    await deleteUserAndRelatedData(targetUserId);

    authLogger.warn("User account deleted by admin", {
      operation: "admin_delete_user",
      adminId: userId,
      targetUserId,
      targetUsername: username,
    });

    const { ipAddress: deleteIp, userAgent: deleteUa } = getRequestMeta(req);
    await logAudit({
      userId,
      username: adminUser.username ?? userId,
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
