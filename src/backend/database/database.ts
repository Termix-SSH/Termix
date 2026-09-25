import { getErrorMessage } from "../utils/error-message.js";
import express from "express";
import http from "http";
import https from "https";
import bodyParser from "body-parser";
import multer from "multer";
import cookieParser from "cookie-parser";
import userRoutes from "./routes/users.js";
import hostRoutes from "./routes/host.js";
import {
  registerTermixIdCompatRoutes,
  registerVaultCompatRoutes,
} from "./routes/host-compat-routes.js";
import alertRoutes from "./routes/alerts.js";
import credentialsRoutes from "./routes/credentials.js";
import sshAuthRoutes from "./routes/ssh-auth-routes.js";
import rbacRoutes from "./routes/rbac.js";
import openTabsRoutes from "./routes/open-tabs.js";
import userPreferencesRoutes from "./routes/user-preferences.js";
import hostSidebarPreferencesRoutes from "./routes/host-sidebar-preferences.js";
import credentialSidebarPreferencesRoutes from "./routes/credential-sidebar-preferences.js";
import uiPreferencesRoutes from "./routes/ui-preferences.js";
import { registerAuditLogRoutes } from "./routes/audit-log-routes.js";
import notificationChannelsRoutes from "./routes/notification-channels-routes.js";
import syncRoutes from "./routes/sync.js";
import dashboardRoutes from "./routes/dashboard-routes.js";
import { mountPluginApi } from "./routes/plugin-api-routes.js";
import { attachPluginWebSockets } from "../plugins/ws.js";
import pluginRoutes from "./routes/plugins.js";
import { createPluginAssetsRouter } from "../plugins/assets.js";
import { getPluginRuntime } from "../plugins/index.js";
import { createCorsMiddleware } from "../utils/cors-config.js";
import { createCompressionMiddleware } from "../utils/compression-config.js";
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
import { configureDirectHttps, getTlsConfig } from "../tls/tls-service.js";
import { acmeChallengeHandler } from "../tls/acme-challenges.js";
import {
  createCurrentCredentialRepository,
  createCurrentDismissedAlertRepository,
  createCurrentHostRepository,
  createCurrentSettingsRepository,
  createCurrentSshCredentialUsageRepository,
  createCurrentUserRepository,
} from "./repositories/factory.js";
import { withCurrentSqliteForeignKeysDisabled } from "./repositories/sqlite-foreign-keys.js";
import { parseUserAgent } from "../utils/user-agent-parser.js";
import { getProxyAgent } from "../utils/proxy-agent.js";
import type {
  CacheEntry,
  GitHubRelease,
  GitHubAPIResponse,
  AuthenticatedRequest,
} from "../../types/index.js";
import { DatabaseSaveTrigger, getDb } from "./db/index.js";
import { sql } from "drizzle-orm";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set("trust proxy", "loopback");

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireAdmin = authManager.createAdminMiddleware();
app.use(createCompressionMiddleware());
app.use(createCorsMiddleware());

type SettingData = {
  key: string;
  value: string;
};

function shouldExportSetting(key: string): boolean {
  return !key.startsWith("reset_code_") && !key.startsWith("temp_reset_token_");
}

async function getExportableSettings(): Promise<SettingData[]> {
  const settingsRows = await createCurrentSettingsRepository().listAll();

  return settingsRows.filter((setting) => shouldExportSetting(setting.key));
}

function writeSettingsToExportDatabase(
  exportDb: Database.Database,
  settingsRows: SettingData[],
): void {
  const insertSetting = exportDb.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
  `);

  for (const setting of settingsRows) {
    insertSetting.run(setting.key, setting.value);
  }
}

function readImportedSettings(importDb: Database.Database): SettingData[] {
  return importDb
    .prepare("SELECT key, value FROM settings")
    .all() as SettingData[];
}

async function upsertImportedSetting(setting: SettingData): Promise<void> {
  await createCurrentSettingsRepository().upsert(setting.key, setting.value);
}

const uploadsDir = path.join(process.env.DATA_DIR || "./db/data", "uploads");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
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

function parseSemver(
  version: string | undefined,
): [number, number, number] | null {
  const match = String(version || "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;

  return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
}

function compareSemver(
  a: string | undefined,
  b: string | undefined,
): number | null {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);
  if (!parsedA || !parsedB) return null;

  for (let i = 0; i < 3; i += 1) {
    if (parsedA[i] > parsedB[i]) return 1;
    if (parsedA[i] < parsedB[i]) return -1;
  }

  return 0;
}

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
    const url = `${GITHUB_API_BASE}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "TermixUpdateChecker/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      dispatcher: getProxyAgent(url),
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

// Skipped for /plugin-api: a plugin router brings its own parsers with its own
// limit (see plugins/http.ts), and parsing here first would consume the body
// and silently cap every plugin at this limit instead.
const coreJsonParser = bodyParser.json({ limit: "2mb" });
const coreUrlencodedParser = bodyParser.urlencoded({
  limit: "2mb",
  extended: true,
});

app.use((req, res, next) => {
  if (req.path.startsWith("/plugin-api/")) return next();
  coreJsonParser(req, res, next);
});
app.use((req, res, next) => {
  if (req.path.startsWith("/plugin-api/")) return next();
  coreUrlencodedParser(req, res, next);
});
app.use(cookieParser());
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

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
 * /.well-known/acme-challenge/{token}:
 *   get:
 *     summary: Answer an ACME http-01 challenge
 *     description: Public. Serves the key authorization a plugin published through ctx.system.publishHttpChallenge while it proves control of the domain.
 *     tags:
 *       - General
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The key authorization, as text/plain.
 *       404:
 *         description: No challenge is published for this token.
 */
app.get("/.well-known/acme-challenge/:token", acmeChallengeHandler);

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

  if (req.query.checkRemote === "false") {
    return res.json({ localVersion, status: "update_check_disabled" });
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
      return res.json({ localVersion, status: "unknown" });
    }

    const versionComparison = compareSemver(localVersion, remoteVersion);
    const status =
      versionComparison === null || versionComparison === 0
        ? "up_to_date"
        : versionComparison > 0
          ? "beta"
          : "requires_update";

    const response = {
      status,
      localVersion: localVersion,
      version: remoteVersion,
      remoteVersion: remoteVersion,
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
    res.json({ localVersion, status: "unknown" });
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
      details: getErrorMessage(error),
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
    const deviceInfo = parseUserAgent(req);

    const userRepository = createCurrentUserRepository();
    const user = await userRepository.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const isOidcUser = !!user.isOidc;

    if (!DataCrypto.getUserDataKey(userId)) {
      if (isOidcUser) {
        const oidcUnlocked = await authManager.authenticateOIDCUser(
          userId,
          deviceInfo.type,
        );
        if (!oidcUnlocked) {
          return res.status(403).json({
            error: "Failed to unlock user data with SSO credentials",
          });
        }
      } else {
        return res.status(403).json({
          error: "User data is locked. Please log in again.",
        });
      }
    }

    apiLogger.info("Exporting user data as SQLite", {
      operation: "user_data_sqlite_export_api",
      userId,
    });

    const userDataKey = DataCrypto.getUserDataKey(userId);
    if (!userDataKey) {
      throw new Error("User data not unlocked");
    }

    const tempDir = path.join(os.tmpdir(), "termix-exports");

    try {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
    } catch (dirError) {
      apiLogger.error("Failed to create temp directory", dirError, {
        operation: "export_temp_dir_error",
        tempDir,
      });
      throw new Error(`Failed to create temp directory: ${dirError.message}`, {
        cause: dirError,
      });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `termix-export-${user.username}-${timestamp}.sqlite`;
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
          scopes TEXT DEFAULT 'openid email profile'
        );

        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE ssh_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          connection_type TEXT NOT NULL DEFAULT 'ssh',
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
          enable_web_ui INTEGER NOT NULL DEFAULT 0,
          show_terminal_in_sidebar INTEGER NOT NULL DEFAULT 1,
          show_file_manager_in_sidebar INTEGER NOT NULL DEFAULT 0,
          show_tunnel_in_sidebar INTEGER NOT NULL DEFAULT 0,
          show_docker_in_sidebar INTEGER NOT NULL DEFAULT 0,
          show_server_stats_in_sidebar INTEGER NOT NULL DEFAULT 0,
          default_path TEXT,
          status_check_enabled INTEGER NOT NULL DEFAULT 1,
          status_check_interval INTEGER,
          web_ui_config TEXT,
          terminal_config TEXT,
          quick_actions TEXT,
          notes TEXT,
          use_socks5 INTEGER,
          socks5_host TEXT,
          socks5_port INTEGER,
          socks5_username TEXT,
          socks5_password TEXT,
          socks5_proxy_chain TEXT,
          domain TEXT,
          port_knock_sequence TEXT,
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
          username TEXT,
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

        CREATE TABLE p_file_manager_recent (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          host_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          last_opened TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE p_file_manager_pinned (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          host_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          pinned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE p_file_manager_shortcuts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          host_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE p_file_manager_transfer_recent (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          source_host_id INTEGER NOT NULL,
          dest_host_id INTEGER NOT NULL,
          dest_path TEXT NOT NULL,
          dest_path_label TEXT NOT NULL,
          last_used TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

      const userRecord = user;
      const insertUser = exportDb.prepare(`
        INSERT INTO users (id, username, password_hash, is_admin, is_oidc, oidc_identifier, client_id, client_secret, issuer_url, authorization_url, token_url, identifier_path, name_path, scopes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertUser.run(
        userRecord.id,
        userRecord.username,
        "[EXPORTED_USER_NO_PASSWORD]",
        userRecord.isAdmin ? 1 : 0,
        userRecord.isOidc ? 1 : 0,
        userRecord.oidcIdentifier || null,
        userRecord.clientId || null,
        userRecord.clientSecret || null,
        userRecord.issuerUrl || null,
        userRecord.authorizationUrl || null,
        userRecord.tokenUrl || null,
        userRecord.identifierPath || null,
        userRecord.namePath || null,
        userRecord.scopes || null,
      );

      const sshHosts =
        await createCurrentHostRepository().listDecryptedByUserId(userId);
      const insertHost = exportDb.prepare(`
        INSERT INTO ssh_data (id, user_id, connection_type, name, ip, port, username, folder, tags, pin, auth_type, force_keyboard_interactive, password, key, key_password, key_type, sudo_password, autostart_password, autostart_key, autostart_key_password, credential_id, override_credential_username, enable_terminal, enable_tunnel, tunnel_connections, jump_hosts, enable_file_manager, enable_web_ui, show_terminal_in_sidebar, show_file_manager_in_sidebar, show_tunnel_in_sidebar, show_docker_in_sidebar, show_server_stats_in_sidebar, default_path, status_check_enabled, status_check_interval, web_ui_config, terminal_config, quick_actions, notes, use_socks5, socks5_host, socks5_port, socks5_username, socks5_password, socks5_proxy_chain, domain, port_knock_sequence, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const decrypted of sshHosts) {
        insertHost.run(
          decrypted.id,
          decrypted.userId,
          decrypted.connectionType || "ssh",
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
          decrypted.keyPassword || null,
          decrypted.keyType || null,
          decrypted.sudoPassword || null,
          decrypted.autostartPassword || null,
          decrypted.autostartKey || null,
          decrypted.autostartKeyPassword || null,
          decrypted.credentialId || null,
          decrypted.overrideCredentialUsername ? 1 : 0,
          decrypted.enableTerminal ? 1 : 0,
          decrypted.enableTunnel ? 1 : 0,
          decrypted.tunnelConnections || null,
          decrypted.jumpHosts || null,
          decrypted.enableFileManager ? 1 : 0,
          decrypted.enableWebUi ? 1 : 0,
          decrypted.showTerminalInSidebar ? 1 : 0,
          decrypted.showFileManagerInSidebar ? 1 : 0,
          decrypted.showTunnelInSidebar ? 1 : 0,
          decrypted.showDockerInSidebar ? 1 : 0,
          decrypted.showServerStatsInSidebar ? 1 : 0,
          decrypted.defaultPath || null,
          decrypted.statusCheckEnabled === false ? 0 : 1,
          decrypted.statusCheckInterval ?? null,
          decrypted.webUiConfig || null,
          decrypted.terminalConfig || null,
          decrypted.quickActions || null,
          decrypted.notes || null,
          decrypted.useSocks5 ? 1 : 0,
          decrypted.socks5Host || null,
          decrypted.socks5Port || null,
          decrypted.socks5Username || null,
          decrypted.socks5Password || null,
          decrypted.socks5ProxyChain || null,
          decrypted.domain || null,
          decrypted.portKnockSequence || null,
          decrypted.createdAt,
          decrypted.updatedAt,
        );
      }

      const credentials =
        await createCurrentCredentialRepository().listDecryptedByUserId(userId);
      const insertCred = exportDb.prepare(`
        INSERT INTO ssh_credentials (id, user_id, name, description, folder, tags, auth_type, username, password, key, private_key, public_key, key_password, key_type, detected_key_type, usage_count, last_used, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const decrypted of credentials) {
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
          decrypted.privateKey || null,
          decrypted.publicKey || null,
          decrypted.keyPassword || null,
          decrypted.keyType || null,
          decrypted.detectedKeyType || null,
          decrypted.usageCount || 0,
          decrypted.lastUsed || null,
          decrypted.createdAt,
          decrypted.updatedAt,
        );
      }

      // The file manager plugin owns these tables now (p_file_manager_*);
      // read them by raw SQL rather than importing plugin code into core.
      const drizzleDb = getDb();
      const [recentFiles, pinnedFiles, shortcuts] = await Promise.all([
        drizzleDb.all<{
          id: number;
          user_id: string;
          host_id: number;
          name: string;
          path: string;
          last_opened: string;
        }>(
          sql`SELECT id, user_id, host_id, name, path, last_opened FROM p_file_manager_recent WHERE user_id = ${userId}`,
        ),
        drizzleDb.all<{
          id: number;
          user_id: string;
          host_id: number;
          name: string;
          path: string;
          pinned_at: string;
        }>(
          sql`SELECT id, user_id, host_id, name, path, pinned_at FROM p_file_manager_pinned WHERE user_id = ${userId}`,
        ),
        drizzleDb.all<{
          id: number;
          user_id: string;
          host_id: number;
          name: string;
          path: string;
          created_at: string;
        }>(
          sql`SELECT id, user_id, host_id, name, path, created_at FROM p_file_manager_shortcuts WHERE user_id = ${userId}`,
        ),
      ]);

      const insertRecent = exportDb.prepare(`
        INSERT INTO p_file_manager_recent (id, user_id, host_id, name, path, last_opened)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const item of recentFiles) {
        insertRecent.run(
          item.id,
          item.user_id,
          item.host_id,
          item.name,
          item.path,
          item.last_opened,
        );
      }

      const insertPinned = exportDb.prepare(`
        INSERT INTO p_file_manager_pinned (id, user_id, host_id, name, path, pinned_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const item of pinnedFiles) {
        insertPinned.run(
          item.id,
          item.user_id,
          item.host_id,
          item.name,
          item.path,
          item.pinned_at,
        );
      }

      const insertShortcut = exportDb.prepare(`
        INSERT INTO p_file_manager_shortcuts (id, user_id, host_id, name, path, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const item of shortcuts) {
        insertShortcut.run(
          item.id,
          item.user_id,
          item.host_id,
          item.name,
          item.path,
          item.created_at,
        );
      }

      const dismissedAlertRepository = createCurrentDismissedAlertRepository();
      const alerts = await dismissedAlertRepository.listByUserId(userId);
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

      const sshCredentialUsageRepository =
        createCurrentSshCredentialUsageRepository();
      const usage = await sshCredentialUsageRepository.listByUserId(userId);
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

      writeSettingsToExportDatabase(exportDb, await getExportableSettings());
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
      details: getErrorMessage(error),
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
      const deviceInfo = parseUserAgent(req);

      const userRepository = createCurrentUserRepository();
      const userRecord = await userRepository.findById(userId);

      if (!userRecord) {
        return res.status(404).json({ error: "User not found" });
      }

      const isOidcUser = !!userRecord.isOidc;

      if (!DataCrypto.getUserDataKey(userId)) {
        if (isOidcUser) {
          const oidcUnlocked = await authManager.authenticateOIDCUser(
            userId,
            deviceInfo.type,
          );
          if (!oidcUnlocked) {
            return res.status(403).json({
              error: "Failed to unlock user data with SSO credentials",
            });
          }
        } else {
          return res.status(403).json({
            error: "User data is locked. Please log in again.",
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

      const userDataKey = DataCrypto.getUserDataKey(userId);
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
        await withCurrentSqliteForeignKeysDisabled(async () => {
          try {
            const importedHosts = importDb
              .prepare("SELECT * FROM ssh_data")
              .all();
            for (const host of importedHosts) {
              try {
                const hostRepository = createCurrentHostRepository();
                const exists = await hostRepository.existsForImportIdentity(
                  userId,
                  host.ip,
                  host.port,
                  host.username,
                );

                if (exists) {
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
                  ...legacyStatusCheck(host),
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

                await hostRepository.createEncryptedForUser(userId, hostData);
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
                const credentialRepository =
                  createCurrentCredentialRepository();
                const exists =
                  await credentialRepository.existsForImportIdentity(
                    userId,
                    cred.name,
                    cred.username,
                  );

                if (exists) {
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

                await credentialRepository.createEncryptedForUser(
                  userId,
                  credData,
                );
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

          // The file manager plugin owns these tables now (p_file_manager_*).
          // Older export files still have the legacy name, so try that too.
          const fileManagerTables = [
            {
              tableNames: ["p_file_manager_recent", "file_manager_recent"],
              physicalTable: "p_file_manager_recent",
              dateColumn: "last_opened",
              key: "fileManagerItemsImported",
            },
            {
              tableNames: ["p_file_manager_pinned", "file_manager_pinned"],
              physicalTable: "p_file_manager_pinned",
              dateColumn: "pinned_at",
              key: "fileManagerItemsImported",
            },
            {
              tableNames: [
                "p_file_manager_shortcuts",
                "file_manager_shortcuts",
              ],
              physicalTable: "p_file_manager_shortcuts",
              dateColumn: "created_at",
              key: "fileManagerItemsImported",
            },
          ];

          const importDrizzleDb = getDb();

          for (const {
            tableNames,
            physicalTable,
            dateColumn,
            key,
          } of fileManagerTables) {
            let importedItems: Array<Record<string, unknown>> | null = null;
            let sourceTable = "";
            for (const tableName of tableNames) {
              try {
                importedItems = importDb
                  .prepare(`SELECT * FROM ${tableName}`)
                  .all() as Array<Record<string, unknown>>;
                sourceTable = tableName;
                break;
              } catch {
                // try the next name
              }
            }

            if (importedItems === null) {
              apiLogger.info(
                `${physicalTable} table not found in import file, skipping`,
              );
              continue;
            }

            for (const item of importedItems) {
              try {
                const hostId = item.host_id as number;
                const path = item.path as string;
                const name =
                  (item.name as string) || path.split("/").pop() || "Unknown";
                const dateValue =
                  (item[dateColumn] as string) || new Date().toISOString();

                const existing = await importDrizzleDb.all<{ id: number }>(
                  sql`SELECT id FROM ${sql.raw(physicalTable)} WHERE user_id = ${userId} AND host_id = ${hostId} AND path = ${path}`,
                );

                if (existing.length > 0) {
                  result.summary.skippedItems++;
                  continue;
                }

                await importDrizzleDb.run(
                  sql`INSERT INTO ${sql.raw(physicalTable)} (user_id, host_id, path, name, ${sql.raw(dateColumn)}) VALUES (${userId}, ${hostId}, ${path}, ${name}, ${dateValue})`,
                );
                result.summary[key]++;
              } catch (itemError) {
                result.summary.errors.push(
                  `${sourceTable} import error: ${itemError.message}`,
                );
              }
            }
          }

          const dismissedAlertRepository =
            createCurrentDismissedAlertRepository();

          try {
            const importedAlerts = importDb
              .prepare("SELECT * FROM dismissed_alerts")
              .all();
            for (const alert of importedAlerts) {
              try {
                const created = await dismissedAlertRepository.createForImport(
                  userId,
                  alert.alert_id,
                  alert.dismissed_at,
                );
                if (created) {
                  result.summary.dismissedAlertsImported++;
                } else {
                  result.summary.skippedItems++;
                }
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

          const targetUser = await userRepository.findById(userId);
          if (targetUser?.isAdmin) {
            try {
              const importedSettings = readImportedSettings(importDb);
              for (const setting of importedSettings) {
                try {
                  await upsertImportedSetting(setting);
                  result.summary.settingsImported++;
                } catch (settingError) {
                  result.summary.errors.push(
                    `Setting import error (${setting.key}): ${settingError.message}`,
                  );
                }
              }
            } catch {
              apiLogger.info(
                "settings table not found in import file, skipping",
              );
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
        });
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
        details: getErrorMessage(error),
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
      details: getErrorMessage(error),
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
      details: getErrorMessage(error),
    });
  }
});

app.use("/users", userRoutes);
app.use("/host", hostRoutes);
app.use("/alerts", alertRoutes);
app.use("/credentials", credentialsRoutes);
app.use("/ssh-auth", sshAuthRoutes);
app.use("/rbac", rbacRoutes);
app.use("/open-tabs", openTabsRoutes);
app.use("/user-preferences", userPreferencesRoutes);
app.use("/host-sidebar/preferences", hostSidebarPreferencesRoutes);
app.use("/credential-sidebar/preferences", credentialSidebarPreferencesRoutes);
app.use("/ui-preferences", uiPreferencesRoutes);
const termixIdCompatRoutes = express.Router();
registerTermixIdCompatRoutes(termixIdCompatRoutes);
app.use("/termix-id", termixIdCompatRoutes);
registerAuditLogRoutes(app, authenticateJWT);
const vaultCompatRoutes = express.Router();
registerVaultCompatRoutes(vaultCompatRoutes);
app.use("/vault", vaultCompatRoutes);
app.use("/", notificationChannelsRoutes);
app.use("/sync", syncRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/plugins", pluginRoutes);
app.use(
  "/plugin-assets",
  createPluginAssetsRouter((id) => getPluginRuntime().loader.get(id)),
);
mountPluginApi(app);

const frontendDistPaths = [
  path.join(__dirname, "../../../dist"),
  path.join(__dirname, "../../dist"),
  path.join(process.cwd(), "dist"),
];

const frontendDist = frontendDistPaths.find((p) =>
  fs.existsSync(path.join(p, "index.html")),
);

if (frontendDist) {
  databaseLogger.info(`Serving frontend from: ${frontendDist}`, {
    operation: "static_files",
  });
  app.use(
    express.static(frontendDist, {
      setHeaders: (res, filePath) => {
        const relativePath = path
          .relative(frontendDist, filePath)
          .replaceAll(path.sep, "/");

        if (relativePath.startsWith("assets/")) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          return;
        }

        if (
          relativePath === "index.html" ||
          relativePath === "sw.js" ||
          relativePath === "manifest.json"
        ) {
          res.setHeader(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          );
        }
      },
    }),
  );

  app.use((req, res, next) => {
    if (
      req.method === "GET" &&
      req.accepts("html") &&
      !req.headers.authorization
    ) {
      res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      );
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
    void _next;
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
        } catch {
          // expected - file may not exist
        }
      }

      if (status.hasEncryptedDb) {
        try {
          encryptedSize = fs.statSync(encryptedDbPath).size;
        } catch {
          // expected - file may not exist
        }
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
        details: getErrorMessage(error),
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
        details: getErrorMessage(error),
      });
    }
  },
);

const httpServer = http.createServer(app);

// Plugin sockets ride this server at /plugin-ws/<id>/<path>. Anything else is
// left alone, so core's own upgrade handling is unaffected.
attachPluginWebSockets(httpServer);

httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    databaseLogger.error(
      `Port ${HTTP_PORT} is already in use. Kill the existing process and retry.`,
      err,
      {
        operation: "http_server_port_conflict",
        port: HTTP_PORT,
      },
    );
    process.exit(1);
  }
  throw err;
});

export const serverReady = new Promise<void>((resolve) => {
  httpServer.listen(HTTP_PORT, "127.0.0.1", async () => {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    await initializeSecurity();
    resolve();
  });
});

const sslConfig = getTlsConfig();
if (sslConfig.enabled) {
  databaseLogger.info(`SSL is enabled`, {
    operation: "ssl_info",
    ssl_port: sslConfig.port,
    backend_http_port: HTTP_PORT,
  });
}

// Built through the TLS service so a new certificate can be swapped in, or
// HTTPS started, without a restart.
void configureDirectHttps((options) => {
  const port = getTlsConfig().port;
  const httpsServer = https.createServer(options, app);

  attachPluginWebSockets(httpsServer);

  httpsServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      databaseLogger.error(
        `SSL port ${port} is already in use. Kill the existing process and retry.`,
        err,
        {
          operation: "https_server_port_conflict",
          port,
        },
      );
      return;
    }
    databaseLogger.error("HTTPS server error", err, {
      operation: "https_server_error",
    });
  });

  httpsServer.listen(port, "127.0.0.1", () => {
    databaseLogger.success(`Backend is now also listening for HTTPS directly`, {
      operation: "https_server_started",
      port,
    });
  });
  return httpsServer;
});

/**
 * Status check columns from an export row. Exports from before 2.9.0 only
 * have stats_config, which carried them.
 */
function legacyStatusCheck(row: Record<string, unknown>): {
  statusCheckEnabled: boolean;
  statusCheckInterval: number | null;
} {
  if (row.status_check_enabled !== undefined) {
    return {
      statusCheckEnabled: Boolean(row.status_check_enabled),
      statusCheckInterval:
        typeof row.status_check_interval === "number"
          ? row.status_check_interval
          : null,
    };
  }
  let legacy: Record<string, unknown> = {};
  try {
    legacy =
      typeof row.stats_config === "string" && row.stats_config
        ? JSON.parse(row.stats_config)
        : {};
  } catch {
    legacy = {};
  }
  const seconds = Number(legacy.statusCheckInterval);
  return {
    statusCheckEnabled:
      legacy.statusCheckEnabled !== false && legacy.disableTcpPing !== true,
    statusCheckInterval:
      legacy.useGlobalStatusInterval === false &&
      Number.isInteger(seconds) &&
      seconds >= 5
        ? seconds
        : null,
  };
}
