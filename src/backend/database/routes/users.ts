import express from "express";
import crypto from "crypto";
import { db } from "../db/index.js";
import {
  users,
  sshData,
  fileManagerRecent,
  fileManagerPinned,
  fileManagerShortcuts,
  dismissedAlerts,
  settings,
} from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import type { Request, Response } from "express";
import { authLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { UserCrypto } from "../../utils/user-crypto.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { LazyFieldEncryption } from "../../utils/lazy-field-encryption.js";

const authManager = AuthManager.getInstance();

async function verifyOIDCToken(
  idToken: string,
  issuerUrl: string,
  clientId: string,
): Promise<any> {
  try {
    const normalizedIssuerUrl = issuerUrl.endsWith("/")
      ? issuerUrl.slice(0, -1)
      : issuerUrl;
    const possibleIssuers = [
      issuerUrl,
      normalizedIssuerUrl,
      issuerUrl.replace(/\/application\/o\/[^\/]+$/, ""),
      normalizedIssuerUrl.replace(/\/application\/o\/[^\/]+$/, ""),
    ];

    const jwksUrls = [
      `${normalizedIssuerUrl}/.well-known/jwks.json`,
      `${normalizedIssuerUrl}/jwks/`,
      `${normalizedIssuerUrl.replace(/\/application\/o\/[^\/]+$/, "")}/.well-known/jwks.json`,
    ];

    try {
      const discoveryUrl = `${normalizedIssuerUrl}/.well-known/openid-configuration`;
      const discoveryResponse = await fetch(discoveryUrl);
      if (discoveryResponse.ok) {
        const discovery = (await discoveryResponse.json()) as any;
        if (discovery.jwks_uri) {
          jwksUrls.unshift(discovery.jwks_uri);
        }
      }
    } catch (discoveryError) {
      authLogger.error(`OIDC discovery failed: ${discoveryError}`);
    }

    let jwks: any = null;
    let jwksUrl: string | null = null;

    for (const url of jwksUrls) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const jwksData = (await response.json()) as any;
          if (jwksData && jwksData.keys && Array.isArray(jwksData.keys)) {
            jwks = jwksData;
            jwksUrl = url;
            break;
          } else {
            authLogger.error(
              `Invalid JWKS structure from ${url}: ${JSON.stringify(jwksData)}`,
            );
          }
        } else {
        }
      } catch (error) {
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

    const publicKey = jwks.keys.find((key: any) => key.kid === keyId);
    if (!publicKey) {
      throw new Error(
        `No matching public key found for key ID: ${keyId}. Available keys: ${jwks.keys.map((k: any) => k.kid).join(", ")}`,
      );
    }

    const { importJWK, jwtVerify } = await import("jose");
    const key = await importJWK(publicKey);

    const { payload } = await jwtVerify(idToken, key, {
      issuer: possibleIssuers,
      audience: clientId,
    });

    return payload;
  } catch (error) {
    throw error;
  }
}

const router = express.Router();

function isNonEmptyString(val: any): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

interface JWTPayload {
  userId: string;
  iat?: number;
  exp?: number;
}

const authenticateJWT = authManager.createAuthMiddleware();
const requireAdmin = authManager.createAdminMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

// Route: Create traditional user (username/password)
// POST /users/create
router.post("/create", async (req, res) => {
  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'allow_registration'")
      .get();
    if (row && (row as any).value !== "true") {
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
      authLogger.warn(`Attempt to create duplicate username: ${username}`, {
        operation: "user_create",
        username,
      });
      return res.status(409).json({ error: "Username already exists" });
    }

    let isFirstUser = false;
    const countResult = db.$client
      .prepare("SELECT COUNT(*) as count FROM users")
      .get();
    isFirstUser = ((countResult as any)?.count || 0) === 0;

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

    authLogger.success(
      `Traditional user created: ${username} (is_admin: ${isFirstUser})`,
      {
        operation: "user_create",
        username,
        isAdmin: isFirstUser,
        userId: id,
      },
    );
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

// Route: Create OIDC provider configuration (admin only)
// POST /users/oidc-config
router.post("/oidc-config", authenticateJWT, async (req, res) => {
  const userId = (req as any).userId;
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
          authLogger.info("OIDC configuration encrypted with admin data key", {
            operation: "oidc_config_encrypt",
            userId,
          });
        } else {
          encryptedConfig = {
            ...config,
            client_secret: `encrypted:${Buffer.from(client_secret).toString("base64")}`, // Simple base64 encoding
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

// Route: Disable OIDC configuration (admin only)
// DELETE /users/oidc-config
router.delete("/oidc-config", authenticateJWT, async (req, res) => {
  const userId = (req as any).userId;
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

// Route: Get OIDC configuration (public - needed for login page)
// GET /users/oidc-config
router.get("/oidc-config", async (req, res) => {
  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'oidc_config'")
      .get();
    if (!row) {
      return res.json(null);
    }

    let config = JSON.parse((row as any).value);

    if (config.client_secret) {
      if (config.client_secret.startsWith("encrypted:")) {
        const authHeader = req.headers["authorization"];
        if (authHeader?.startsWith("Bearer ")) {
          const token = authHeader.split(" ")[1];
          const authManager = AuthManager.getInstance();
          const payload = await authManager.verifyJWTToken(token);

          if (payload) {
            const userId = payload.userId;
            const user = await db
              .select()
              .from(users)
              .where(eq(users.id, userId));

            if (user && user.length > 0 && user[0].is_admin) {
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
            } else {
              config.client_secret = "[ENCRYPTED - ADMIN ONLY]";
            }
          } else {
            config.client_secret = "[ENCRYPTED - AUTH REQUIRED]";
          }
        } else {
          config.client_secret = "[ENCRYPTED - AUTH REQUIRED]";
        }
      } else if (config.client_secret.startsWith("encoded:")) {
        try {
          const decoded = Buffer.from(
            config.client_secret.substring(8),
            "base64",
          ).toString("utf8");
          config.client_secret = decoded;
        } catch {
          config.client_secret = "[ENCODING ERROR]";
        }
      }
    }

    res.json(config);
  } catch (err) {
    authLogger.error("Failed to get OIDC config", err);
    res.status(500).json({ error: "Failed to get OIDC config" });
  }
});

// Route: Get OIDC authorization URL
// GET /users/oidc/authorize
router.get("/oidc/authorize", async (req, res) => {
  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'oidc_config'")
      .get();
    if (!row) {
      return res.status(404).json({ error: "OIDC not configured" });
    }

    const config = JSON.parse((row as any).value);
    const state = nanoid();
    const nonce = nanoid();

    let origin =
      req.get("Origin") ||
      req.get("Referer")?.replace(/\/[^\/]*$/, "") ||
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

// Route: OIDC callback - exchange code for token and create/login user
// GET /users/oidc/callback
router.get("/oidc/callback", async (req, res) => {
  const { code, state } = req.query;

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
  const redirectUri = (storedRedirectRow as any).value;

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

    const configRow = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'oidc_config'")
      .get();
    if (!configRow) {
      return res.status(500).json({ error: "OIDC not configured" });
    }

    const config = JSON.parse((configRow as any).value);

    const tokenResponse = await fetch(config.token_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
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

    const tokenData = (await tokenResponse.json()) as any;

    let userInfo: any = null;
    let userInfoUrls: string[] = [];

    const normalizedIssuerUrl = config.issuer_url.endsWith("/")
      ? config.issuer_url.slice(0, -1)
      : config.issuer_url;
    const baseUrl = normalizedIssuerUrl.replace(
      /\/application\/o\/[^\/]+$/,
      "",
    );

    try {
      const discoveryUrl = `${normalizedIssuerUrl}/.well-known/openid-configuration`;
      const discoveryResponse = await fetch(discoveryUrl);
      if (discoveryResponse.ok) {
        const discovery = (await discoveryResponse.json()) as any;
        if (discovery.userinfo_endpoint) {
          userInfoUrls.push(discovery.userinfo_endpoint);
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
          tokenData.id_token,
          config.issuer_url,
          config.client_id,
        );
      } catch (error) {
        try {
          const parts = tokenData.id_token.split(".");
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
            userInfo = await userInfoResponse.json();
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

    const getNestedValue = (obj: any, path: string): any => {
      if (!path || !obj) return null;
      return path.split(".").reduce((current, key) => current?.[key], obj);
    };

    const identifier =
      getNestedValue(userInfo, config.identifier_path) ||
      userInfo[config.identifier_path] ||
      userInfo.sub ||
      userInfo.email ||
      userInfo.preferred_username;

    const name =
      getNestedValue(userInfo, config.name_path) ||
      userInfo[config.name_path] ||
      userInfo.name ||
      userInfo.given_name ||
      identifier;

    if (!identifier) {
      authLogger.error(
        `Identifier not found at path: ${config.identifier_path}`,
      );
      authLogger.error(`Available fields: ${Object.keys(userInfo).join(", ")}`);
      return res.status(400).json({
        error: `User identifier not found at path: ${config.identifier_path}. Available fields: ${Object.keys(userInfo).join(", ")}`,
      });
    }

    let user = await db
      .select()
      .from(users)
      .where(
        and(eq(users.is_oidc, true), eq(users.oidc_identifier, identifier)),
      );

    let isFirstUser = false;
    if (!user || user.length === 0) {
      const countResult = db.$client
        .prepare("SELECT COUNT(*) as count FROM users")
        .get();
      isFirstUser = ((countResult as any)?.count || 0) === 0;

      const id = nanoid();
      await db.insert(users).values({
        id,
        username: name,
        password_hash: "",
        is_admin: isFirstUser,
        is_oidc: true,
        oidc_identifier: identifier,
        client_id: config.client_id,
        client_secret: config.client_secret,
        issuer_url: config.issuer_url,
        authorization_url: config.authorization_url,
        token_url: config.token_url,
        identifier_path: config.identifier_path,
        name_path: config.name_path,
        scopes: config.scopes,
      });

      try {
        await authManager.registerOIDCUser(id);
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

      user = await db.select().from(users).where(eq(users.id, id));
    } else {
      await db
        .update(users)
        .set({ username: name })
        .where(eq(users.id, user[0].id));

      user = await db.select().from(users).where(eq(users.id, user[0].id));
    }

    const userRecord = user[0];

    try {
      await authManager.authenticateOIDCUser(userRecord.id);
    } catch (setupError) {
      authLogger.error("Failed to setup OIDC user encryption", setupError, {
        operation: "oidc_user_encryption_setup_failed",
        userId: userRecord.id,
      });
    }

    const token = await authManager.generateJWTToken(userRecord.id, {
      expiresIn: "50d",
    });

    let frontendUrl = redirectUri.replace("/users/oidc/callback", "");

    if (frontendUrl.includes("localhost")) {
      frontendUrl = "http://localhost:5173";
    }

    const redirectUrl = new URL(frontendUrl);
    redirectUrl.searchParams.set("success", "true");

    return res
      .cookie(
        "jwt",
        token,
        authManager.getSecureCookieOptions(req, 50 * 24 * 60 * 60 * 1000),
      )
      .redirect(redirectUrl.toString());
  } catch (err) {
    authLogger.error("OIDC callback failed", err);

    let frontendUrl = redirectUri.replace("/users/oidc/callback", "");

    if (frontendUrl.includes("localhost")) {
      frontendUrl = "http://localhost:5173";
    }

    const redirectUrl = new URL(frontendUrl);
    redirectUrl.searchParams.set("error", "OIDC authentication failed");

    res.redirect(redirectUrl.toString());
  }
});

// Route: Get user JWT by username and password (traditional login)
// POST /users/login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
    authLogger.warn("Invalid traditional login attempt", {
      operation: "user_login",
      hasUsername: !!username,
      hasPassword: !!password,
    });
    return res.status(400).json({ error: "Invalid username or password" });
  }

  try {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.username, username));

    if (!user || user.length === 0) {
      authLogger.warn(`User not found: ${username}`, {
        operation: "user_login",
        username,
      });
      return res.status(404).json({ error: "User not found" });
    }

    const userRecord = user[0];

    if (userRecord.is_oidc) {
      authLogger.warn("OIDC user attempted traditional login", {
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
      authLogger.warn(`Incorrect password for user: ${username}`, {
        operation: "user_login",
        username,
        userId: userRecord.id,
      });
      return res.status(401).json({ error: "Incorrect password" });
    }

    try {
      const kekSalt = await db
        .select()
        .from(settings)
        .where(eq(settings.key, `user_kek_salt_${userRecord.id}`));

      if (kekSalt.length === 0) {
        await authManager.registerUser(userRecord.id, password);
      }
    } catch (setupError) {
      // Continue if setup fails - authenticateUser will handle it
    }

    const dataUnlocked = await authManager.authenticateUser(
      userRecord.id,
      password,
    );
    if (!dataUnlocked) {
      return res.status(401).json({ error: "Incorrect password" });
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
      expiresIn: "24h",
    });

    authLogger.success(`User logged in successfully: ${username}`, {
      operation: "user_login_success",
      username,
      userId: userRecord.id,
      dataUnlocked: true,
    });

    const response: any = {
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

    return res
      .cookie(
        "jwt",
        token,
        authManager.getSecureCookieOptions(req, 24 * 60 * 60 * 1000),
      )
      .json(response);
  } catch (err) {
    authLogger.error("Failed to log in user", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

// Route: Logout user
// POST /users/logout
router.post("/logout", async (req, res) => {
  try {
    const userId = (req as any).userId;

    if (userId) {
      authManager.logoutUser(userId);
      authLogger.info("User logged out", {
        operation: "user_logout",
        userId,
      });
    }

    return res
      .clearCookie("jwt", authManager.getSecureCookieOptions(req))
      .json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    authLogger.error("Logout failed", err);
    return res.status(500).json({ error: "Logout failed" });
  }
});

// Route: Get current user's info using JWT
// GET /users/me
router.get("/me", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
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

    const isDataUnlocked = authManager.isUserUnlocked(userId);

    res.json({
      userId: user[0].id,
      username: user[0].username,
      is_admin: !!user[0].is_admin,
      is_oidc: !!user[0].is_oidc,
      totp_enabled: !!user[0].totp_enabled,
      data_unlocked: isDataUnlocked,
    });
  } catch (err) {
    authLogger.error("Failed to get username", err);
    res.status(500).json({ error: "Failed to get username" });
  }
});

// Route: Check if system requires initial setup (public - for first-time setup detection)
// GET /users/setup-required
router.get("/setup-required", async (req, res) => {
  try {
    const countResult = db.$client
      .prepare("SELECT COUNT(*) as count FROM users")
      .get();
    const count = (countResult as any)?.count || 0;

    res.json({
      setup_required: count === 0,
    });
  } catch (err) {
    authLogger.error("Failed to check setup status", err);
    res.status(500).json({ error: "Failed to check setup status" });
  }
});

// Route: Count users (admin only - for dashboard statistics)
// GET /users/count
router.get("/count", authenticateJWT, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user[0] || !user[0].is_admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const countResult = db.$client
      .prepare("SELECT COUNT(*) as count FROM users")
      .get();
    const count = (countResult as any)?.count || 0;
    res.json({ count });
  } catch (err) {
    authLogger.error("Failed to count users", err);
    res.status(500).json({ error: "Failed to count users" });
  }
});

// Route: DB health check (actually queries DB)
// GET /users/db-health
router.get("/db-health", requireAdmin, async (req, res) => {
  try {
    db.$client.prepare("SELECT 1").get();
    res.json({ status: "ok" });
  } catch (err) {
    authLogger.error("DB health check failed", err);
    res.status(500).json({ error: "Database not accessible" });
  }
});

// Route: Get registration allowed status (public - needed for login page)
// GET /users/registration-allowed
router.get("/registration-allowed", async (req, res) => {
  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'allow_registration'")
      .get();
    res.json({ allowed: row ? (row as any).value === "true" : true });
  } catch (err) {
    authLogger.error("Failed to get registration allowed", err);
    res.status(500).json({ error: "Failed to get registration allowed" });
  }
});

// Route: Set registration allowed status (admin only)
// PATCH /users/registration-allowed
router.patch("/registration-allowed", authenticateJWT, async (req, res) => {
  const userId = (req as any).userId;
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

// Route: Delete user account
// DELETE /users/delete-account
router.delete("/delete-account", authenticateJWT, async (req, res) => {
  const userId = (req as any).userId;
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
      if ((adminCount as any)?.count <= 1) {
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

// Route: Initiate password reset
// POST /users/initiate-reset
router.post("/initiate-reset", async (req, res) => {
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

// Route: Verify reset code
// POST /users/verify-reset-code
router.post("/verify-reset-code", async (req, res) => {
  const { username, resetCode } = req.body;

  if (!isNonEmptyString(username) || !isNonEmptyString(resetCode)) {
    return res
      .status(400)
      .json({ error: "Username and reset code are required" });
  }

  try {
    const resetDataRow = db.$client
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(`reset_code_${username}`);
    if (!resetDataRow) {
      return res
        .status(400)
        .json({ error: "No reset code found for this user" });
    }

    const resetData = JSON.parse((resetDataRow as any).value);
    const now = new Date();
    const expiresAt = new Date(resetData.expiresAt);

    if (now > expiresAt) {
      db.$client
        .prepare("DELETE FROM settings WHERE key = ?")
        .run(`reset_code_${username}`);
      return res.status(400).json({ error: "Reset code has expired" });
    }

    if (resetData.code !== resetCode) {
      return res.status(400).json({ error: "Invalid reset code" });
    }

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

// Route: Complete password reset
// POST /users/complete-reset
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

    const tempTokenData = JSON.parse((tempTokenRow as any).value);
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

    await db
      .update(users)
      .set({ password_hash })
      .where(eq(users.username, username));

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

// Route: List all users (admin only)
// GET /users/list
router.get("/list", authenticateJWT, async (req, res) => {
  const userId = (req as any).userId;
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
      })
      .from(users);

    res.json({ users: allUsers });
  } catch (err) {
    authLogger.error("Failed to list users", err);
    res.status(500).json({ error: "Failed to list users" });
  }
});

// Route: Make user admin (admin only)
// POST /users/make-admin
router.post("/make-admin", authenticateJWT, async (req, res) => {
  const userId = (req as any).userId;
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

    authLogger.success(
      `User ${username} made admin by ${adminUser[0].username}`,
    );
    res.json({ message: `User ${username} is now an admin` });
  } catch (err) {
    authLogger.error("Failed to make user admin", err);
    res.status(500).json({ error: "Failed to make user admin" });
  }
});

// Route: Remove admin status (admin only)
// POST /users/remove-admin
router.post("/remove-admin", authenticateJWT, async (req, res) => {
  const userId = (req as any).userId;
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

    authLogger.success(
      `Admin status removed from ${username} by ${adminUser[0].username}`,
    );
    res.json({ message: `Admin status removed from ${username}` });
  } catch (err) {
    authLogger.error("Failed to remove admin status", err);
    res.status(500).json({ error: "Failed to remove admin status" });
  }
});

// Route: Verify TOTP during login
// POST /users/totp/verify-login
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
      } catch (parseError) {
        backupCodes = [];
      }

      if (!Array.isArray(backupCodes)) {
        backupCodes = [];
      }

      const backupIndex = backupCodes.indexOf(totp_code);

      if (backupIndex === -1) {
        return res.status(401).json({ error: "Invalid TOTP code" });
      }

      backupCodes.splice(backupIndex, 1);
      await db
        .update(users)
        .set({ totp_backup_codes: JSON.stringify(backupCodes) })
        .where(eq(users.id, userRecord.id));
    }

    const token = await authManager.generateJWTToken(userRecord.id, {
      expiresIn: "50d",
    });

    const isElectron =
      req.headers["x-electron-app"] === "true" ||
      req.headers["X-Electron-App"] === "true";

    const isDataUnlocked = authManager.isUserUnlocked(userRecord.id);

    if (!isDataUnlocked) {
      return res.status(401).json({
        error: "Session expired - please log in again",
        code: "SESSION_EXPIRED",
      });
    }

    const response: any = {
      success: true,
      is_admin: !!userRecord.is_admin,
      username: userRecord.username,
      userId: userRecord.id,
      is_oidc: !!userRecord.is_oidc,
      totp_enabled: !!userRecord.totp_enabled,
      data_unlocked: isDataUnlocked,
    };

    if (isElectron) {
      response.token = token;
    }

    return res
      .cookie(
        "jwt",
        token,
        authManager.getSecureCookieOptions(req, 50 * 24 * 60 * 60 * 1000),
      )
      .json(response);
  } catch (err) {
    authLogger.error("TOTP verification failed", err);
    return res.status(500).json({ error: "TOTP verification failed" });
  }
});

// Route: Setup TOTP
// POST /users/totp/setup
router.post("/totp/setup", authenticateJWT, async (req, res) => {
  const userId = (req as any).userId;

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

// Route: Enable TOTP
// POST /users/totp/enable
router.post("/totp/enable", authenticateJWT, async (req, res) => {
  const userId = (req as any).userId;
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

    res.json({
      message: "TOTP enabled successfully",
      backup_codes: backupCodes,
    });
  } catch (err) {
    authLogger.error("Failed to enable TOTP", err);
    res.status(500).json({ error: "Failed to enable TOTP" });
  }
});

// Route: Disable TOTP
// POST /users/totp/disable
router.post("/totp/disable", authenticateJWT, async (req, res) => {
  const userId = (req as any).userId;
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

    res.json({ message: "TOTP disabled successfully" });
  } catch (err) {
    authLogger.error("Failed to disable TOTP", err);
    res.status(500).json({ error: "Failed to disable TOTP" });
  }
});

// Route: Generate new backup codes
// POST /users/totp/backup-codes
router.post("/totp/backup-codes", authenticateJWT, async (req, res) => {
  const userId = (req as any).userId;
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

// Route: Delete user (admin only)
// DELETE /users/delete-user
router.delete("/delete-user", authenticateJWT, async (req, res) => {
  const userId = (req as any).userId;
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
      if ((adminCount as any)?.count <= 1) {
        return res
          .status(403)
          .json({ error: "Cannot delete the last admin user" });
      }
    }

    const targetUserId = targetUser[0].id;

    try {
      await db
        .delete(fileManagerRecent)
        .where(eq(fileManagerRecent.userId, targetUserId));
      await db
        .delete(fileManagerPinned)
        .where(eq(fileManagerPinned.userId, targetUserId));
      await db
        .delete(fileManagerShortcuts)
        .where(eq(fileManagerShortcuts.userId, targetUserId));

      await db
        .delete(dismissedAlerts)
        .where(eq(dismissedAlerts.userId, targetUserId));

      await db.delete(sshData).where(eq(sshData.userId, targetUserId));
    } catch (cleanupError) {
      authLogger.error(`Cleanup failed for user ${username}:`, cleanupError);
      throw cleanupError;
    }

    await db.delete(users).where(eq(users.id, targetUserId));

    authLogger.success(
      `User ${username} deleted by admin ${adminUser[0].username}`,
    );
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

// Route: User data unlock - used when session expires
// POST /users/unlock-data
router.post("/unlock-data", authenticateJWT, async (req, res) => {
  const userId = (req as any).userId;
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

// Route: Check user data unlock status
// GET /users/data-status
router.get("/data-status", authenticateJWT, async (req, res) => {
  const userId = (req as any).userId;

  try {
    const isUnlocked = authManager.isUserUnlocked(userId);
    res.json({
      unlocked: isUnlocked,
      message: isUnlocked
        ? "Data is unlocked"
        : "Data is locked - re-authenticate with password",
    });
  } catch (err) {
    authLogger.error("Failed to check data status", err, {
      operation: "data_status_check_failed",
      userId,
    });
    res.status(500).json({ error: "Failed to check data status" });
  }
});

// Route: Change user password (re-encrypt data keys)
// POST /users/change-password
router.post("/change-password", authenticateJWT, async (req, res) => {
  const userId = (req as any).userId;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      error: "Current password and new password are required",
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      error: "New password must be at least 8 characters long",
    });
  }

  try {
    const success = await authManager.changeUserPassword(
      userId,
      currentPassword,
      newPassword,
    );

    if (success) {
      const saltRounds = parseInt(process.env.SALT || "10", 10);
      const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);
      await db
        .update(users)
        .set({ password_hash: newPasswordHash })
        .where(eq(users.id, userId));

      authLogger.success("User password changed successfully", {
        operation: "password_change_success",
        userId,
      });

      res.json({
        success: true,
        message: "Password changed successfully",
      });
    } else {
      authLogger.warn("Password change failed - invalid current password", {
        operation: "password_change_failed",
        userId,
      });
      res.status(401).json({ error: "Current password is incorrect" });
    }
  } catch (err) {
    authLogger.error("Password change failed", err, {
      operation: "password_change_error",
      userId,
    });
    res.status(500).json({ error: "Failed to change password" });
  }
});

export default router;
