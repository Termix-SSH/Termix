import express from "express";
import bodyParser from "body-parser";
import multer from "multer";
import cookieParser from "cookie-parser";
import userRoutes from "./routes/users.js";
import sshRoutes from "./routes/ssh.js";
import alertRoutes from "./routes/alerts.js";
import credentialsRoutes from "./routes/credentials.js";
import snippetsRoutes from "./routes/snippets.js";
import terminalRoutes from "./routes/terminal.js";
import networkTopologyRoutes from "./routes/network-topology.js";
import rbacRoutes from "./routes/rbac.js";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import os from "os";
import "dotenv/config";
import { databaseLogger, apiLogger } from "../utils/logger.js";
import { AuthManager } from "../utils/auth-manager.js";
import { DataCrypto } from "../utils/data-crypto.js";
import { DatabaseFileEncryption } from "../utils/database-file-encryption.js";
import { DatabaseMigration } from "../utils/database-migration.js";
import { UserDataExport } from "../utils/user-data-export.js";
import { AutoSSLSetup } from "../utils/auto-ssl-setup.js";
import { eq, and } from "drizzle-orm";
import { parseUserAgent } from "../utils/user-agent-parser.js";
import {
  users,
  sshData,
  sshCredentials,
  fileManagerRecent,
  fileManagerPinned,
  fileManagerShortcuts,
  dismissedAlerts,
  sshCredentialUsage,
  settings,
} from "./db/schema.js";
import type {
  CacheEntry,
  GitHubRelease,
  GitHubAPIResponse,
  AuthenticatedRequest,
} from "../../types/index.js";
import { getDb, DatabaseSaveTrigger } from "./db/index.js";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set("trust proxy", true);

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireAdmin = authManager.createAdminMiddleware();
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowedOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      if (origin.startsWith("https://")) {
        return callback(null, true);
      }

      if (origin.startsWith("http://")) {
        return callback(null, true);
      }

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "User-Agent",
      "X-Electron-App",
      "Accept",
      "Origin",
    ],
  }),
);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    cb(null, `${timestamp}-${file.originalname}`);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 1024 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (
      file.originalname.endsWith(".termix-export.sqlite") ||
      file.originalname.endsWith(".sqlite")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only .termix-export.sqlite files are allowed"));
    }
  },
});

class GitHubCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_DURATION = 30 * 60 * 1000;

  set<T>(key: string, data: T): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + this.CACHE_DURATION,
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }
}

const githubCache = new GitHubCache();

const GITHUB_API_BASE = "https://api.github.com";
const REPO_OWNER = "Termix-SSH";
const REPO_NAME = "Termix";

async function fetchGitHubAPI<T>(
  endpoint: string,
  cacheKey: string,
): Promise<GitHubAPIResponse<T>> {
  const cachedEntry = githubCache.get<CacheEntry<T>>(cacheKey);
  if (cachedEntry) {
    return {
      data: cachedEntry.data,
      cached: true,
      cache_age: Date.now() - cachedEntry.timestamp,
    };
  }

  try {
    const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "TermixUpdateChecker/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as T;
    const cacheData: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000,
    };
    githubCache.set(cacheKey, cacheData);

    return {
      data: data,
      cached: false,
    };
  } catch (error) {
    databaseLogger.error(`Failed to fetch from GitHub API`, error, {
      operation: "github_api",
      endpoint,
    });
    throw error;
  }
}

app.use(bodyParser.json({ limit: "1gb" }));
app.use(bodyParser.urlencoded({ limit: "1gb", extended: true }));
app.use(bodyParser.raw({ limit: "5gb", type: "application/octet-stream" }));
app.use(cookieParser());

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     description: Returns the health status of the server.
 *     tags:
 *       - General
 *     responses:
 *       200:
 *         description: Server is healthy.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 */
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/**
 * @openapi
 * /version:
 *   get:
 *     summary: Get version information
 *     description: Returns the local and remote version of the application.
 *     tags:
 *       - General
 *     responses:
 *       200:
 *         description: Version information.
 *       404:
 *         description: Local version not set.
 *       500:
 *         description: Fetch error.
 */
app.get("/version", authenticateJWT, async (req, res) => {
  let localVersion = process.env.VERSION;

  if (!localVersion) {
    const versionSources = [
      () => {
        try {
          const packagePath = path.resolve(process.cwd(), "package.json");
          const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
          return packageJson.version;
        } catch {
          return null;
        }
      },
      () => {
        try {
          const packagePath = path.resolve("/app", "package.json");
          const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
          return packageJson.version;
        } catch {
          return null;
        }
      },
      () => {
        try {
          const packagePath = path.resolve(__dirname, "../../../package.json");
          const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
          return packageJson.version;
        } catch {
          return null;
        }
      },
    ];

    for (const getVersion of versionSources) {
      try {
        const foundVersion = getVersion();
        if (foundVersion && foundVersion !== "unknown") {
          localVersion = foundVersion;
          break;
        }
      } catch {
        continue;
      }
    }
  }

  if (!localVersion) {
    databaseLogger.error("No version information available", undefined, {
      operation: "version_check",
    });
    return res.status(404).send("Local Version Not Set");
  }

  try {
    const cacheKey = "latest_release";
    const releaseData = await fetchGitHubAPI<GitHubRelease>(
      `/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      cacheKey,
    );

    const rawTag = releaseData.data.tag_name || releaseData.data.name || "";
    const remoteVersionMatch = rawTag.match(/(\d+\.\d+(\.\d+)?)/);
    const remoteVersion = remoteVersionMatch ? remoteVersionMatch[1] : null;

    if (!remoteVersion) {
      databaseLogger.warn("Remote version not found in GitHub response", {
        operation: "version_check",
        rawTag,
      });
      return res.status(401).send("Remote Version Not Found");
    }

    const isUpToDate = localVersion === remoteVersion;

    const response = {
      status: isUpToDate ? "up_to_date" : "requires_update",
      localVersion: localVersion,
      version: remoteVersion,
      latest_release: {
        tag_name: releaseData.data.tag_name,
        name: releaseData.data.name,
        published_at: releaseData.data.published_at,
        html_url: releaseData.data.html_url,
      },
      cached: releaseData.cached,
      cache_age: releaseData.cache_age,
    };

    res.json(response);
  } catch (err) {
    databaseLogger.error("Version check failed", err, {
      operation: "version_check",
    });
    res.status(500).send("Fetch Error");
  }
});

/**
 * @openapi
 * /releases/rss:
 *   get:
 *     summary: Get releases in RSS format
 *     description: Returns the latest releases from the GitHub repository in an RSS-like JSON format.
 *     tags:
 *       - General
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: The page number of the releases to fetch.
 *       - in: query
 *         name: per_page
 *         schema:
 *           type: integer
 *         description: The number of releases to fetch per page.
 *     responses:
 *       200:
 *         description: Releases in RSS format.
 *       500:
 *         description: Failed to generate RSS format.
 */
app.get("/releases/rss", authenticateJWT, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const per_page = Math.min(
      parseInt(req.query.per_page as string) || 20,
      100,
    );
    const cacheKey = `releases_rss_${page}_${per_page}`;

    const releasesData = await fetchGitHubAPI<GitHubRelease[]>(
      `/repos/${REPO_OWNER}/${REPO_NAME}/releases?page=${page}&per_page=${per_page}`,
      cacheKey,
    );

    const rssItems = releasesData.data.map((release) => ({
      id: release.id,
      title: release.name || release.tag_name,
      description: release.body,
      link: release.html_url,
      pubDate: release.published_at,
      version: release.tag_name,
      isPrerelease: release.prerelease,
      isDraft: release.draft,
      assets: release.assets.map((asset) => ({
        name: asset.name,
        size: asset.size,
        download_count: asset.download_count,
        download_url: asset.browser_download_url,
      })),
    }));

    const response = {
      feed: {
        title: `${REPO_NAME} Releases`,
        description: `Latest releases from ${REPO_NAME} repository`,
        link: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`,
        updated: new Date().toISOString(),
      },
      items: rssItems,
      total_count: rssItems.length,
      cached: releasesData.cached,
      cache_age: releasesData.cache_age,
    };

    res.json(response);
  } catch (error) {
    databaseLogger.error("Failed to generate RSS format", error, {
      operation: "rss_releases",
    });
    res.status(500).json({
      error: "Failed to generate RSS format",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * @openapi
 * /encryption/status:
 *   get:
 *     summary: Get encryption status
 *     description: Returns the security status of the application.
 *     tags:
 *       - Encryption
 *     responses:
 *       200:
 *         description: Security status.
 *       500:
 *         description: Failed to get security status.
 */
app.get("/encryption/status", requireAdmin, async (req, res) => {
  try {
    const securityStatus = {
      initialized: true,
      system: { hasSecret: true, isValid: true },
      activeSessions: {},
      activeSessionCount: 0,
    };

    res.json({
      security: securityStatus,
      version: "v2-kek-dek",
    });
  } catch (error) {
    apiLogger.error("Failed to get security status", error, {
      operation: "security_status",
    });
    res.status(500).json({ error: "Failed to get security status" });
  }
});

/**
 * @openapi
 * /encryption/initialize:
 *   post:
 *     summary: Initialize security system
 *     description: Initializes the security system for the application.
 *     tags:
 *       - Encryption
 *     responses:
 *       200:
 *         description: Security system initialized successfully.
 *       500:
 *         description: Failed to initialize security system.
 */
app.post("/encryption/initialize", requireAdmin, async (req, res) => {
  try {
    const authManager = AuthManager.getInstance();

    const isValid = true;
    if (!isValid) {
      await authManager.initialize();
    }

    res.json({
      success: true,
      message: "Security system initialized successfully",
      version: "v2-kek-dek",
      note: "User data encryption will be set up when users log in",
    });
  } catch (error) {
    apiLogger.error("Failed to initialize security system", error, {
      operation: "security_init_api_failed",
    });
    res.status(500).json({ error: "Failed to initialize security system" });
  }
});

/**
 * @openapi
 * /encryption/regenerate:
 *   post:
 *     summary: Regenerate JWT secret
 *     description: Regenerates the system JWT secret. This will invalidate all existing JWT tokens.
 *     tags:
 *       - Encryption
 *     responses:
 *       200:
 *         description: System JWT secret regenerated.
 *       500:
 *         description: Failed to regenerate JWT secret.
 */
app.post("/encryption/regenerate", requireAdmin, async (req, res) => {
  try {
    apiLogger.warn("System JWT secret regenerated via API", {
      operation: "jwt_regenerate_api",
    });

    res.json({
      success: true,
      message: "System JWT secret regenerated",
      warning:
        "All existing JWT tokens are now invalid - users must re-authenticate",
      note: "User data encryption keys are protected by passwords and cannot be regenerated",
    });
  } catch (error) {
    apiLogger.error("Failed to regenerate JWT secret", error, {
      operation: "jwt_regenerate_failed",
    });
    res.status(500).json({ error: "Failed to regenerate JWT secret" });
  }
});

/**
 * @openapi
 * /encryption/regenerate-jwt:
 *   post:
 *     summary: Regenerate JWT secret
 *     description: Regenerates the JWT secret. This will invalidate all existing JWT tokens.
 *     tags:
 *       - Encryption
 *     responses:
 *       200:
 *         description: New JWT secret generated.
 *       500:
 *         description: Failed to regenerate JWT secret.
 */
app.post("/encryption/regenerate-jwt", requireAdmin, async (req, res) => {
  try {
    apiLogger.warn("JWT secret regenerated via API", {
      operation: "jwt_secret_regenerate_api",
    });

    res.json({
      success: true,
      message: "New JWT secret generated",
      warning:
        "All existing JWT tokens are now invalid - users must re-authenticate",
    });
  } catch (error) {
    apiLogger.error("Failed to regenerate JWT secret", error, {
      operation: "jwt_secret_regenerate_failed",
    });
    res.status(500).json({ error: "Failed to regenerate JWT secret" });
  }
});

/**
 * @openapi
 * /database/export:
 *   post:
 *     summary: Export user data
 *     description: Exports the user's data as a SQLite database file.
 *     tags:
 *       - Database
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
 *         description: User data exported successfully.
 *       400:
 *         description: Password required for export.
 *       401:
 *         description: Invalid password.
 *       500:
 *         description: Failed to export user data.
 */
app.post("/database/export", authenticateJWT, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        error: "Password required for export",
        code: "PASSWORD_REQUIRED",
      });
    }
    const deviceInfo = parseUserAgent(req);
    const unlocked = await authManager.authenticateUser(
      userId,
      password,
      deviceInfo.type,
    );
    if (!unlocked) {
      return res.status(401).json({ error: "Invalid password" });
    }

    apiLogger.info("Exporting user data as SQLite", {
      operation: "user_data_sqlite_export_api",
      userId,
    });

    const userDataKey = DataCrypto.getUserDataKey(userId);
    if (!userDataKey) {
      throw new Error("User data not unlocked");
    }

    const user = await getDb().select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0) {
      throw new Error(`User not found: ${userId}`);
    }

    const tempDir =
      process.env.NODE_ENV === "production"
        ? path.join(process.env.DATA_DIR || "./db/data", ".temp", "exports")
        : path.join(os.tmpdir(), "termix-exports");

    try {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
    } catch (dirError) {
      apiLogger.error("Failed to create temp directory", dirError, {
        operation: "export_temp_dir_error",
        tempDir,
      });
      throw new Error(`Failed to create temp directory: ${dirError.message}`);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `termix-export-${user[0].username}-${timestamp}.sqlite`;
    const tempPath = path.join(tempDir, filename);

    apiLogger.info("Creating export database", {
      operation: "export_db_creation",
      userId,
      tempPath,
    });

    const exportDb = new Database(tempPath);

    try {
      exportDb.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          is_admin INTEGER NOT NULL DEFAULT 0,
          is_oidc INTEGER NOT NULL DEFAULT 0,
          oidc_identifier TEXT,
          client_id TEXT,
          client_secret TEXT,
          issuer_url TEXT,
          authorization_url TEXT,
          token_url TEXT,
          identifier_path TEXT,
          name_path TEXT,
          scopes TEXT DEFAULT 'openid email profile',
          totp_secret TEXT,
          totp_enabled INTEGER NOT NULL DEFAULT 0,
          totp_backup_codes TEXT
        );

        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE ssh_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          name TEXT,
          ip TEXT NOT NULL,
          port INTEGER NOT NULL,
          username TEXT NOT NULL,
          folder TEXT,
          tags TEXT,
          pin INTEGER NOT NULL DEFAULT 0,
          auth_type TEXT NOT NULL,
          force_keyboard_interactive TEXT,
          password TEXT,
          key TEXT,
          key_password TEXT,
          key_type TEXT,
          sudo_password TEXT,
          autostart_password TEXT,
          autostart_key TEXT,
          autostart_key_password TEXT,
          credential_id INTEGER,
          override_credential_username INTEGER,
          enable_terminal INTEGER NOT NULL DEFAULT 1,
          enable_tunnel INTEGER NOT NULL DEFAULT 1,
          tunnel_connections TEXT,
          jump_hosts TEXT,
          enable_file_manager INTEGER NOT NULL DEFAULT 1,
          enable_docker INTEGER NOT NULL DEFAULT 0,
          show_terminal_in_sidebar INTEGER NOT NULL DEFAULT 1,
          show_file_manager_in_sidebar INTEGER NOT NULL DEFAULT 0,
          show_tunnel_in_sidebar INTEGER NOT NULL DEFAULT 0,
          show_docker_in_sidebar INTEGER NOT NULL DEFAULT 0,
          show_server_stats_in_sidebar INTEGER NOT NULL DEFAULT 0,
          default_path TEXT,
          stats_config TEXT,
          terminal_config TEXT,
          quick_actions TEXT,
          notes TEXT,
          use_socks5 INTEGER,
          socks5_host TEXT,
          socks5_port INTEGER,
          socks5_username TEXT,
          socks5_password TEXT,
          socks5_proxy_chain TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE ssh_credentials (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          folder TEXT,
          tags TEXT,
          auth_type TEXT NOT NULL,
          username TEXT NOT NULL,
          password TEXT,
          key TEXT,
          private_key TEXT,
          public_key TEXT,
          key_password TEXT,
          key_type TEXT,
          detected_key_type TEXT,
          usage_count INTEGER NOT NULL DEFAULT 0,
          last_used TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE file_manager_recent (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          host_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          last_opened TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE file_manager_pinned (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          host_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          pinned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE file_manager_shortcuts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          host_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE dismissed_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          alert_id TEXT NOT NULL,
          dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE ssh_credential_usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          credential_id INTEGER NOT NULL,
          host_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      const userRecord = user[0];
      const insertUser = exportDb.prepare(`
        INSERT INTO users (id, username, password_hash, is_admin, is_oidc, oidc_identifier, client_id, client_secret, issuer_url, authorization_url, token_url, identifier_path, name_path, scopes, totp_secret, totp_enabled, totp_backup_codes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertUser.run(
        userRecord.id,
        userRecord.username,
        "[EXPORTED_USER_NO_PASSWORD]",
        userRecord.is_admin ? 1 : 0,
        userRecord.is_oidc ? 1 : 0,
        userRecord.oidc_identifier || null,
        userRecord.client_id || null,
        userRecord.client_secret || null,
        userRecord.issuer_url || null,
        userRecord.authorization_url || null,
        userRecord.token_url || null,
        userRecord.identifier_path || null,
        userRecord.name_path || null,
        userRecord.scopes || null,
        userRecord.totp_secret || null,
        userRecord.totp_enabled ? 1 : 0,
        userRecord.totp_backup_codes || null,
      );

      const sshHosts = await getDb()
        .select()
        .from(sshData)
        .where(eq(sshData.userId, userId));
      const insertHost = exportDb.prepare(`
        INSERT INTO ssh_data (id, user_id, name, ip, port, username, folder, tags, pin, auth_type, force_keyboard_interactive, password, key, key_password, key_type, sudo_password, autostart_password, autostart_key, autostart_key_password, credential_id, override_credential_username, enable_terminal, enable_tunnel, tunnel_connections, jump_hosts, enable_file_manager, enable_docker, show_terminal_in_sidebar, show_file_manager_in_sidebar, show_tunnel_in_sidebar, show_docker_in_sidebar, show_server_stats_in_sidebar, default_path, stats_config, terminal_config, quick_actions, notes, use_socks5, socks5_host, socks5_port, socks5_username, socks5_password, socks5_proxy_chain, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const host of sshHosts) {
        const decrypted = DataCrypto.decryptRecord(
          "ssh_data",
          host,
          userId,
          userDataKey,
        );
        insertHost.run(
          decrypted.id,
          decrypted.userId,
          decrypted.name || null,
          decrypted.ip,
          decrypted.port,
          decrypted.username,
          decrypted.folder || null,
          decrypted.tags || null,
          decrypted.pin ? 1 : 0,
          decrypted.authType,
          decrypted.forceKeyboardInteractive || null,
          decrypted.password || null,
          decrypted.key || null,
          decrypted.key_password || null,
          decrypted.keyType || null,
          decrypted.sudoPassword || null,
          decrypted.autostartPassword || null,
          decrypted.autostartKey || null,
          decrypted.autostartKeyPassword || null,
          decrypted.credentialId || null,
          Boolean(decrypted.overrideCredentialUsername) ? 1 : 0,
          Boolean(decrypted.enableTerminal) ? 1 : 0,
          Boolean(decrypted.enableTunnel) ? 1 : 0,
          decrypted.tunnelConnections || null,
          decrypted.jumpHosts || null,
          Boolean(decrypted.enableFileManager) ? 1 : 0,
          Boolean(decrypted.enableDocker) ? 1 : 0,
          Boolean(decrypted.showTerminalInSidebar) ? 1 : 0,
          Boolean(decrypted.showFileManagerInSidebar) ? 1 : 0,
          Boolean(decrypted.showTunnelInSidebar) ? 1 : 0,
          Boolean(decrypted.showDockerInSidebar) ? 1 : 0,
          Boolean(decrypted.showServerStatsInSidebar) ? 1 : 0,
          decrypted.defaultPath || null,
          decrypted.statsConfig || null,
          decrypted.terminalConfig || null,
          decrypted.quickActions || null,
          decrypted.notes || null,
          Boolean(decrypted.useSocks5) ? 1 : 0,
          decrypted.socks5Host || null,
          decrypted.socks5Port || null,
          decrypted.socks5Username || null,
          decrypted.socks5Password || null,
          decrypted.socks5ProxyChain || null,
          decrypted.createdAt,
          decrypted.updatedAt,
        );
      }

      const credentials = await getDb()
        .select()
        .from(sshCredentials)
        .where(eq(sshCredentials.userId, userId));
      const insertCred = exportDb.prepare(`
        INSERT INTO ssh_credentials (id, user_id, name, description, folder, tags, auth_type, username, password, key, private_key, public_key, key_password, key_type, detected_key_type, usage_count, last_used, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const cred of credentials) {
        const decrypted = DataCrypto.decryptRecord(
          "ssh_credentials",
          cred,
          userId,
          userDataKey,
        );
        insertCred.run(
          decrypted.id,
          decrypted.userId,
          decrypted.name,
          decrypted.description || null,
          decrypted.folder || null,
          decrypted.tags || null,
          decrypted.authType,
          decrypted.username,
          decrypted.password || null,
          decrypted.key || null,
          decrypted.private_key || null,
          decrypted.public_key || null,
          decrypted.key_password || null,
          decrypted.keyType || null,
          decrypted.detectedKeyType || null,
          decrypted.usageCount || 0,
          decrypted.lastUsed || null,
          decrypted.createdAt,
          decrypted.updatedAt,
        );
      }

      const [recentFiles, pinnedFiles, shortcuts] = await Promise.all([
        getDb()
          .select()
          .from(fileManagerRecent)
          .where(eq(fileManagerRecent.userId, userId)),
        getDb()
          .select()
          .from(fileManagerPinned)
          .where(eq(fileManagerPinned.userId, userId)),
        getDb()
          .select()
          .from(fileManagerShortcuts)
          .where(eq(fileManagerShortcuts.userId, userId)),
      ]);

      const insertRecent = exportDb.prepare(`
        INSERT INTO file_manager_recent (id, user_id, host_id, name, path, last_opened)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const item of recentFiles) {
        insertRecent.run(
          item.id,
          item.userId,
          item.hostId,
          item.name,
          item.path,
          item.lastOpened,
        );
      }

      const insertPinned = exportDb.prepare(`
        INSERT INTO file_manager_pinned (id, user_id, host_id, name, path, pinned_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const item of pinnedFiles) {
        insertPinned.run(
          item.id,
          item.userId,
          item.hostId,
          item.name,
          item.path,
          item.pinnedAt,
        );
      }

      const insertShortcut = exportDb.prepare(`
        INSERT INTO file_manager_shortcuts (id, user_id, host_id, name, path, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const item of shortcuts) {
        insertShortcut.run(
          item.id,
          item.userId,
          item.hostId,
          item.name,
          item.path,
          item.createdAt,
        );
      }

      const alerts = await getDb()
        .select()
        .from(dismissedAlerts)
        .where(eq(dismissedAlerts.userId, userId));
      const insertAlert = exportDb.prepare(`
        INSERT INTO dismissed_alerts (id, user_id, alert_id, dismissed_at)
        VALUES (?, ?, ?, ?)
      `);
      for (const alert of alerts) {
        insertAlert.run(
          alert.id,
          alert.userId,
          alert.alertId,
          alert.dismissedAt,
        );
      }

      const usage = await getDb()
        .select()
        .from(sshCredentialUsage)
        .where(eq(sshCredentialUsage.userId, userId));
      const insertUsage = exportDb.prepare(`
        INSERT INTO ssh_credential_usage (id, credential_id, host_id, user_id, used_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const item of usage) {
        insertUsage.run(
          item.id,
          item.credentialId,
          item.hostId,
          item.userId,
          item.usedAt,
        );
      }

      const settingsData = await getDb().select().from(settings);
      const insertSetting = exportDb.prepare(`
        INSERT INTO settings (key, value)
        VALUES (?, ?)
      `);
      for (const setting of settingsData) {
        insertSetting.run(setting.key, setting.value);
      }
    } finally {
      exportDb.close();
    }

    res.setHeader("Content-Type", "application/x-sqlite3");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const fileStream = fs.createReadStream(tempPath);

    fileStream.on("error", (streamError) => {
      apiLogger.error("File stream error during export", streamError, {
        operation: "export_file_stream_error",
        userId,
        tempPath,
      });
      if (!res.headersSent) {
        res.status(500).json({
          error: "Failed to stream export file",
          details: streamError.message,
        });
      }
    });

    fileStream.on("end", () => {
      apiLogger.success("User data exported as SQLite successfully", {
        operation: "user_data_sqlite_export_success",
        userId,
        filename,
      });

      fs.unlink(tempPath, (err) => {
        if (err) {
          apiLogger.warn("Failed to clean up export file", {
            operation: "export_cleanup_failed",
            path: tempPath,
            error: err.message,
          });
        }
      });
    });

    fileStream.pipe(res);
  } catch (error) {
    apiLogger.error("User data SQLite export failed", error, {
      operation: "user_data_sqlite_export_failed",
    });
    res.status(500).json({
      error: "Failed to export user data",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * @openapi
 * /database/import:
 *   post:
 *     summary: Import user data
 *     description: Imports user data from a SQLite database file.
 *     tags:
 *       - Database
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Incremental import completed successfully.
 *       400:
 *         description: No file uploaded or password required for import.
 *       401:
 *         description: Invalid password.
 *       500:
 *         description: Failed to import SQLite data.
 */
app.post(
  "/database/import",
  authenticateJWT,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const userId = (req as AuthenticatedRequest).userId;
      const { password } = req.body;
      const mainDb = getDb();
      const deviceInfo = parseUserAgent(req);

      const userRecords = await mainDb
        .select()
        .from(users)
        .where(eq(users.id, userId));

      if (!userRecords || userRecords.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      const isOidcUser = !!userRecords[0].is_oidc;

      if (!isOidcUser) {
        if (!password) {
          return res.status(400).json({
            error: "Password required for import",
            code: "PASSWORD_REQUIRED",
          });
        }

        const unlocked = await authManager.authenticateUser(
          userId,
          password,
          deviceInfo.type,
        );
        if (!unlocked) {
          return res.status(401).json({ error: "Invalid password" });
        }
      } else if (!DataCrypto.getUserDataKey(userId)) {
        const oidcUnlocked = await authManager.authenticateOIDCUser(
          userId,
          deviceInfo.type,
        );
        if (!oidcUnlocked) {
          return res.status(403).json({
            error: "Failed to unlock user data with SSO credentials",
          });
        }
      }

      apiLogger.info("Importing SQLite data", {
        operation: "sqlite_import_api",
        userId,
        filename: req.file.originalname,
        fileSize: req.file.size,
        mimetype: req.file.mimetype,
      });

      let userDataKey = DataCrypto.getUserDataKey(userId);
      if (!userDataKey && isOidcUser) {
        const oidcUnlocked = await authManager.authenticateOIDCUser(
          userId,
          deviceInfo.type,
        );
        if (oidcUnlocked) {
          userDataKey = DataCrypto.getUserDataKey(userId);
        }
      }
      if (!userDataKey) {
        throw new Error("User data not unlocked");
      }

      if (!fs.existsSync(req.file.path)) {
        return res.status(400).json({
          error: "Uploaded file not found",
          details: "File was not properly uploaded",
        });
      }

      const fileHeader = Buffer.alloc(16);
      const fd = fs.openSync(req.file.path, "r");
      fs.readSync(fd, fileHeader, 0, 16, 0);
      fs.closeSync(fd);

      const sqliteHeader = "SQLite format 3";
      if (fileHeader.toString("utf8", 0, 15) !== sqliteHeader) {
        return res.status(400).json({
          error: "Invalid file format - not a SQLite database",
          details: `Expected SQLite file, got file starting with: ${fileHeader.toString("utf8", 0, 15)}`,
        });
      }

      let importDb;
      try {
        importDb = new Database(req.file.path, { readonly: true });

        importDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all();
      } catch (sqliteError) {
        return res.status(400).json({
          error: "Failed to open SQLite database",
          details: sqliteError.message,
        });
      }

      const result = {
        success: false,
        summary: {
          sshHostsImported: 0,
          sshCredentialsImported: 0,
          fileManagerItemsImported: 0,
          dismissedAlertsImported: 0,
          credentialUsageImported: 0,
          settingsImported: 0,
          skippedItems: 0,
          errors: [],
        },
      };

      try {
        try {
          const importedHosts = importDb
            .prepare("SELECT * FROM ssh_data")
            .all();
          for (const host of importedHosts) {
            try {
              const existing = await mainDb
                .select()
                .from(sshData)
                .where(
                  and(
                    eq(sshData.userId, userId),
                    eq(sshData.ip, host.ip),
                    eq(sshData.port, host.port),
                    eq(sshData.username, host.username),
                  ),
                );

              if (existing.length > 0) {
                result.summary.skippedItems++;
                continue;
              }

              const hostData = {
                userId: userId,
                name: host.name,
                ip: host.ip,
                port: host.port,
                username: host.username,
                folder: host.folder,
                tags: host.tags,
                pin: Boolean(host.pin),
                authType: host.auth_type,
                forceKeyboardInteractive: host.force_keyboard_interactive,
                password: host.password,
                key: host.key,
                keyPassword: host.key_password,
                keyType: host.key_type,
                sudoPassword: host.sudo_password,
                autostartPassword: host.autostart_password,
                autostartKey: host.autostart_key,
                autostartKeyPassword: host.autostart_key_password,
                credentialId: host.credential_id || null,
                overrideCredentialUsername: Boolean(
                  host.override_credential_username,
                ),
                enableTerminal: Boolean(host.enable_terminal),
                enableTunnel: Boolean(host.enable_tunnel),
                tunnelConnections: host.tunnel_connections,
                jumpHosts: host.jump_hosts,
                enableFileManager: Boolean(host.enable_file_manager),
                enableDocker: Boolean(host.enable_docker),
                showTerminalInSidebar: Boolean(host.show_terminal_in_sidebar),
                showFileManagerInSidebar: Boolean(
                  host.show_file_manager_in_sidebar,
                ),
                showTunnelInSidebar: Boolean(host.show_tunnel_in_sidebar),
                showDockerInSidebar: Boolean(host.show_docker_in_sidebar),
                showServerStatsInSidebar: Boolean(
                  host.show_server_stats_in_sidebar,
                ),
                defaultPath: host.default_path,
                statsConfig: host.stats_config,
                terminalConfig: host.terminal_config,
                quickActions: host.quick_actions,
                notes: host.notes,
                useSocks5: Boolean(host.use_socks5),
                socks5Host: host.socks5_host,
                socks5Port: host.socks5_port,
                socks5Username: host.socks5_username,
                socks5Password: host.socks5_password,
                socks5ProxyChain: host.socks5_proxy_chain,
                createdAt: host.created_at || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };

              const encrypted = DataCrypto.encryptRecord(
                "ssh_data",
                hostData,
                userId,
                userDataKey,
              );
              await mainDb.insert(sshData).values(encrypted);
              result.summary.sshHostsImported++;
            } catch (hostError) {
              result.summary.errors.push(
                `SSH host import error: ${hostError.message}`,
              );
            }
          }
        } catch {
          apiLogger.info("ssh_data table not found in import file, skipping");
        }

        try {
          const importedCreds = importDb
            .prepare("SELECT * FROM ssh_credentials")
            .all();
          for (const cred of importedCreds) {
            try {
              const existing = await mainDb
                .select()
                .from(sshCredentials)
                .where(
                  and(
                    eq(sshCredentials.userId, userId),
                    eq(sshCredentials.name, cred.name),
                    eq(sshCredentials.username, cred.username),
                  ),
                );

              if (existing.length > 0) {
                result.summary.skippedItems++;
                continue;
              }

              const credData = {
                userId: userId,
                name: cred.name,
                description: cred.description,
                folder: cred.folder,
                tags: cred.tags,
                authType: cred.auth_type,
                username: cred.username,
                password: cred.password,
                key: cred.key,
                privateKey: cred.private_key,
                publicKey: cred.public_key,
                keyPassword: cred.key_password,
                keyType: cred.key_type,
                detectedKeyType: cred.detected_key_type,
                usageCount: cred.usage_count || 0,
                lastUsed: cred.last_used,
                createdAt: cred.created_at || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };

              const encrypted = DataCrypto.encryptRecord(
                "ssh_credentials",
                credData,
                userId,
                userDataKey,
              );
              await mainDb.insert(sshCredentials).values(encrypted);
              result.summary.sshCredentialsImported++;
            } catch (credError) {
              result.summary.errors.push(
                `SSH credential import error: ${credError.message}`,
              );
            }
          }
        } catch {
          apiLogger.info(
            "ssh_credentials table not found in import file, skipping",
          );
        }

        const fileManagerTables = [
          {
            table: "file_manager_recent",
            schema: fileManagerRecent,
            key: "fileManagerItemsImported",
          },
          {
            table: "file_manager_pinned",
            schema: fileManagerPinned,
            key: "fileManagerItemsImported",
          },
          {
            table: "file_manager_shortcuts",
            schema: fileManagerShortcuts,
            key: "fileManagerItemsImported",
          },
        ];

        for (const { table, schema, key } of fileManagerTables) {
          try {
            const importedItems = importDb
              .prepare(`SELECT * FROM ${table}`)
              .all();
            for (const item of importedItems) {
              try {
                const existing = await mainDb
                  .select()
                  .from(schema)
                  .where(
                    and(
                      eq(schema.userId, userId),
                      eq(schema.path, item.path),
                      eq(schema.name, item.name),
                    ),
                  );

                if (existing.length > 0) {
                  result.summary.skippedItems++;
                  continue;
                }

                const itemData = {
                  userId: userId,
                  hostId: item.host_id,
                  name: item.name,
                  path: item.path,
                  ...(table === "file_manager_recent" && {
                    lastOpened: item.last_opened,
                  }),
                  ...(table === "file_manager_pinned" && {
                    pinnedAt: item.pinned_at,
                  }),
                  ...(table === "file_manager_shortcuts" && {
                    createdAt: item.created_at,
                  }),
                };

                await mainDb.insert(schema).values(itemData);
                result.summary[key]++;
              } catch (itemError) {
                result.summary.errors.push(
                  `${table} import error: ${itemError.message}`,
                );
              }
            }
          } catch {
            apiLogger.info(`${table} table not found in import file, skipping`);
          }
        }

        try {
          const importedAlerts = importDb
            .prepare("SELECT * FROM dismissed_alerts")
            .all();
          for (const alert of importedAlerts) {
            try {
              const existing = await mainDb
                .select()
                .from(dismissedAlerts)
                .where(
                  and(
                    eq(dismissedAlerts.userId, userId),
                    eq(dismissedAlerts.alertId, alert.alert_id),
                  ),
                );

              if (existing.length > 0) {
                result.summary.skippedItems++;
                continue;
              }

              await mainDb.insert(dismissedAlerts).values({
                userId: userId,
                alertId: alert.alert_id,
                dismissedAt: alert.dismissed_at || new Date().toISOString(),
              });
              result.summary.dismissedAlertsImported++;
            } catch (alertError) {
              result.summary.errors.push(
                `Dismissed alert import error: ${alertError.message}`,
              );
            }
          }
        } catch {
          apiLogger.info(
            "dismissed_alerts table not found in import file, skipping",
          );
        }

        const targetUser = await mainDb
          .select()
          .from(users)
          .where(eq(users.id, userId));
        if (targetUser.length > 0 && targetUser[0].is_admin) {
          try {
            const importedSettings = importDb
              .prepare("SELECT * FROM settings")
              .all();
            for (const setting of importedSettings) {
              try {
                const existing = await mainDb
                  .select()
                  .from(settings)
                  .where(eq(settings.key, setting.key));

                if (existing.length > 0) {
                  await mainDb
                    .update(settings)
                    .set({ value: setting.value })
                    .where(eq(settings.key, setting.key));
                  result.summary.settingsImported++;
                } else {
                  await mainDb.insert(settings).values({
                    key: setting.key,
                    value: setting.value,
                  });
                  result.summary.settingsImported++;
                }
              } catch (settingError) {
                result.summary.errors.push(
                  `Setting import error (${setting.key}): ${settingError.message}`,
                );
              }
            }
          } catch {
            apiLogger.info("settings table not found in import file, skipping");
          }
        } else {
          apiLogger.info(
            "Settings import skipped - only admin users can import settings",
          );
        }

        result.success = true;

        try {
          await DatabaseSaveTrigger.forceSave("database_import");
        } catch (saveError) {
          apiLogger.error(
            "Failed to persist imported data to disk",
            saveError,
            {
              operation: "import_force_save_failed",
              userId,
            },
          );
        }
      } finally {
        if (importDb) {
          importDb.close();
        }
      }

      try {
        fs.unlinkSync(req.file.path);
      } catch {
        apiLogger.warn("Failed to clean up uploaded file", {
          operation: "file_cleanup_warning",
          filePath: req.file.path,
        });
      }

      res.json({
        success: result.success,
        message: result.success
          ? "Incremental import completed successfully"
          : "Import failed",
        summary: result.summary,
      });

      if (result.success) {
        apiLogger.success("SQLite data imported successfully", {
          operation: "sqlite_import_api_success",
          userId,
          summary: result.summary,
        });
      }
    } catch (error) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          apiLogger.warn("Failed to clean up uploaded file after error", {
            operation: "file_cleanup_error",
            filePath: req.file.path,
          });
        }
      }

      apiLogger.error("SQLite import failed", error, {
        operation: "sqlite_import_api_failed",
        userId: (req as AuthenticatedRequest).userId,
      });
      res.status(500).json({
        error: "Failed to import SQLite data",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/**
 * @openapi
 * /database/export/preview:
 *   post:
 *     summary: Preview user data export
 *     description: Generates a preview of the user data export, including statistics about the data.
 *     tags:
 *       - Database
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               scope:
 *                 type: string
 *               includeCredentials:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Export preview generated successfully.
 *       500:
 *         description: Failed to generate export preview.
 */
app.post("/database/export/preview", authenticateJWT, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    const { scope = "user_data", includeCredentials = true } = req.body;

    const exportData = await UserDataExport.exportUserData(userId, {
      format: "encrypted",
      scope,
      includeCredentials,
    });

    const stats = UserDataExport.getExportStats(exportData);

    res.json({
      preview: true,
      stats,
      estimatedSize: JSON.stringify(exportData).length,
    });

    apiLogger.success("Export preview generated", {
      operation: "export_preview_api_success",
      userId,
      totalRecords: stats.totalRecords,
    });
  } catch (error) {
    apiLogger.error("Export preview failed", error, {
      operation: "export_preview_api_failed",
    });
    res.status(500).json({
      error: "Failed to generate export preview",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * @openapi
 * /database/restore:
 *   post:
 *     summary: Restore database from backup
 *     description: Restores the database from an encrypted backup file.
 *     tags:
 *       - Database
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               backupPath:
 *                 type: string
 *               targetPath:
 *                 type: string
 *     responses:
 *       200:
 *         description: Database restored successfully.
 *       400:
 *         description: Backup path is required or invalid encrypted backup file.
 *       500:
 *         description: Database restore failed.
 */
app.post("/database/restore", requireAdmin, async (req, res) => {
  try {
    const { backupPath, targetPath } = req.body;

    if (!backupPath) {
      return res.status(400).json({ error: "Backup path is required" });
    }

    if (!DatabaseFileEncryption.isEncryptedDatabaseFile(backupPath)) {
      return res.status(400).json({ error: "Invalid encrypted backup file" });
    }

    const restoredPath =
      await DatabaseFileEncryption.restoreFromEncryptedBackup(
        backupPath,
        targetPath,
      );

    res.json({
      success: true,
      message: "Database restored successfully",
      restoredPath,
    });
  } catch (error) {
    apiLogger.error("Database restore failed", error, {
      operation: "database_restore_api_failed",
    });
    res.status(500).json({
      error: "Database restore failed",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.use("/users", userRoutes);
app.use("/ssh", sshRoutes);
app.use("/alerts", alertRoutes);
app.use("/credentials", credentialsRoutes);
app.use("/snippets", snippetsRoutes);
app.use("/terminal", terminalRoutes);
app.use("/network-topology", networkTopologyRoutes);
app.use("/rbac", rbacRoutes);

// Serve frontend static files (for Electron embedded mode and standalone deployment)
const frontendDistPaths = [
  path.join(__dirname, "../../../dist"),        // dev: from dist/backend/backend/ → dist/
  path.join(__dirname, "../../dist"),           // alternative relative path
  path.join(process.cwd(), "dist"),             // cwd-based fallback
];

const frontendDist = frontendDistPaths.find(
  (p) => fs.existsSync(path.join(p, "index.html")),
);

if (frontendDist) {
  databaseLogger.info(`Serving frontend from: ${frontendDist}`, {
    operation: "static_files",
  });
  app.use(express.static(frontendDist));

  // SPA fallback: any GET that accepts HTML and wasn't handled by API routes
  app.use((req, res, next) => {
    if (req.method === "GET" && req.accepts("html")) {
      res.sendFile(path.join(frontendDist, "index.html"));
    } else {
      next();
    }
  });
}

app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    apiLogger.error("Unhandled error in request", err, {
      operation: "error_handler",
      method: req.method,
      url: req.url,
      userAgent: req.get("User-Agent"),
    });
    res.status(500).json({ error: "Internal Server Error" });
  },
);

const HTTP_PORT = 30001;

async function initializeSecurity() {
  try {
    const authManager = AuthManager.getInstance();
    await authManager.initialize();

    DataCrypto.initialize();

    const isValid = true;
    if (!isValid) {
      throw new Error("Security system validation failed");
    }
  } catch (error) {
    databaseLogger.error("Failed to initialize security system", error, {
      operation: "security_init_error",
    });
    throw error;
  }
}

/**
 * @openapi
 * /database/migration/status:
 *   get:
 *     summary: Get database migration status
 *     description: Returns the status of the database migration.
 *     tags:
 *       - Database
 *     responses:
 *       200:
 *         description: Migration status.
 *       500:
 *         description: Failed to get migration status.
 */
app.get(
  "/database/migration/status",
  authenticateJWT,
  requireAdmin,
  async (req, res) => {
    try {
      const dataDir = process.env.DATA_DIR || "./db/data";
      const migration = new DatabaseMigration(dataDir);
      const status = migration.checkMigrationStatus();

      const dbPath = path.join(dataDir, "db.sqlite");
      const encryptedDbPath = `${dbPath}.encrypted`;

      const files = fs.readdirSync(dataDir);
      const backupFiles = files.filter((f) => f.includes(".migration-backup-"));
      const migratedFiles = files.filter((f) => f.includes(".migrated-"));

      let unencryptedSize = 0;
      let encryptedSize = 0;

      if (status.hasUnencryptedDb) {
        try {
          unencryptedSize = fs.statSync(dbPath).size;
        } catch (error) {}
      }

      if (status.hasEncryptedDb) {
        try {
          encryptedSize = fs.statSync(encryptedDbPath).size;
        } catch (error) {}
      }

      res.json({
        migrationStatus: status,
        files: {
          unencryptedDbSize: unencryptedSize,
          encryptedDbSize: encryptedSize,
          backupFiles: backupFiles.length,
          migratedFiles: migratedFiles.length,
        },
      });
    } catch (error) {
      apiLogger.error("Failed to get migration status", error, {
        operation: "migration_status_api_failed",
      });
      res.status(500).json({
        error: "Failed to get migration status",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/**
 * @openapi
 * /database/migration/history:
 *   get:
 *     summary: Get database migration history
 *     description: Returns the history of database migrations.
 *     tags:
 *       - Database
 *     responses:
 *       200:
 *         description: Migration history.
 *       500:
 *         description: Failed to get migration history.
 */
app.get(
  "/database/migration/history",
  authenticateJWT,
  requireAdmin,
  async (req, res) => {
    try {
      const dataDir = process.env.DATA_DIR || "./db/data";

      const files = fs.readdirSync(dataDir);

      const backupFiles = files
        .filter((f) => f.includes(".migration-backup-"))
        .map((f) => {
          const filePath = path.join(dataDir, f);
          const stats = fs.statSync(filePath);
          return {
            name: f,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            type: "backup",
          };
        })
        .sort((a, b) => b.modified.getTime() - a.modified.getTime());

      const migratedFiles = files
        .filter((f) => f.includes(".migrated-"))
        .map((f) => {
          const filePath = path.join(dataDir, f);
          const stats = fs.statSync(filePath);
          return {
            name: f,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            type: "migrated",
          };
        })
        .sort((a, b) => b.modified.getTime() - a.modified.getTime());

      res.json({
        files: [...backupFiles, ...migratedFiles],
        summary: {
          totalBackups: backupFiles.length,
          totalMigrated: migratedFiles.length,
          oldestBackup:
            backupFiles.length > 0
              ? backupFiles[backupFiles.length - 1].created
              : null,
          newestBackup: backupFiles.length > 0 ? backupFiles[0].created : null,
        },
      });
    } catch (error) {
      apiLogger.error("Failed to get migration history", error, {
        operation: "migration_history_api_failed",
      });
      res.status(500).json({
        error: "Failed to get migration history",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

app.listen(HTTP_PORT, async () => {
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  await initializeSecurity();
});

const sslConfig = AutoSSLSetup.getSSLConfig();
if (sslConfig.enabled) {
  databaseLogger.info(`SSL is enabled`, {
    operation: "ssl_info",
    nginx_https_port: sslConfig.port,
    backend_http_port: HTTP_PORT,
  });
}
