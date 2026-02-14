import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import crypto from "crypto";
import { db } from "../db/index.js";
import {
  users,
  sessions,
  sshData,
  sshCredentials,
  fileManagerRecent,
  fileManagerPinned,
  fileManagerShortcuts,
  dismissedAlerts,
  settings,
  sshCredentialUsage,
  recentActivity,
  snippets,
  snippetFolders,
  sshFolders,
  commandHistory,
  roles,
  userRoles,
  hostAccess,
  sharedCredentials,
  auditLogs,
  sessionRecordings,
  networkTopology,
  dashboardPreferences,
  opksshTokens,
} from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import type { Request, Response } from "express";
import { authLogger, databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { LazyFieldEncryption } from "../../utils/lazy-field-encryption.js";
import { parseUserAgent } from "../../utils/user-agent-parser.js";
import { loginRateLimiter } from "../../utils/login-rate-limiter.js";

const authManager = AuthManager.getInstance();

/**
 * Get OIDC configuration from environment variables.
 * Returns null if required env vars are not set.
 */
function getOIDCConfigFromEnv(): {
  client_id: string;
  client_secret: string;
  issuer_url: string;
  authorization_url: string;
  token_url: string;
  userinfo_url: string;
  identifier_path: string;
  name_path: string;
  scopes: string;
} | null {
  const client_id = process.env.OIDC_CLIENT_ID;
  const client_secret = process.env.OIDC_CLIENT_SECRET;
  const issuer_url = process.env.OIDC_ISSUER_URL;
  const authorization_url = process.env.OIDC_AUTHORIZATION_URL;
  const token_url = process.env.OIDC_TOKEN_URL;

  if (
    !client_id ||
    !client_secret ||
    !issuer_url ||
    !authorization_url ||
    !token_url
  ) {
    return null;
  }

  return {
    client_id,
    client_secret,
    issuer_url,
    authorization_url,
    token_url,
    userinfo_url: process.env.OIDC_USERINFO_URL || "",
    identifier_path: process.env.OIDC_IDENTIFIER_PATH || "sub",
    name_path: process.env.OIDC_NAME_PATH || "name",
    scopes: process.env.OIDC_SCOPES || "openid email profile",
  };
}

async function verifyOIDCToken(
  idToken: string,
  issuerUrl: string,
  clientId: string,
): Promise<Record<string, unknown>> {
  const normalizedIssuerUrl = issuerUrl.endsWith("/")
    ? issuerUrl.slice(0, -1)
    : issuerUrl;
  const possibleIssuers = [
    issuerUrl,
    normalizedIssuerUrl,
    issuerUrl.replace(/\/application\/o\/[^/]+$/, ""),
    normalizedIssuerUrl.replace(/\/application\/o\/[^/]+$/, ""),
  ];

  const jwksUrls = [
    `${normalizedIssuerUrl}/.well-known/jwks.json`,
    `${normalizedIssuerUrl}/jwks/`,
    `${normalizedIssuerUrl.replace(/\/application\/o\/[^/]+$/, "")}/.well-known/jwks.json`,
  ];

  try {
    const discoveryUrl = `${normalizedIssuerUrl}/.well-known/openid-configuration`;
    const discoveryResponse = await fetch(discoveryUrl);
    if (discoveryResponse.ok) {
      const discovery = (await discoveryResponse.json()) as Record<
        string,
        unknown
      >;
      if (discovery.jwks_uri) {
        jwksUrls.unshift(discovery.jwks_uri as string);
      }
    }
  } catch (discoveryError) {
    authLogger.error(`OIDC discovery failed: ${discoveryError}`);
  }

  let jwks: Record<string, unknown> | null = null;

  for (const url of jwksUrls) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const jwksData = (await response.json()) as Record<string, unknown>;
        if (jwksData && jwksData.keys && Array.isArray(jwksData.keys)) {
          jwks = jwksData;
          break;
        } else {
          authLogger.error(
            `Invalid JWKS structure from ${url}: ${JSON.stringify(jwksData)}`,
          );
        }
      } else {
      }
    } catch {
      continue;
    }
  }

  if (!jwks) {
    throw new Error("Failed to fetch JWKS from any URL");
  }

  if (!jwks.keys || !Array.isArray(jwks.keys)) {
    throw new Error(
      `Invalid JWKS response structure. Expected 'keys' array, got: ${JSON.stringify(jwks)}`,
    );
  }

  const header = JSON.parse(
    Buffer.from(idToken.split(".")[0], "base64").toString(),
  );
  const keyId = header.kid;

  const publicKey = jwks.keys.find(
    (key: Record<string, unknown>) => key.kid === keyId,
  );
  if (!publicKey) {
    throw new Error(
      `No matching public key found for key ID: ${keyId}. Available keys: ${jwks.keys.map((k: Record<string, unknown>) => k.kid).join(", ")}`,
    );
  }

  const { importJWK, jwtVerify } = await import("jose");
  const key = await importJWK(publicKey);

  const { payload } = await jwtVerify(idToken, key, {
    issuer: possibleIssuers,
    audience: clientId,
  });

  return payload;
}

const router = express.Router();

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

const authenticateJWT = authManager.createAuthMiddleware();
const requireAdmin = authManager.createAdminMiddleware();

async function deleteUserAndRelatedData(userId: string): Promise<void> {
  try {
    await db
      .delete(sharedCredentials)
      .where(eq(sharedCredentials.targetUserId, userId));

    await db
      .delete(sessionRecordings)
      .where(eq(sessionRecordings.userId, userId));

    await db.delete(hostAccess).where(eq(hostAccess.userId, userId));
    await db.delete(hostAccess).where(eq(hostAccess.grantedBy, userId));

    await db.delete(sessions).where(eq(sessions.userId, userId));

    await db.delete(userRoles).where(eq(userRoles.userId, userId));
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));

    await db
      .delete(sshCredentialUsage)
      .where(eq(sshCredentialUsage.userId, userId));

    await db
      .delete(fileManagerRecent)
      .where(eq(fileManagerRecent.userId, userId));
    await db
      .delete(fileManagerPinned)
      .where(eq(fileManagerPinned.userId, userId));
    await db
      .delete(fileManagerShortcuts)
      .where(eq(fileManagerShortcuts.userId, userId));

    await db.delete(recentActivity).where(eq(recentActivity.userId, userId));
    await db.delete(dismissedAlerts).where(eq(dismissedAlerts.userId, userId));

    await db.delete(snippets).where(eq(snippets.userId, userId));
    await db.delete(snippetFolders).where(eq(snippetFolders.userId, userId));

    await db.delete(sshFolders).where(eq(sshFolders.userId, userId));

    await db.delete(commandHistory).where(eq(commandHistory.userId, userId));

    await db.delete(sshData).where(eq(sshData.userId, userId));
    await db.delete(sshCredentials).where(eq(sshCredentials.userId, userId));

    await db
      .delete(networkTopology)
      .where(eq(networkTopology.userId, userId));
    await db
      .delete(dashboardPreferences)
      .where(eq(dashboardPreferences.userId, userId));
    await db.delete(opksshTokens).where(eq(opksshTokens.userId, userId));

    db.$client
      .prepare("DELETE FROM settings WHERE key LIKE ?")
      .run(`user_%_${userId}`);

    await db.delete(users).where(eq(users.id, userId));

    authLogger.success("User and all related data deleted successfully", {
      operation: "delete_user_and_related_data_complete",
      userId,
    });
  } catch (error) {
    authLogger.error("Failed to delete user and related data", error, {
      operation: "delete_user_and_related_data_failed",
      userId,
    });
    throw error;
  }
}

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
  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'allow_registration'")
      .get();
    if (row && (row as Record<string, unknown>).value !== "true") {
      return res
        .status(403)
        .json({ error: "Registration is currently disabled" });
    }
  } catch (e) {
    authLogger.warn("Failed to check registration status", {
      operation: "registration_check",
      error: e,
    });
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

    let isFirstUser = false;
    const countResult = db.$client
      .prepare("SELECT COUNT(*) as count FROM users")
      .get();
    isFirstUser = ((countResult as { count?: number })?.count || 0) === 0;

    const saltRounds = parseInt(process.env.SALT || "10", 10);
    const password_hash = await bcrypt.hash(password, saltRounds);
    const id = nanoid();
    await db.insert(users).values({
      id,
      username,
      password_hash,
      is_admin: isFirstUser,
      is_oidc: false,
      client_id: "",
      client_secret: "",
      issuer_url: "",
      authorization_url: "",
      token_url: "",
      identifier_path: "",
      name_path: "",
      scopes: "openid email profile",
      totp_secret: null,
      totp_enabled: false,
      totp_backup_codes: null,
    });

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
    if (!user || user.length === 0 || !user[0].is_admin) {
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
    if (!user || user.length === 0 || !user[0].is_admin) {
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
router.get("/oidc-config", async (req, res) => {
  try {
    const envConfig = getOIDCConfigFromEnv();
    if (envConfig) {
      return res.json({
        client_id: envConfig.client_id,
        issuer_url: envConfig.issuer_url,
        authorization_url: envConfig.authorization_url,
        scopes: envConfig.scopes,
      });
    }

    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'oidc_config'")
      .get();
    if (!row) {
      return res.json(null);
    }

    const config = JSON.parse((row as Record<string, unknown>).value as string);

    const publicConfig = {
      client_id: config.client_id,
      issuer_url: config.issuer_url,
      authorization_url: config.authorization_url,
      scopes: config.scopes,
    };

    return res.json(publicConfig);
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
      return res.json(null);
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
      } catch (decryptError) {
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
      } catch (decodeError) {
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
    const envConfig = getOIDCConfigFromEnv();
    let config;

    if (envConfig) {
      config = envConfig;
    } else {
      const row = db.$client
        .prepare("SELECT value FROM settings WHERE key = 'oidc_config'")
        .get();
      if (!row) {
        return res.status(404).json({ error: "OIDC not configured" });
      }
      config = JSON.parse((row as Record<string, unknown>).value as string);
    }
    const state = nanoid();
    const nonce = nanoid();

    let origin =
      req.get("Origin") ||
      req.get("Referer")?.replace(/\/[^/]*$/, "") ||
      "http://localhost:5173";

    if (origin.includes("localhost")) {
      origin = "http://localhost:30001";
    }

    const redirectUri = `${origin}/users/oidc/callback`;

    db.$client
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(`oidc_state_${state}`, nonce);

    db.$client
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(`oidc_redirect_${state}`, redirectUri);

    const authUrl = new URL(config.authorization_url);
    authUrl.searchParams.set("client_id", config.client_id);
    authUrl.searchParams.set("redirect_uri", redirectUri);
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
  authLogger.info("OIDC login callback received", {
    operation: "oidc_login_request",
    state,
  });

  if (!isNonEmptyString(code) || !isNonEmptyString(state)) {
    return res.status(400).json({ error: "Code and state are required" });
  }

  const storedRedirectRow = db.$client
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(`oidc_redirect_${state}`);
  if (!storedRedirectRow) {
    return res
      .status(400)
      .json({ error: "Invalid state parameter - redirect URI not found" });
  }
  const redirectUri = (storedRedirectRow as Record<string, unknown>)
    .value as string;

  try {
    const storedNonce = db.$client
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(`oidc_state_${state}`);
    if (!storedNonce) {
      return res.status(400).json({ error: "Invalid state parameter" });
    }

    db.$client
      .prepare("DELETE FROM settings WHERE key = ?")
      .run(`oidc_state_${state}`);
    db.$client
      .prepare("DELETE FROM settings WHERE key = ?")
      .run(`oidc_redirect_${state}`);

    const envConfig = getOIDCConfigFromEnv();
    let config;

    if (envConfig) {
      config = envConfig;
    } else {
      const configRow = db.$client
        .prepare("SELECT value FROM settings WHERE key = 'oidc_config'")
        .get();
      if (!configRow) {
        return res.status(500).json({ error: "OIDC not configured" });
      }
      config = JSON.parse(
        (configRow as Record<string, unknown>).value as string,
      );
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
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      authLogger.error(
        "OIDC token exchange failed",
        await tokenResponse.text(),
      );
      return res
        .status(400)
        .json({ error: "Failed to exchange authorization code" });
    }

    const tokenData = (await tokenResponse.json()) as Record<string, unknown>;

    let userInfo: Record<string, unknown> = null;
    const userInfoUrls: string[] = [];

    const normalizedIssuerUrl = config.issuer_url.endsWith("/")
      ? config.issuer_url.slice(0, -1)
      : config.issuer_url;
    const baseUrl = normalizedIssuerUrl.replace(/\/application\/o\/[^/]+$/, "");

    try {
      const discoveryUrl = `${normalizedIssuerUrl}/.well-known/openid-configuration`;
      const discoveryResponse = await fetch(discoveryUrl);
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

    if (!userInfo && tokenData.access_token) {
      for (const userInfoUrl of userInfoUrls) {
        try {
          const userInfoResponse = await fetch(userInfoUrl, {
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
            },
          });

          if (userInfoResponse.ok) {
            userInfo = (await userInfoResponse.json()) as Record<
              string,
              unknown
            >;
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
      .where(eq(users.oidc_identifier, identifier));

    let isFirstUser = false;
    if (!user || user.length === 0) {
      const countResult = db.$client
        .prepare("SELECT COUNT(*) as count FROM users")
        .get();
      isFirstUser = ((countResult as { count?: number })?.count || 0) === 0;

      if (!isFirstUser) {
        try {
          const regRow = db.$client
            .prepare(
              "SELECT value FROM settings WHERE key = 'allow_registration'",
            )
            .get();
          if (regRow && (regRow as Record<string, unknown>).value !== "true") {
            authLogger.warn(
              "OIDC user attempted to register when registration is disabled",
              {
                operation: "oidc_registration_disabled",
                identifier,
                name,
              },
            );

            let frontendUrl = (redirectUri as string).replace(
              "/users/oidc/callback",
              "",
            );
            if (frontendUrl.includes("localhost")) {
              frontendUrl = "http://localhost:5173";
            }
            const redirectUrl = new URL(frontendUrl);
            redirectUrl.searchParams.set("error", "registration_disabled");

            return res.redirect(redirectUrl.toString());
          }
        } catch (e) {
          authLogger.warn("Failed to check registration status during OIDC", {
            operation: "oidc_registration_check",
            error: e,
          });
        }
      }

      const id = nanoid();
      await db.insert(users).values({
        id,
        username: name,
        password_hash: "",
        is_admin: isFirstUser,
        is_oidc: true,
        oidc_identifier: identifier,
        client_id: String(config.client_id),
        client_secret: String(config.client_secret),
        issuer_url: String(config.issuer_url),
        authorization_url: String(config.authorization_url),
        token_url: String(config.token_url),
        identifier_path: String(config.identifier_path),
        name_path: String(config.name_path),
        scopes: String(config.scopes),
      });

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
            : 7 * 24 * 60 * 60 * 1000;
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
      const isDualAuth =
        user[0].password_hash && user[0].password_hash.trim() !== "";

      if (!isDualAuth) {
        await db
          .update(users)
          .set({ username: name })
          .where(eq(users.id, user[0].id));
      }

      user = await db.select().from(users).where(eq(users.id, user[0].id));
    }

    const userRecord = user[0];

    try {
      await authManager.authenticateOIDCUser(userRecord.id, deviceInfo.type);
    } catch (setupError) {
      authLogger.error("Failed to setup OIDC user encryption", setupError, {
        operation: "oidc_user_encryption_setup_failed",
        userId: userRecord.id,
      });
    }

    const token = await authManager.generateJWTToken(userRecord.id, {
      deviceType: deviceInfo.type,
      deviceInfo: deviceInfo.deviceInfo,
    });

    authLogger.success("OIDC login successful", {
      operation: "oidc_login_complete",
      userId: userRecord.id,
      username: userRecord.username,
    });

    let frontendUrl = (redirectUri as string).replace(
      "/users/oidc/callback",
      "",
    );

    if (frontendUrl.includes("localhost")) {
      frontendUrl = "http://localhost:5173";
    }

    const redirectUrl = new URL(frontendUrl);
    redirectUrl.searchParams.set("success", "true");

    const maxAge =
      deviceInfo.type === "desktop" || deviceInfo.type === "mobile"
        ? 30 * 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;

    res.clearCookie("jwt", authManager.getClearCookieOptions(req));

    return res
      .cookie("jwt", token, authManager.getSecureCookieOptions(req, maxAge))
      .redirect(redirectUrl.toString());
  } catch (err) {
    authLogger.error("OIDC callback failed", err);

    let frontendUrl = (redirectUri as string).replace(
      "/users/oidc/callback",
      "",
    );

    if (frontendUrl.includes("localhost")) {
      frontendUrl = "http://localhost:5173";
    }

    const redirectUrl = new URL(frontendUrl);
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
  const { username, password } = req.body;
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

  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'allow_password_login'")
      .get();
    if (row && (row as { value: string }).value !== "true") {
      return res
        .status(403)
        .json({ error: "Password authentication is currently disabled" });
    }
  } catch (e) {
    authLogger.error("Failed to check password login status", {
      operation: "login_check",
      error: e,
    });
    return res.status(500).json({ error: "Failed to check login status" });
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
      userRecord.is_oidc &&
      (!userRecord.password_hash || userRecord.password_hash.trim() === "")
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

    const isMatch = await bcrypt.compare(password, userRecord.password_hash);
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
    } catch (error) {}

    const deviceInfo = parseUserAgent(req);

    let dataUnlocked = false;
    if (userRecord.is_oidc) {
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

    try {
      const { SharedCredentialManager } =
        await import("../../utils/shared-credential-manager.js");
      const sharedCredManager = SharedCredentialManager.getInstance();
      await sharedCredManager.reEncryptPendingCredentialsForUser(userRecord.id);
    } catch (error) {
      authLogger.warn("Failed to re-encrypt pending shared credentials", {
        operation: "reencrypt_pending_credentials",
        userId: userRecord.id,
        error,
      });
    }

    if (userRecord.totp_enabled) {
      const tempToken = await authManager.generateJWTToken(userRecord.id, {
        pendingTOTP: true,
        expiresIn: "10m",
      });
      return res.json({
        success: true,
        requires_totp: true,
        temp_token: tempToken,
      });
    }

    const token = await authManager.generateJWTToken(userRecord.id, {
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

    const response: Record<string, unknown> = {
      success: true,
      is_admin: !!userRecord.is_admin,
      username: userRecord.username,
    };

    const isElectron =
      req.headers["x-electron-app"] === "true" ||
      req.headers["X-Electron-App"] === "true";

    if (isElectron) {
      response.token = token;
    }

    const maxAge =
      deviceInfo.type === "desktop" || deviceInfo.type === "mobile"
        ? 30 * 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;

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
      const token =
        req.cookies?.jwt || req.headers["authorization"]?.split(" ")[1];
      let sessionId: string | undefined;

      if (token) {
        try {
          const payload = await authManager.verifyJWTToken(token);
          sessionId = payload?.sessionId;
        } catch (error) {}
      }

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
      user[0].password_hash && user[0].password_hash.trim() !== "";
    const hasOidc = user[0].is_oidc && user[0].oidc_identifier;
    const isDualAuth = hasPassword && hasOidc;

    res.json({
      userId: user[0].id,
      username: user[0].username,
      is_admin: !!user[0].is_admin,
      is_oidc: !!user[0].is_oidc,
      is_dual_auth: isDualAuth,
      totp_enabled: !!user[0].totp_enabled,
    });
  } catch (err) {
    authLogger.error("Failed to get username", err);
    res.status(500).json({ error: "Failed to get username" });
  }
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
    if (!user[0] || !user[0].is_admin) {
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
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'allow_registration'")
      .get();
    res.json({
      allowed: row ? (row as Record<string, unknown>).value === "true" : true,
    });
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
    if (!user || user.length === 0 || !user[0].is_admin) {
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
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'allow_password_login'")
      .get();
    res.json({
      allowed: row ? (row as { value: string }).value === "true" : true,
    });
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
    if (!user || user.length === 0 || !user[0].is_admin) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const { allowed } = req.body;
    if (typeof allowed !== "boolean") {
      return res.status(400).json({ error: "Invalid value for allowed" });
    }
    db.$client
      .prepare(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('allow_password_login', ?)",
      )
      .run(allowed ? "true" : "false");
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
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'allow_password_reset'")
      .get();
    res.json({
      allowed: row ? (row as { value: string }).value === "true" : true,
    });
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
    if (!user || user.length === 0 || !user[0].is_admin) {
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

    if (userRecord.is_oidc) {
      return res.status(403).json({
        error:
          "Cannot delete external authentication accounts through this endpoint",
      });
    }

    const isMatch = await bcrypt.compare(password, userRecord.password_hash);
    if (!isMatch) {
      authLogger.warn(
        `Incorrect password provided for account deletion: ${userRecord.username}`,
      );
      return res.status(401).json({ error: "Incorrect password" });
    }

    if (userRecord.is_admin) {
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

/**
 * @openapi
 * /users/initiate-reset:
 *   post:
 *     summary: Initiate password reset
 *     description: Initiates the password reset process for a user.
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
 *         description: Password reset code has been generated.
 *       400:
 *         description: Username is required.
 *       403:
 *         description: Password reset not available for external authentication users.
 *       404:
 *         description: User not found.
 *       500:
 *         description: Failed to initiate password reset.
 */
router.post("/initiate-reset", async (req, res) => {
  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'allow_password_reset'")
      .get();
    if (row && (row as { value: string }).value !== "true") {
      return res
        .status(403)
        .json({ error: "Password reset is currently disabled" });
    }
  } catch (e) {
    authLogger.warn("Failed to check password reset status", {
      operation: "password_reset_check",
      error: e,
    });
  }

  const { username } = req.body;

  if (!isNonEmptyString(username)) {
    return res.status(400).json({ error: "Username is required" });
  }

  try {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.username, username));

    if (!user || user.length === 0) {
      authLogger.warn(
        `Password reset attempted for non-existent user: ${username}`,
      );
      return res.status(404).json({ error: "User not found" });
    }

    if (user[0].is_oidc) {
      return res.status(403).json({
        error: "Password reset not available for external authentication users",
      });
    }

    const resetCode = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    db.$client
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(
        `reset_code_${username}`,
        JSON.stringify({ code: resetCode, expiresAt: expiresAt.toISOString() }),
      );

    authLogger.info(
      `Password reset code for user ${username}: ${resetCode} (expires at ${expiresAt.toLocaleString()})`,
    );

    res.json({
      message:
        "Password reset code has been generated and logged. Check docker logs for the code.",
    });
  } catch (err) {
    authLogger.error("Failed to initiate password reset", err);
    res.status(500).json({ error: "Failed to initiate password reset" });
  }
});

/**
 * @openapi
 * /users/verify-reset-code:
 *   post:
 *     summary: Verify reset code
 *     description: Verifies the password reset code.
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
 *               resetCode:
 *                 type: string
 *     responses:
 *       200:
 *         description: Reset code verified.
 *       400:
 *         description: Invalid or expired reset code.
 *       500:
 *         description: Failed to verify reset code.
 */
router.post("/verify-reset-code", async (req, res) => {
  const { username, resetCode } = req.body;

  if (!isNonEmptyString(username) || !isNonEmptyString(resetCode)) {
    return res
      .status(400)
      .json({ error: "Username and reset code are required" });
  }

  try {
    const lockStatus = loginRateLimiter.isResetCodeLocked(username);
    if (lockStatus.locked) {
      authLogger.warn("Reset code verification blocked due to rate limiting", {
        operation: "reset_code_verify_blocked",
        username,
        remainingTime: lockStatus.remainingTime,
      });
      return res.status(429).json({
        error: `Rate limited: Too many verification attempts. Please wait ${lockStatus.remainingTime} seconds before trying again.`,
        remainingTime: lockStatus.remainingTime,
        code: "RESET_CODE_RATE_LIMITED",
      });
    }

    loginRateLimiter.recordResetCodeAttempt(username);

    const resetDataRow = db.$client
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(`reset_code_${username}`);
    if (!resetDataRow) {
      authLogger.warn("Reset code verification failed - no code found", {
        operation: "reset_code_verify_failed",
        username,
        remainingAttempts:
          loginRateLimiter.getRemainingResetCodeAttempts(username),
      });
      return res.status(400).json({
        error: "No reset code found for this user",
        remainingAttempts:
          loginRateLimiter.getRemainingResetCodeAttempts(username),
      });
    }

    const resetData = JSON.parse(
      (resetDataRow as Record<string, unknown>).value as string,
    );
    const now = new Date();
    const expiresAt = new Date(resetData.expiresAt);

    if (now > expiresAt) {
      db.$client
        .prepare("DELETE FROM settings WHERE key = ?")
        .run(`reset_code_${username}`);
      authLogger.warn("Reset code verification failed - code expired", {
        operation: "reset_code_verify_failed",
        username,
        remainingAttempts:
          loginRateLimiter.getRemainingResetCodeAttempts(username),
      });
      return res.status(400).json({
        error: "Reset code has expired",
        remainingAttempts:
          loginRateLimiter.getRemainingResetCodeAttempts(username),
      });
    }

    if (resetData.code !== resetCode) {
      authLogger.warn("Reset code verification failed - invalid code", {
        operation: "reset_code_verify_failed",
        username,
        remainingAttempts:
          loginRateLimiter.getRemainingResetCodeAttempts(username),
      });
      return res.status(400).json({
        error: "Invalid reset code",
        remainingAttempts:
          loginRateLimiter.getRemainingResetCodeAttempts(username),
      });
    }

    loginRateLimiter.resetResetCodeAttempts(username);

    const tempToken = nanoid();
    const tempTokenExpiry = new Date(Date.now() + 10 * 60 * 1000);

    db.$client
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(
        `temp_reset_token_${username}`,
        JSON.stringify({
          token: tempToken,
          expiresAt: tempTokenExpiry.toISOString(),
        }),
      );

    res.json({ message: "Reset code verified", tempToken });
  } catch (err) {
    authLogger.error("Failed to verify reset code", err);
    res.status(500).json({ error: "Failed to verify reset code" });
  }
});

/**
 * @openapi
 * /users/complete-reset:
 *   post:
 *     summary: Complete password reset
 *     description: Completes the password reset process with a new password.
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
 *               tempToken:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password has been successfully reset.
 *       400:
 *         description: Invalid or expired temporary token.
 *       404:
 *         description: User not found.
 *       500:
 *         description: Failed to complete password reset.
 */
router.post("/complete-reset", async (req, res) => {
  const { username, tempToken, newPassword } = req.body;

  if (
    !isNonEmptyString(username) ||
    !isNonEmptyString(tempToken) ||
    !isNonEmptyString(newPassword)
  ) {
    return res.status(400).json({
      error: "Username, temporary token, and new password are required",
    });
  }

  try {
    const tempTokenRow = db.$client
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(`temp_reset_token_${username}`);
    if (!tempTokenRow) {
      return res.status(400).json({ error: "No temporary token found" });
    }

    const tempTokenData = JSON.parse(
      (tempTokenRow as Record<string, unknown>).value as string,
    );
    const now = new Date();
    const expiresAt = new Date(tempTokenData.expiresAt);

    if (now > expiresAt) {
      db.$client
        .prepare("DELETE FROM settings WHERE key = ?")
        .run(`temp_reset_token_${username}`);
      return res.status(400).json({ error: "Temporary token has expired" });
    }

    if (tempTokenData.token !== tempToken) {
      return res.status(400).json({ error: "Invalid temporary token" });
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    if (!user || user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const userId = user[0].id;

    const saltRounds = parseInt(process.env.SALT || "10", 10);
    const password_hash = await bcrypt.hash(newPassword, saltRounds);

    let userIdFromJwt: string | null = null;
    const cookie = req.cookies?.jwt;
    let header: string | undefined;
    if (req.headers?.authorization?.startsWith("Bearer ")) {
      header = req.headers?.authorization?.split(" ")[1];
    }
    const token = cookie || header;

    if (token) {
      const payload = await authManager.verifyJWTToken(token);
      if (payload) {
        userIdFromJwt = payload.userId;
      }
    }

    if (userIdFromJwt === userId) {
      try {
        const success = await authManager.resetUserPasswordWithPreservedDEK(
          userId,
          newPassword,
        );

        if (!success) {
          throw new Error("Failed to re-encrypt user data with new password.");
        }

        await db
          .update(users)
          .set({ password_hash })
          .where(eq(users.id, userId));
        authManager.logoutUser(userId);
        authLogger.success(
          `Password reset (data preserved) for user: ${username}`,
          {
            operation: "password_reset_preserved",
            userId,
            username,
          },
        );
      } catch (encryptionError) {
        authLogger.error(
          "Failed to setup user data encryption after password reset",
          encryptionError,
          {
            operation: "password_reset_encryption_failed_preserved",
            userId,
            username,
          },
        );
        return res.status(500).json({
          error: "Password reset failed. Please contact administrator.",
        });
      }
    } else {
      await db
        .update(users)
        .set({ password_hash })
        .where(eq(users.username, username));

      try {
        await db
          .delete(sshCredentialUsage)
          .where(eq(sshCredentialUsage.userId, userId));
        await db
          .delete(fileManagerRecent)
          .where(eq(fileManagerRecent.userId, userId));
        await db
          .delete(fileManagerPinned)
          .where(eq(fileManagerPinned.userId, userId));
        await db
          .delete(fileManagerShortcuts)
          .where(eq(fileManagerShortcuts.userId, userId));
        await db
          .delete(recentActivity)
          .where(eq(recentActivity.userId, userId));
        await db
          .delete(dismissedAlerts)
          .where(eq(dismissedAlerts.userId, userId));
        await db.delete(snippets).where(eq(snippets.userId, userId));
        await db.delete(sshData).where(eq(sshData.userId, userId));
        await db
          .delete(sshCredentials)
          .where(eq(sshCredentials.userId, userId));

        await authManager.registerUser(userId, newPassword);
        authManager.logoutUser(userId);

        await db
          .update(users)
          .set({
            totp_enabled: false,
            totp_secret: null,
            totp_backup_codes: null,
          })
          .where(eq(users.id, userId));

        authLogger.warn(
          `Password reset completed for user: ${username}. All encrypted data has been deleted due to lost encryption key.`,
          {
            operation: "password_reset_data_deleted",
            userId,
            username,
          },
        );
      } catch (encryptionError) {
        authLogger.error(
          "Failed to setup user data encryption after password reset",
          encryptionError,
          {
            operation: "password_reset_encryption_failed",
            userId,
            username,
          },
        );
        return res.status(500).json({
          error: "Password reset failed. Please contact administrator.",
        });
      }
    }

    authLogger.success(`Password successfully reset for user: ${username}`);

    db.$client
      .prepare("DELETE FROM settings WHERE key = ?")
      .run(`reset_code_${username}`);
    db.$client
      .prepare("DELETE FROM settings WHERE key = ?")
      .run(`temp_reset_token_${username}`);

    res.json({ message: "Password has been successfully reset" });
  } catch (err) {
    authLogger.error("Failed to complete password reset", err);
    res.status(500).json({ error: "Failed to complete password reset" });
  }
});

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

  const isMatch = await bcrypt.compare(oldPassword, user[0].password_hash);
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

  const saltRounds = parseInt(process.env.SALT || "10", 10);
  const password_hash = await bcrypt.hash(newPassword, saltRounds);
  await db.update(users).set({ password_hash }).where(eq(users.id, userId));

  authManager.logoutUser(userId);
  authLogger.success("Password changed successfully", {
    operation: "password_change_complete",
    userId,
  });

  res.json({ message: "Password changed successfully. Please log in again." });
});

/**
 * @openapi
 * /users/list:
 *   get:
 *     summary: List all users
 *     description: Retrieves a list of all users in the system.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: A list of users.
 *       403:
 *         description: Not authorized.
 *       500:
 *         description: Failed to list users.
 */
router.get("/list", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0 || !user[0].is_admin) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const allUsers = await db
      .select({
        id: users.id,
        username: users.username,
        is_admin: users.is_admin,
        is_oidc: users.is_oidc,
        password_hash: users.password_hash,
      })
      .from(users);

    res.json({ users: allUsers });
  } catch (err) {
    authLogger.error("Failed to list users", err);
    res.status(500).json({ error: "Failed to list users" });
  }
});

/**
 * @openapi
 * /users/make-admin:
 *   post:
 *     summary: Make user admin
 *     description: Grants admin privileges to a user.
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
 *         description: User is now an admin.
 *       400:
 *         description: Username is required or user is already an admin.
 *       403:
 *         description: Not authorized.
 *       404:
 *         description: User not found.
 *       500:
 *         description: Failed to make user admin.
 */
router.post("/make-admin", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { username } = req.body;

  if (!isNonEmptyString(username)) {
    return res.status(400).json({ error: "Username is required" });
  }

  try {
    const adminUser = await db.select().from(users).where(eq(users.id, userId));
    if (!adminUser || adminUser.length === 0 || !adminUser[0].is_admin) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const targetUser = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    if (!targetUser || targetUser.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    if (targetUser[0].is_admin) {
      return res.status(400).json({ error: "User is already an admin" });
    }

    await db
      .update(users)
      .set({ is_admin: true })
      .where(eq(users.username, username));

    try {
      const { saveMemoryDatabaseToFile } = await import("../db/index.js");
      await saveMemoryDatabaseToFile();
    } catch (saveError) {
      authLogger.error("Failed to persist admin promotion to disk", saveError, {
        operation: "make_admin_save_failed",
        username,
      });
    }

    authLogger.info("Admin privileges granted", {
      operation: "admin_grant",
      adminId: userId,
      targetUserId: targetUser[0].id,
      targetUsername: username,
    });
    res.json({ message: `User ${username} is now an admin` });
  } catch (err) {
    authLogger.error("Failed to make user admin", err);
    res.status(500).json({ error: "Failed to make user admin" });
  }
});

/**
 * @openapi
 * /users/remove-admin:
 *   post:
 *     summary: Remove admin status
 *     description: Revokes admin privileges from a user.
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
 *         description: Admin status removed from user.
 *       400:
 *         description: Username is required or cannot remove your own admin status.
 *       403:
 *         description: Not authorized.
 *       404:
 *         description: User not found.
 *       500:
 *         description: Failed to remove admin status.
 */
router.post("/remove-admin", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { username } = req.body;

  if (!isNonEmptyString(username)) {
    return res.status(400).json({ error: "Username is required" });
  }

  try {
    const adminUser = await db.select().from(users).where(eq(users.id, userId));
    if (!adminUser || adminUser.length === 0 || !adminUser[0].is_admin) {
      return res.status(403).json({ error: "Not authorized" });
    }

    if (adminUser[0].username === username) {
      return res
        .status(400)
        .json({ error: "Cannot remove your own admin status" });
    }

    const targetUser = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    if (!targetUser || targetUser.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!targetUser[0].is_admin) {
      return res.status(400).json({ error: "User is not an admin" });
    }

    await db
      .update(users)
      .set({ is_admin: false })
      .where(eq(users.username, username));

    try {
      const { saveMemoryDatabaseToFile } = await import("../db/index.js");
      await saveMemoryDatabaseToFile();
    } catch (saveError) {
      authLogger.error("Failed to persist admin removal to disk", saveError, {
        operation: "remove_admin_save_failed",
        username,
      });
    }

    authLogger.info("Admin privileges revoked", {
      operation: "admin_revoke",
      adminId: userId,
      targetUserId: targetUser[0].id,
      targetUsername: username,
    });
    res.json({ message: `Admin status removed from ${username}` });
  } catch (err) {
    authLogger.error("Failed to remove admin status", err);
    res.status(500).json({ error: "Failed to remove admin status" });
  }
});

/**
 * @openapi
 * /users/totp/setup:
 *   post:
 *     summary: Setup TOTP
 *     description: Initiates TOTP setup by generating a secret and QR code.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: TOTP setup initiated with secret and QR code.
 *       400:
 *         description: TOTP is already enabled.
 *       404:
 *         description: User not found.
 *       500:
 *         description: Failed to setup TOTP.
 */
router.post("/totp/setup", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userRecord = user[0];

    if (userRecord.totp_enabled) {
      return res.status(400).json({ error: "TOTP is already enabled" });
    }

    const secret = speakeasy.generateSecret({
      name: `Termix (${userRecord.username})`,
      length: 32,
    });

    await db
      .update(users)
      .set({ totp_secret: secret.base32 })
      .where(eq(users.id, userId));

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url || "");

    res.json({
      secret: secret.base32,
      qr_code: qrCodeUrl,
    });
  } catch (err) {
    authLogger.error("Failed to setup TOTP", err);
    res.status(500).json({ error: "Failed to setup TOTP" });
  }
});

/**
 * @openapi
 * /users/totp/enable:
 *   post:
 *     summary: Enable TOTP
 *     description: Enables TOTP after verifying the initial code.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               totp_code:
 *                 type: string
 *     responses:
 *       200:
 *         description: TOTP enabled successfully with backup codes.
 *       400:
 *         description: TOTP code is required or TOTP already enabled.
 *       401:
 *         description: Invalid TOTP code.
 *       404:
 *         description: User not found.
 *       500:
 *         description: Failed to enable TOTP.
 */
router.post("/totp/enable", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { totp_code } = req.body;

  if (!totp_code) {
    return res.status(400).json({ error: "TOTP code is required" });
  }

  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userRecord = user[0];

    if (userRecord.totp_enabled) {
      return res.status(400).json({ error: "TOTP is already enabled" });
    }

    if (!userRecord.totp_secret) {
      return res.status(400).json({ error: "TOTP setup not initiated" });
    }

    const verified = speakeasy.totp.verify({
      secret: userRecord.totp_secret,
      encoding: "base32",
      token: totp_code,
      window: 2,
    });

    if (!verified) {
      return res.status(401).json({ error: "Invalid TOTP code" });
    }

    const backupCodes = Array.from({ length: 8 }, () =>
      Math.random().toString(36).substring(2, 10).toUpperCase(),
    );

    await db
      .update(users)
      .set({
        totp_enabled: true,
        totp_backup_codes: JSON.stringify(backupCodes),
      })
      .where(eq(users.id, userId));
    authLogger.info("Two-factor authentication enabled", {
      operation: "totp_enable",
      userId,
    });

    res.json({
      message: "TOTP enabled successfully",
      backup_codes: backupCodes,
    });
  } catch (err) {
    authLogger.error("Failed to enable TOTP", err);
    res.status(500).json({ error: "Failed to enable TOTP" });
  }
});

/**
 * @openapi
 * /users/totp/disable:
 *   post:
 *     summary: Disable TOTP
 *     description: Disables TOTP for a user.
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
 *               totp_code:
 *                 type: string
 *     responses:
 *       200:
 *         description: TOTP disabled successfully.
 *       400:
 *         description: Password or TOTP code is required.
 *       401:
 *         description: Incorrect password or invalid TOTP code.
 *       404:
 *         description: User not found.
 *       500:
 *         description: Failed to disable TOTP.
 */
router.post("/totp/disable", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { password, totp_code } = req.body;

  if (!password && !totp_code) {
    return res.status(400).json({ error: "Password or TOTP code is required" });
  }

  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userRecord = user[0];

    if (!userRecord.totp_enabled) {
      return res.status(400).json({ error: "TOTP is not enabled" });
    }

    if (password && !userRecord.is_oidc) {
      const isMatch = await bcrypt.compare(password, userRecord.password_hash);
      if (!isMatch) {
        return res.status(401).json({ error: "Incorrect password" });
      }
    } else if (totp_code) {
      const verified = speakeasy.totp.verify({
        secret: userRecord.totp_secret!,
        encoding: "base32",
        token: totp_code,
        window: 2,
      });

      if (!verified) {
        return res.status(401).json({ error: "Invalid TOTP code" });
      }
    } else {
      return res.status(400).json({ error: "Authentication required" });
    }

    await db
      .update(users)
      .set({
        totp_enabled: false,
        totp_secret: null,
        totp_backup_codes: null,
      })
      .where(eq(users.id, userId));
    authLogger.info("Two-factor authentication disabled", {
      operation: "totp_disable",
      userId,
    });

    res.json({ message: "TOTP disabled successfully" });
  } catch (err) {
    authLogger.error("Failed to disable TOTP", err);
    res.status(500).json({ error: "Failed to disable TOTP" });
  }
});

/**
 * @openapi
 * /users/totp/backup-codes:
 *   post:
 *     summary: Generate new backup codes
 *     description: Generates new TOTP backup codes.
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
 *               totp_code:
 *                 type: string
 *     responses:
 *       200:
 *         description: New backup codes generated.
 *       400:
 *         description: Password or TOTP code is required.
 *       401:
 *         description: Incorrect password or invalid TOTP code.
 *       404:
 *         description: User not found.
 *       500:
 *         description: Failed to generate backup codes.
 */
router.post("/totp/backup-codes", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { password, totp_code } = req.body;

  if (!password && !totp_code) {
    return res.status(400).json({ error: "Password or TOTP code is required" });
  }

  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userRecord = user[0];

    if (!userRecord.totp_enabled) {
      return res.status(400).json({ error: "TOTP is not enabled" });
    }

    if (password && !userRecord.is_oidc) {
      const isMatch = await bcrypt.compare(password, userRecord.password_hash);
      if (!isMatch) {
        return res.status(401).json({ error: "Incorrect password" });
      }
    } else if (totp_code) {
      const verified = speakeasy.totp.verify({
        secret: userRecord.totp_secret!,
        encoding: "base32",
        token: totp_code,
        window: 2,
      });

      if (!verified) {
        return res.status(401).json({ error: "Invalid TOTP code" });
      }
    } else {
      return res.status(400).json({ error: "Authentication required" });
    }

    const backupCodes = Array.from({ length: 8 }, () =>
      Math.random().toString(36).substring(2, 10).toUpperCase(),
    );

    await db
      .update(users)
      .set({ totp_backup_codes: JSON.stringify(backupCodes) })
      .where(eq(users.id, userId));

    res.json({ backup_codes: backupCodes });
  } catch (err) {
    authLogger.error("Failed to generate backup codes", err);
    res.status(500).json({ error: "Failed to generate backup codes" });
  }
});

/**
 * @openapi
 * /users/totp/verify-login:
 *   post:
 *     summary: Verify TOTP during login
 *     description: Verifies the TOTP code during login.
 *     tags:
 *       - Users
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
 *     responses:
 *       200:
 *         description: TOTP verification successful.
 *       400:
 *         description: Token and TOTP code are required.
 *       401:
 *         description: Invalid temporary token or TOTP code.
 *       404:
 *         description: User not found.
 *       500:
 *         description: TOTP verification failed.
 */
router.post("/totp/verify-login", async (req, res) => {
  const { temp_token, totp_code } = req.body;

  if (!temp_token || !totp_code) {
    return res.status(400).json({ error: "Token and TOTP code are required" });
  }

  try {
    const decoded = await authManager.verifyJWTToken(temp_token);
    if (!decoded || !decoded.pendingTOTP) {
      return res.status(401).json({ error: "Invalid temporary token" });
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, decoded.userId));
    if (!user || user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userRecord = user[0];

    const lockStatus = loginRateLimiter.isTOTPLocked(userRecord.id);
    if (lockStatus.locked) {
      authLogger.warn("TOTP verification blocked due to rate limiting", {
        operation: "totp_verify_blocked",
        userId: userRecord.id,
        remainingTime: lockStatus.remainingTime,
      });
      return res.status(429).json({
        error: `Rate limited: Too many TOTP verification attempts. Please wait ${lockStatus.remainingTime} seconds before trying again.`,
        remainingTime: lockStatus.remainingTime,
        code: "TOTP_RATE_LIMITED",
      });
    }

    loginRateLimiter.recordFailedTOTPAttempt(userRecord.id);

    if (!userRecord.totp_enabled || !userRecord.totp_secret) {
      return res.status(400).json({ error: "TOTP not enabled for this user" });
    }

    const userDataKey = authManager.getUserDataKey(userRecord.id);
    if (!userDataKey) {
      return res.status(401).json({
        error: "Session expired - please log in again",
        code: "SESSION_EXPIRED",
      });
    }

    const totpSecret = LazyFieldEncryption.safeGetFieldValue(
      userRecord.totp_secret,
      userDataKey,
      userRecord.id,
      "totp_secret",
    );

    if (!totpSecret) {
      await db
        .update(users)
        .set({
          totp_enabled: false,
          totp_secret: null,
          totp_backup_codes: null,
        })
        .where(eq(users.id, userRecord.id));

      return res.status(400).json({
        error:
          "TOTP has been disabled due to password reset. Please set up TOTP again.",
      });
    }

    const verified = speakeasy.totp.verify({
      secret: totpSecret,
      encoding: "base32",
      token: totp_code,
      window: 2,
    });

    if (!verified) {
      let backupCodes = [];
      try {
        backupCodes = userRecord.totp_backup_codes
          ? JSON.parse(userRecord.totp_backup_codes)
          : [];
      } catch {
        backupCodes = [];
      }

      if (!Array.isArray(backupCodes)) {
        backupCodes = [];
      }

      const backupIndex = backupCodes.indexOf(totp_code);

      if (backupIndex === -1) {
        authLogger.warn("TOTP verification failed - invalid code", {
          operation: "totp_verify_failed",
          userId: userRecord.id,
          remainingAttempts: loginRateLimiter.getRemainingTOTPAttempts(
            userRecord.id,
          ),
        });
        return res.status(401).json({
          error: "Invalid TOTP code",
          remainingAttempts: loginRateLimiter.getRemainingTOTPAttempts(
            userRecord.id,
          ),
        });
      }

      backupCodes.splice(backupIndex, 1);
      await db
        .update(users)
        .set({ totp_backup_codes: JSON.stringify(backupCodes) })
        .where(eq(users.id, userRecord.id));
    }

    loginRateLimiter.resetTOTPAttempts(userRecord.id);

    const deviceInfo = parseUserAgent(req);
    const token = await authManager.generateJWTToken(userRecord.id, {
      deviceType: deviceInfo.type,
      deviceInfo: deviceInfo.deviceInfo,
    });

    const isElectron =
      req.headers["x-electron-app"] === "true" ||
      req.headers["X-Electron-App"] === "true";

    authLogger.success("TOTP verification successful", {
      operation: "totp_verify_success",
      userId: userRecord.id,
      deviceType: deviceInfo.type,
      deviceInfo: deviceInfo.deviceInfo,
    });

    const response: Record<string, unknown> = {
      success: true,
      is_admin: !!userRecord.is_admin,
      username: userRecord.username,
      userId: userRecord.id,
      is_oidc: !!userRecord.is_oidc,
      totp_enabled: !!userRecord.totp_enabled,
    };

    if (isElectron) {
      response.token = token;
    }

    const maxAge =
      deviceInfo.type === "desktop" || deviceInfo.type === "mobile"
        ? 30 * 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;

    return res
      .cookie("jwt", token, authManager.getSecureCookieOptions(req, maxAge))
      .json(response);
  } catch (err) {
    authLogger.error("TOTP verification failed", err);
    return res.status(500).json({ error: "TOTP verification failed" });
  }
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
    if (!adminUser || adminUser.length === 0 || !adminUser[0].is_admin) {
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

    if (targetUser[0].is_admin) {
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

/**
 * @openapi
 * /users/unlock-data:
 *   post:
 *     summary: Unlock user data
 *     description: Re-authenticates user with password to unlock encrypted data.
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
 *         description: Data unlocked successfully.
 *       400:
 *         description: Password is required.
 *       401:
 *         description: Invalid password.
 *       500:
 *         description: Failed to unlock data.
 */
router.post("/unlock-data", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: "Password is required" });
  }

  try {
    const unlocked = await authManager.authenticateUser(userId, password);
    if (unlocked) {
      res.json({
        success: true,
        message: "Data unlocked successfully",
      });
    } else {
      authLogger.warn("Failed to unlock user data - invalid password", {
        operation: "user_data_unlock_failed",
        userId,
      });
      res.status(401).json({ error: "Invalid password" });
    }
  } catch (err) {
    authLogger.error("Data unlock failed", err, {
      operation: "user_data_unlock_error",
      userId,
    });
    res.status(500).json({ error: "Failed to unlock data" });
  }
});

/**
 * @openapi
 * /users/data-status:
 *   get:
 *     summary: Check user data unlock status
 *     description: Checks if user data is currently unlocked.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Data status returned.
 *       500:
 *         description: Failed to check data status.
 */
router.get("/data-status", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  try {
    res.json({
      unlocked: true,
      message: "Data is unlocked",
    });
  } catch (err) {
    authLogger.error("Failed to check data status", err, {
      operation: "data_status_check_failed",
      userId,
    });
    res.status(500).json({ error: "Failed to check data status" });
  }
});

/**
 * @openapi
 * /users/sessions:
 *   get:
 *     summary: Get sessions
 *     description: Retrieves all sessions for authenticated user (or all sessions for admins).
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Sessions list returned.
 *       404:
 *         description: User not found.
 *       500:
 *         description: Failed to get sessions.
 */
router.get("/sessions", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userRecord = user[0];
    let sessionList;

    if (userRecord.is_admin) {
      sessionList = await authManager.getAllSessions();

      const enrichedSessions = await Promise.all(
        sessionList.map(async (session) => {
          const sessionUser = await db
            .select({ username: users.username })
            .from(users)
            .where(eq(users.id, session.userId))
            .limit(1);

          return {
            ...session,
            username: sessionUser[0]?.username || "Unknown",
          };
        }),
      );

      return res.json({ sessions: enrichedSessions });
    } else {
      sessionList = await authManager.getUserSessions(userId);
      return res.json({ sessions: sessionList });
    }
  } catch (err) {
    authLogger.error("Failed to get sessions", err);
    res.status(500).json({ error: "Failed to get sessions" });
  }
});

/**
 * @openapi
 * /users/sessions/{sessionId}:
 *   delete:
 *     summary: Revoke a specific session
 *     description: Revokes a specific session by ID.
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: The session ID to revoke
 *     responses:
 *       200:
 *         description: Session revoked successfully.
 *       400:
 *         description: Session ID is required.
 *       403:
 *         description: Not authorized to revoke this session.
 *       404:
 *         description: Session not found.
 *       500:
 *         description: Failed to revoke session.
 */
router.delete("/sessions/:sessionId", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const sessionId = Array.isArray(req.params.sessionId)
    ? req.params.sessionId[0]
    : req.params.sessionId;

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userRecord = user[0];

    const sessionRecords = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (sessionRecords.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    const session = sessionRecords[0];

    if (!userRecord.is_admin && session.userId !== userId) {
      return res
        .status(403)
        .json({ error: "Not authorized to revoke this session" });
    }

    const success = await authManager.revokeSession(sessionId);

    if (success) {
      authLogger.success("Session revoked", {
        operation: "session_revoke",
        sessionId,
        revokedBy: userId,
        sessionUserId: session.userId,
      });
      res.json({ success: true, message: "Session revoked successfully" });
    } else {
      res.status(500).json({ error: "Failed to revoke session" });
    }
  } catch (err) {
    authLogger.error("Failed to revoke session", err);
    res.status(500).json({ error: "Failed to revoke session" });
  }
});

/**
 * @openapi
 * /users/sessions/revoke-all:
 *   post:
 *     summary: Revoke all sessions for a user
 *     description: Revokes all sessions with option to exclude current session.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               targetUserId:
 *                 type: string
 *               exceptCurrent:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Sessions revoked successfully.
 *       403:
 *         description: Not authorized to revoke sessions for other users.
 *       404:
 *         description: User not found.
 *       500:
 *         description: Failed to revoke sessions.
 */
router.post("/sessions/revoke-all", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { targetUserId, exceptCurrent } = req.body;

  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userRecord = user[0];

    let revokeUserId = userId;
    if (targetUserId && userRecord.is_admin) {
      revokeUserId = targetUserId;
    } else if (targetUserId && targetUserId !== userId) {
      return res.status(403).json({
        error: "Not authorized to revoke sessions for other users",
      });
    }

    let currentSessionId: string | undefined;
    if (exceptCurrent) {
      const token =
        req.cookies?.jwt || req.headers?.authorization?.split(" ")[1];
      if (token) {
        const payload = await authManager.verifyJWTToken(token);
        currentSessionId = payload?.sessionId;
      }
    }

    const revokedCount = await authManager.revokeAllUserSessions(
      revokeUserId,
      currentSessionId,
    );

    authLogger.success("User sessions revoked", {
      operation: "user_sessions_revoke_all",
      revokeUserId,
      revokedBy: userId,
      exceptCurrent,
      revokedCount,
    });

    res.json({
      message: `${revokedCount} session(s) revoked successfully`,
      count: revokedCount,
    });
  } catch (err) {
    authLogger.error("Failed to revoke user sessions", err);
    res.status(500).json({ error: "Failed to revoke sessions" });
  }
});

/**
 * @openapi
 * /users/link-oidc-to-password:
 *   post:
 *     summary: Link OIDC user to password account
 *     description: Merges an OIDC-only account into a password-based account (admin only).
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               oidcUserId:
 *                 type: string
 *               targetUsername:
 *                 type: string
 *     responses:
 *       200:
 *         description: Accounts linked successfully.
 *       400:
 *         description: Invalid request or incompatible accounts.
 *       403:
 *         description: Admin access required.
 *       404:
 *         description: User not found.
 *       500:
 *         description: Failed to link accounts.
 */
router.post("/link-oidc-to-password", authenticateJWT, async (req, res) => {
  const adminUserId = (req as AuthenticatedRequest).userId;
  const { oidcUserId, targetUsername } = req.body;

  if (!isNonEmptyString(oidcUserId) || !isNonEmptyString(targetUsername)) {
    return res.status(400).json({
      error: "OIDC user ID and target username are required",
    });
  }

  try {
    const adminUser = await db
      .select()
      .from(users)
      .where(eq(users.id, adminUserId));
    if (!adminUser || adminUser.length === 0 || !adminUser[0].is_admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const oidcUserRecords = await db
      .select()
      .from(users)
      .where(eq(users.id, oidcUserId));
    if (!oidcUserRecords || oidcUserRecords.length === 0) {
      return res.status(404).json({ error: "OIDC user not found" });
    }

    const oidcUser = oidcUserRecords[0];

    if (!oidcUser.is_oidc) {
      return res.status(400).json({
        error: "Source user is not an OIDC user",
      });
    }

    const targetUserRecords = await db
      .select()
      .from(users)
      .where(eq(users.username, targetUsername));
    if (!targetUserRecords || targetUserRecords.length === 0) {
      return res.status(404).json({ error: "Target password user not found" });
    }

    const targetUser = targetUserRecords[0];

    if (targetUser.is_oidc || !targetUser.password_hash) {
      return res.status(400).json({
        error: "Target user must be a password-based account",
      });
    }

    if (targetUser.client_id && targetUser.oidc_identifier) {
      return res.status(400).json({
        error: "Target user already has OIDC authentication configured",
      });
    }

    authLogger.info("Linking OIDC user to password account", {
      operation: "link_oidc_to_password",
      oidcUserId,
      oidcUsername: oidcUser.username,
      targetUserId: targetUser.id,
      targetUsername: targetUser.username,
      adminUserId,
    });

    await db
      .update(users)
      .set({
        is_oidc: true,
        oidc_identifier: oidcUser.oidc_identifier,
        client_id: oidcUser.client_id,
        client_secret: oidcUser.client_secret,
        issuer_url: oidcUser.issuer_url,
        authorization_url: oidcUser.authorization_url,
        token_url: oidcUser.token_url,
        identifier_path: oidcUser.identifier_path,
        name_path: oidcUser.name_path,
        scopes: oidcUser.scopes || "openid email profile",
      })
      .where(eq(users.id, targetUser.id));

    try {
      await authManager.convertToOIDCEncryption(targetUser.id);
    } catch (encryptionError) {
      authLogger.error(
        "Failed to convert encryption to OIDC during linking",
        encryptionError,
        {
          operation: "link_convert_encryption_failed",
          userId: targetUser.id,
        },
      );
      await db
        .update(users)
        .set({
          is_oidc: false,
          oidc_identifier: null,
          client_id: "",
          client_secret: "",
          issuer_url: "",
          authorization_url: "",
          token_url: "",
          identifier_path: "",
          name_path: "",
          scopes: "openid email profile",
        })
        .where(eq(users.id, targetUser.id));

      return res.status(500).json({
        error:
          "Failed to convert encryption for dual-auth. Please ensure the password account has encryption setup.",
        details:
          encryptionError instanceof Error
            ? encryptionError.message
            : "Unknown error",
      });
    }

    await authManager.revokeAllUserSessions(oidcUserId);
    authManager.logoutUser(oidcUserId);

    await deleteUserAndRelatedData(oidcUserId);

    try {
      const { saveMemoryDatabaseToFile } = await import("../db/index.js");
      await saveMemoryDatabaseToFile();
    } catch (saveError) {
      authLogger.error("Failed to persist account linking to disk", saveError, {
        operation: "link_oidc_save_failed",
        oidcUserId,
        targetUserId: targetUser.id,
      });
    }

    authLogger.success(
      `OIDC user ${oidcUser.username} linked to password account ${targetUser.username}`,
      {
        operation: "link_oidc_to_password_success",
        oidcUserId,
        oidcUsername: oidcUser.username,
        targetUserId: targetUser.id,
        targetUsername: targetUser.username,
        adminUserId,
      },
    );

    res.json({
      success: true,
      message: `OIDC user ${oidcUser.username} has been linked to ${targetUser.username}. The password account can now use both password and OIDC login.`,
    });
  } catch (err) {
    authLogger.error("Failed to link OIDC user to password account", err, {
      operation: "link_oidc_to_password_failed",
      oidcUserId,
      targetUsername,
      adminUserId,
    });
    res.status(500).json({
      error: "Failed to link accounts",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * @openapi
 * /users/unlink-oidc-from-password:
 *   post:
 *     summary: Unlink OIDC from password account
 *     description: Removes OIDC authentication from a dual-auth account (admin only).
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *     responses:
 *       200:
 *         description: OIDC unlinked successfully.
 *       400:
 *         description: Invalid request or user doesn't have OIDC.
 *       403:
 *         description: Admin privileges required.
 *       404:
 *         description: User not found.
 *       500:
 *         description: Failed to unlink OIDC.
 */
router.post("/unlink-oidc-from-password", authenticateJWT, async (req, res) => {
  const adminUserId = (req as AuthenticatedRequest).userId;
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({
      error: "User ID is required",
    });
  }

  try {
    const adminUser = await db
      .select()
      .from(users)
      .where(eq(users.id, adminUserId));

    if (!adminUser || adminUser.length === 0 || !adminUser[0].is_admin) {
      authLogger.warn("Non-admin attempted to unlink OIDC from password", {
        operation: "unlink_oidc_unauthorized",
        adminUserId,
        targetUserId: userId,
      });
      return res.status(403).json({
        error: "Admin privileges required",
      });
    }

    const targetUserRecords = await db
      .select()
      .from(users)
      .where(eq(users.id, userId));

    if (!targetUserRecords || targetUserRecords.length === 0) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const targetUser = targetUserRecords[0];

    if (!targetUser.is_oidc) {
      return res.status(400).json({
        error: "User does not have OIDC authentication enabled",
      });
    }

    if (!targetUser.password_hash || targetUser.password_hash === "") {
      return res.status(400).json({
        error:
          "Cannot unlink OIDC from a user without password authentication. This would leave the user unable to login.",
      });
    }

    authLogger.info("Unlinking OIDC from password account", {
      operation: "unlink_oidc_from_password_start",
      targetUserId: targetUser.id,
      targetUsername: targetUser.username,
      adminUserId,
    });

    await db
      .update(users)
      .set({
        is_oidc: false,
        oidc_identifier: null,
        client_id: "",
        client_secret: "",
        issuer_url: "",
        authorization_url: "",
        token_url: "",
        identifier_path: "",
        name_path: "",
        scopes: "openid email profile",
      })
      .where(eq(users.id, targetUser.id));

    try {
      const { saveMemoryDatabaseToFile } = await import("../db/index.js");
      await saveMemoryDatabaseToFile();
    } catch (saveError) {
      authLogger.error(
        "Failed to save database after unlinking OIDC",
        saveError,
        {
          operation: "unlink_oidc_save_failed",
          targetUserId: targetUser.id,
        },
      );
    }

    authLogger.success("OIDC unlinked from password account successfully", {
      operation: "unlink_oidc_from_password_success",
      targetUserId: targetUser.id,
      targetUsername: targetUser.username,
      adminUserId,
    });

    res.json({
      success: true,
      message: `OIDC authentication has been removed from ${targetUser.username}. User can now only login with password.`,
    });
  } catch (err) {
    authLogger.error("Failed to unlink OIDC from password account", err, {
      operation: "unlink_oidc_from_password_failed",
      targetUserId: userId,
      adminUserId,
    });
    res.status(500).json({
      error: "Failed to unlink OIDC",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export default router;
