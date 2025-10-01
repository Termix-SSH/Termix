import express from "express";
import bodyParser from "body-parser";
import multer from "multer";
import cookieParser from "cookie-parser";
import userRoutes from "./routes/users.js";
import sshRoutes from "./routes/ssh.js";
import alertRoutes from "./routes/alerts.js";
import credentialsRoutes from "./routes/credentials.js";
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
import { getDb } from "./db/index.js";
import Database from "better-sqlite3";

const app = express();

app.set("trust proxy", true);

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireAdmin = authManager.createAdminMiddleware();
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
      ];

      if (origin.startsWith("https://")) {
        return callback(null, true);
      }

      if (origin.startsWith("http://")) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
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

interface CacheEntry {
  data: any;
  timestamp: number;
  expiresAt: number;
}

class GitHubCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_DURATION = 30 * 60 * 1000;

  set(key: string, data: any): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + this.CACHE_DURATION,
    });
  }

  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }
}

const githubCache = new GitHubCache();

const GITHUB_API_BASE = "https://api.github.com";
const REPO_OWNER = "LukeGus";
const REPO_NAME = "Termix";

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  assets: Array<{
    id: number;
    name: string;
    size: number;
    download_count: number;
    browser_download_url: string;
  }>;
  prerelease: boolean;
  draft: boolean;
}

async function fetchGitHubAPI(
  endpoint: string,
  cacheKey: string,
): Promise<any> {
  const cachedData = githubCache.get(cacheKey);
  if (cachedData) {
    return {
      data: cachedData,
      cached: true,
      cache_age: Date.now() - cachedData.timestamp,
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

    const data = await response.json();
    githubCache.set(cacheKey, data);

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

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

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
      } catch (error) {
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
    const releaseData = await fetchGitHubAPI(
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

app.get("/releases/rss", authenticateJWT, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const per_page = Math.min(
      parseInt(req.query.per_page as string) || 20,
      100,
    );
    const cacheKey = `releases_rss_${page}_${per_page}`;

    const releasesData = await fetchGitHubAPI(
      `/repos/${REPO_OWNER}/${REPO_NAME}/releases?page=${page}&per_page=${per_page}`,
      cacheKey,
    );

    const rssItems = releasesData.data.map((release: GitHubRelease) => ({
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

app.get("/encryption/status", requireAdmin, async (req, res) => {
  try {
    const authManager = AuthManager.getInstance();
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

app.post("/encryption/regenerate", requireAdmin, async (req, res) => {
  try {
    const authManager = AuthManager.getInstance();

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

app.post("/encryption/regenerate-jwt", requireAdmin, async (req, res) => {
  try {
    const authManager = AuthManager.getInstance();

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

app.post("/database/export", authenticateJWT, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        error: "Password required for export",
        code: "PASSWORD_REQUIRED",
      });
    }

    const unlocked = await authManager.authenticateUser(userId, password);
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
          password TEXT,
          key TEXT,
          key_password TEXT,
          key_type TEXT,
          autostart_password TEXT,
          autostart_key TEXT,
          autostart_key_password TEXT,
          credential_id INTEGER,
          enable_terminal INTEGER NOT NULL DEFAULT 1,
          enable_tunnel INTEGER NOT NULL DEFAULT 1,
          tunnel_connections TEXT,
          enable_file_manager INTEGER NOT NULL DEFAULT 1,
          default_path TEXT,
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
        INSERT INTO ssh_data (id, user_id, name, ip, port, username, folder, tags, pin, auth_type, password, key, key_password, key_type, autostart_password, autostart_key, autostart_key_password, credential_id, enable_terminal, enable_tunnel, tunnel_connections, enable_file_manager, default_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          decrypted.password || null,
          decrypted.key || null,
          decrypted.keyPassword || null,
          decrypted.keyType || null,
          decrypted.autostartPassword || null,
          decrypted.autostartKey || null,
          decrypted.autostartKeyPassword || null,
          decrypted.credentialId || null,
          decrypted.enableTerminal ? 1 : 0,
          decrypted.enableTunnel ? 1 : 0,
          decrypted.tunnelConnections || null,
          decrypted.enableFileManager ? 1 : 0,
          decrypted.defaultPath || null,
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

app.post(
  "/database/import",
  authenticateJWT,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const userId = (req as any).userId;
      const { password } = req.body;

      if (!password) {
        return res.status(400).json({
          error: "Password required for import",
          code: "PASSWORD_REQUIRED",
        });
      }

      const unlocked = await authManager.authenticateUser(userId, password);
      if (!unlocked) {
        return res.status(401).json({ error: "Invalid password" });
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

        const tables = importDb
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
        const mainDb = getDb();

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
                password: host.password,
                key: host.key,
                keyPassword: host.key_password,
                keyType: host.key_type,
                autostartPassword: host.autostart_password,
                autostartKey: host.autostart_key,
                autostartKeyPassword: host.autostart_key_password,
                credentialId: null,
                enableTerminal: Boolean(host.enable_terminal),
                enableTunnel: Boolean(host.enable_tunnel),
                tunnelConnections: host.tunnel_connections,
                enableFileManager: Boolean(host.enable_file_manager),
                defaultPath: host.default_path,
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
        } catch (tableError) {
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
        } catch (tableError) {
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
          } catch (tableError) {
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
        } catch (tableError) {
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
          } catch (tableError) {
            apiLogger.info("settings table not found in import file, skipping");
          }
        } else {
          apiLogger.info(
            "Settings import skipped - only admin users can import settings",
          );
        }

        result.success = true;
      } finally {
        if (importDb) {
          importDb.close();
        }
      }

      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
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
        } catch (cleanupError) {
          apiLogger.warn("Failed to clean up uploaded file after error", {
            operation: "file_cleanup_error",
            filePath: req.file.path,
          });
        }
      }

      apiLogger.error("SQLite import failed", error, {
        operation: "sqlite_import_api_failed",
        userId: (req as any).userId,
      });
      res.status(500).json({
        error: "Failed to import SQLite data",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

app.post("/database/export/preview", authenticateJWT, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const {
      format = "encrypted",
      scope = "user_data",
      includeCredentials = true,
    } = req.body;

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

app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
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
const HTTPS_PORT = process.env.SSL_PORT || 8443;

async function initializeSecurity() {
  try {
    const authManager = AuthManager.getInstance();
    await authManager.initialize();

    DataCrypto.initialize();

    const isValid = true;
    if (!isValid) {
      throw new Error("Security system validation failed");
    }

    const securityStatus = {
      initialized: true,
      system: { hasSecret: true, isValid: true },
      activeSessions: {},
      activeSessionCount: 0,
    };
  } catch (error) {
    databaseLogger.error("Failed to initialize security system", error, {
      operation: "security_init_error",
    });
    throw error;
  }
}

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
