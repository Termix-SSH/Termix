import type { AuthenticatedRequest } from "../../../types/index.js";
import express, { type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { authLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { parseUserAgent } from "../../utils/user-agent-parser.js";
import { isOidcTokenCallback } from "../../utils/oidc-desktop-callback.js";
import { deleteUserAndRelatedData } from "./delete-user-data.js";
import {
  isLoopbackRequest,
  extractBearerOrCookieToken,
  isNativeTokenExportRequest,
  resolveDesktopAutoSessionUser,
} from "./desktop-auto-session.js";
import { shouldShowDonationModal } from "./donation-modal-utils.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import {
  getOIDCConfigFromEnv,
  loadProviderConfig,
  resolveProviderByIssuer,
  validateLogoutToken,
} from "./user-oidc-utils.js";
import { registerUserApiKeyRoutes } from "./user-api-key-routes.js";
import { registerUserImageStorageRoutes } from "./user-image-storage-routes.js";
import { registerBrandingRoutes } from "./branding-routes.js";
import { registerUserSettingsRoutes } from "./user-settings-routes.js";
import { registerTouchInputSettingsRoutes } from "./touch-input-settings-routes.js";
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
import { registerAuthRoutes } from "./auth-routes.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";
import {
  createCurrentSettingsRepository,
  getCurrentSettingValue,
  createCurrentRoleRepository,
  createCurrentSsoProviderRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";
import type { UserRecord } from "../repositories/user-repository.js";
import {
  getTrustedProxyAuthConfig,
  isTrustedProxyAddress,
  isTrustedProxyAuthEnabled,
  resolveTrustedProxyRoles,
} from "../../utils/trusted-proxy-auth.js";

import { getPasswordLoginStatus } from "../../auth/core-auth.js";
import { verifyPasswordLogin } from "../../auth/builtin-login-methods.js";
import {
  redirectWithLoginError,
  respondWithLogin,
  respondWithRedirectLogin,
  sendLoginError,
} from "../../auth/login-pipeline.js";
import {
  handleOidcCallback,
  RedirectLoginError,
  startOidcLogin,
} from "../../auth/legacy/oidc-login.js";
import { LoginMethodError } from "../../auth/types.js";
import {
  isNativeAppRequest,
  syncSharedCredentialsForUserRoles,
} from "../../auth/session-issuer.js";

const authManager = AuthManager.getInstance();

const router = express.Router();

router.use((req, res, next) => {
  if (isTrustedProxyAuthEnabled() && req.path.startsWith("/oidc")) {
    return res.status(409).json({
      error: "OIDC is disabled while trusted proxy authentication is enabled",
    });
  }
  next();
});

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

function getOidcSilentLoginDefaultFromEnv(): boolean | undefined {
  const envVal = process.env.OIDC_SILENT_LOGIN_DEFAULT;
  if (envVal === undefined) return undefined;
  return envVal.trim().toLowerCase() === "true";
}

async function findCurrentUser(userId: string): Promise<UserRecord | null> {
  return createCurrentUserRepository().findById(userId);
}

async function requireCurrentAdmin(userId: string): Promise<UserRecord | null> {
  const user = await findCurrentUser(userId);
  return user?.isAdmin ? user : null;
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
    res.json(await startOidcLogin(req));
  } catch (err) {
    if (err instanceof LoginMethodError) {
      return res.status(err.status).json({ error: err.message });
    }
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
  let identity;
  try {
    identity = await handleOidcCallback(req);
  } catch (error) {
    if (error instanceof RedirectLoginError) {
      return redirectWithLoginError(res, error.returnTo, error);
    }
    return sendLoginError(res, error);
  }
  await respondWithRedirectLogin(
    req,
    res,
    identity,
    { methodId: "oidc", rememberMe: !!identity.rememberMe },
    isOidcTokenCallback,
  );
});

/**
 * @openapi
 * /users/proxy-login:
 *   post:
 *     summary: Trusted proxy login
 *     description: Signs in the user named by a trusted reverse proxy's headers. Only answers requests from a configured proxy address.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Login successful.
 *       401:
 *         description: Proxy headers missing.
 *       403:
 *         description: Not a trusted proxy, or the user is not allowed.
 *       409:
 *         description: Trusted proxy login conflicts with OIDC or 2FA.
 *       503:
 *         description: Trusted proxy authentication is misconfigured.
 */
router.post("/proxy-login", async (req, res) => {
  let config;
  try {
    config = getTrustedProxyAuthConfig();
  } catch (error) {
    authLogger.error(
      "Invalid trusted proxy authentication configuration",
      error,
    );
    return res
      .status(503)
      .json({ error: "Proxy authentication is misconfigured" });
  }
  if (!config.enabled) return res.json({ enabled: false });

  const sourceAddress = req.socket.remoteAddress;
  try {
    if (!isTrustedProxyAddress(sourceAddress, config.trustedProxies)) {
      authLogger.warn(
        "Rejected proxy authentication from an untrusted source",
        {
          operation: "trusted_proxy_auth_rejected",
          sourceAddress,
        },
      );
      return res.status(403).json({ error: "Untrusted authentication proxy" });
    }
  } catch (error) {
    authLogger.error("Invalid trusted proxy allowlist", error);
    return res
      .status(503)
      .json({ error: "Proxy authentication is misconfigured" });
  }

  const usernameValue = req.headers[config.usernameHeader];
  const roleValue = req.headers[config.roleHeader];
  const username = Array.isArray(usernameValue)
    ? usernameValue[0]
    : usernameValue;
  const roleHeader = Array.isArray(roleValue) ? roleValue[0] : roleValue;
  if (!isNonEmptyString(username) || !isNonEmptyString(roleHeader)) {
    return res
      .status(401)
      .json({ error: "Proxy authentication headers are missing" });
  }

  const mappedRoles = resolveTrustedProxyRoles(roleHeader, config.roleMap);
  if (!mappedRoles) {
    return res.status(403).json({ error: "Proxy role is not mapped" });
  }

  try {
    const [legacyOidc, enabledProviders, userRecord] = await Promise.all([
      createCurrentSettingsRepository().get("oidc_config"),
      createCurrentSsoProviderRepository().listEnabled(),
      createCurrentUserRepository().findByUsername(username),
    ]);
    const hasOidc =
      Boolean(getOIDCConfigFromEnv() || legacyOidc) ||
      enabledProviders.some((provider) =>
        ["oidc", "github", "google"].includes(provider.type),
      );
    if (hasOidc) {
      return res
        .status(409)
        .json({ error: "Proxy authentication cannot be used with OIDC" });
    }
    if (!userRecord) {
      return res.status(403).json({ error: "Proxy user must already exist" });
    }
    if (userRecord.isOidc || userRecord.totpEnabled) {
      return res.status(409).json({
        error: "Proxy authentication cannot be used with OIDC or TOTP users",
      });
    }

    const roleRepository = createCurrentRoleRepository();
    const managedRoles = new Set([...config.roleMap.values()].flat());
    for (const roleName of managedRoles) {
      if (!(await roleRepository.findRoleByName(roleName))) {
        authLogger.error("Trusted proxy role map references a missing role", {
          operation: "trusted_proxy_auth_missing_role",
          roleName,
        });
        return res
          .status(503)
          .json({ error: "Proxy role mapping is misconfigured" });
      }
    }

    const currentRoles = await roleRepository.listUserRoles(userRecord.id);
    const currentNames = new Set(currentRoles.map((role) => role.roleName));
    for (const roleName of mappedRoles) {
      if (!currentNames.has(roleName)) {
        await roleRepository.assignRoleNameToUser({
          userId: userRecord.id,
          roleName,
          grantedBy: userRecord.id,
        });
      }
    }
    for (const role of currentRoles) {
      if (
        managedRoles.has(role.roleName) &&
        !mappedRoles.includes(role.roleName)
      ) {
        await roleRepository.removeRoleFromUser(userRecord.id, role.roleId);
      }
    }
    PermissionManager.getInstance().invalidateUserPermissionCache(
      userRecord.id,
    );

    const deviceInfo = parseUserAgent(req);
    if (
      !(await authManager.authenticateWebAuthnUser(
        userRecord.id,
        deviceInfo.type,
      ))
    ) {
      return res
        .status(409)
        .json({ error: "User encryption data is unavailable" });
    }
    await syncSharedCredentialsForUserRoles(
      userRecord.id,
      "trusted_proxy_login_role_shared_credentials",
    );
    const token = await authManager.generateJWTToken(userRecord.id, {
      deviceType: deviceInfo.type,
      deviceInfo: deviceInfo.deviceInfo,
    });
    const payload = await authManager.verifyJWTToken(token);
    const { ipAddress, userAgent } = getRequestMeta(req);
    await logAudit({
      userId: userRecord.id,
      username: userRecord.username,
      action: "trusted_proxy_login",
      resourceType: "session",
      ipAddress,
      userAgent,
      success: true,
    });
    authLogger.success("Trusted proxy login successful", {
      operation: "trusted_proxy_login",
      userId: userRecord.id,
      sessionId: payload?.sessionId,
      mappedRoles,
    });

    return res
      .cookie("jwt", token, authManager.getSecureCookieOptions(req))
      .json({
        enabled: true,
        success: true,
        username: userRecord.username,
        userId: userRecord.id,
        is_admin: !!userRecord.isAdmin,
        ...(isNativeAppRequest(req) ? { token } : {}),
      });
  } catch (error) {
    authLogger.error("Trusted proxy login failed", error);
    return res.status(500).json({ error: "Proxy authentication failed" });
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
  authLogger.info("User login request received", {
    operation: "user_login_request",
    username: req.body?.username,
  });
  try {
    const identity = await verifyPasswordLogin(req);
    await respondWithLogin(req, res, identity, {
      methodId: "password",
      rememberMe: !!req.body?.rememberMe,
    });
  } catch (error) {
    sendLoginError(res, error);
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
 *     description: Returns the JWT for the currently authenticated native Mobile or Desktop client. Browser sessions cannot export their HTTP-only cookie.
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
 *       403:
 *         description: Token export is not available to browser clients.
 */
router.get("/me/token", authenticateJWT, (req: Request, res: Response) => {
  if (!isNativeTokenExportRequest(req)) {
    return res
      .status(403)
      .json({ error: "Token export is limited to native clients" });
  }

  // authenticateJWT accepts either the jwt cookie or an Authorization:
  // Bearer header (see auth-manager.ts's createAuthMiddleware) -- this must
  // check both too, or a request that only carried the header (e.g. the
  // Electron renderer's own axios interceptor, which always attaches a
  // stored localStorage JWT as a Bearer header) would pass authentication
  // here but still get back a null token.
  res.json({ token: extractBearerOrCookieToken(req) ?? null });
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
 * /users/internal/auto-session:
 *   post:
 *     summary: Mint a session for the sole local desktop user
 *     description: Used by the Electron desktop app to skip the login form entirely when running standalone against the embedded local backend. Only available over loopback. Logs in as the sole local user regardless of its credentials; if the local database has more than one user (e.g. repeated manual registration), deterministically logs in as the admin account, or the earliest-registered account if none is admin -- a login form must never appear for the local backend under any circumstance. Only declines if zero local users exist at all, which normal desktop provisioning never produces. Provisions the resolved user's data-encryption key if missing before minting the session, matching every other login path -- self-heals an account that previously ended up with a valid session but no usable encryption key.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Session created.
 *       403:
 *         description: Forbidden, or no local users exist.
 *       500:
 *         description: Failed to create session.
 */
router.post("/internal/auto-session", async (req, res) => {
  try {
    if (!isLoopbackRequest(req)) {
      authLogger.warn(
        "Rejected non-loopback attempt to access auto-session endpoint",
        { source: req.ip },
      );
      return res.status(403).json({ error: "Forbidden" });
    }

    const userRepository = createCurrentUserRepository();
    const allUsers = await userRepository.listAll();
    const userRecord = resolveDesktopAutoSessionUser(allUsers);
    if (!userRecord) {
      return res.status(403).json({
        error: "No local users exist",
      });
    }
    await authManager.registerUser(userRecord.id);
    const existingToken = extractBearerOrCookieToken(req);
    if (existingToken) {
      const existingPayload = await authManager.verifyJWTToken(existingToken);
      if (existingPayload?.userId === userRecord.id) {
        return res.json({
          success: true,
          is_admin: !!userRecord.isAdmin,
          username: userRecord.username,
          token: existingToken,
        });
      }
    }

    const token = await authManager.generateJWTToken(userRecord.id, {
      deviceType: "desktop",
      deviceInfo: "Termix Desktop (local)",
      rememberMe: true,
    });

    const response = {
      success: true,
      is_admin: !!userRecord.isAdmin,
      username: userRecord.username,
      token,
    };

    return res
      .cookie(
        "jwt",
        token,
        authManager.getSecureCookieOptions(req, 30 * 24 * 60 * 60 * 1000),
      )
      .json(response);
  } catch (err) {
    authLogger.error("Failed to create auto-session", err);
    res.status(500).json({ error: "Failed to create auto-session" });
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
 *     description: Returns whether silent OIDC login is enabled as the default behavior. Can be pinned via the OIDC_SILENT_LOGIN_DEFAULT env var.
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
    const envVal = getOidcSilentLoginDefaultFromEnv();
    if (envVal !== undefined) {
      res.json({ enabled: envVal, locked: true });
      return;
    }
    res.json({
      enabled: await createCurrentSettingsRepository().getBoolean(
        "oidc_silent_login_default",
        false,
      ),
      locked: false,
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
 *       409:
 *         description: Setting is pinned by the OIDC_SILENT_LOGIN_DEFAULT env var.
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
      if (getOidcSilentLoginDefaultFromEnv() !== undefined) {
        return res.status(409).json({
          error:
            "OIDC silent login default is set via the OIDC_SILENT_LOGIN_DEFAULT env var and cannot be changed here",
        });
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
    const status = await getPasswordLoginStatus();
    res.json({ allowed: status.allowed, forced: status.forced });
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

    // Inherit rather than drop: the deleting admin takes over the hosts and
    // credentials unless another successor is named; "none" discards them.
    const { successorUserId: requestedSuccessor } = req.body ?? {};
    let successorUserId: string | undefined = userId;
    if (requestedSuccessor === "none") {
      successorUserId = undefined;
    } else if (isNonEmptyString(requestedSuccessor)) {
      const successor = await userRepository.findById(requestedSuccessor);
      if (!successor || successor.id === targetUserId) {
        return res.status(400).json({ error: "Invalid successor user" });
      }
      successorUserId = successor.id;
    }

    await deleteUserAndRelatedData(targetUserId, { successorUserId });

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
registerTouchInputSettingsRoutes(router, authenticateJWT);
registerAcmeSSLRoutes(router, authenticateJWT);

registerUserApiKeyRoutes(router, requireAdmin);
registerUserImageStorageRoutes(router, requireAdmin);
registerBrandingRoutes(router, requireAdmin);

registerSSOProviderRoutes(router);
registerLDAPAuthRoutes(router);
registerAuthRoutes(router);

export default router;
