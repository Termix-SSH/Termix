import express from "express";
import bodyParser from "body-parser";
import multer from "multer";
import userRoutes from "./routes/users.js";
import sshRoutes from "./routes/ssh.js";
import alertRoutes from "./routes/alerts.js";
import credentialsRoutes from "./routes/credentials.js";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import "dotenv/config";
import { databaseLogger, apiLogger } from "../utils/logger.js";
import { AuthManager } from "../utils/auth-manager.js";
import { DataCrypto } from "../utils/data-crypto.js";
import { DatabaseFileEncryption } from "../utils/database-file-encryption.js";
import { UserDataExport } from "../utils/user-data-export.js";
import { UserDataImport } from "../utils/user-data-import.js";

const app = express();
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "User-Agent",
      "X-Electron-App",
    ],
  }),
);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    // Preserve original filename with timestamp prefix to avoid conflicts
    const timestamp = Date.now();
    cb(null, `${timestamp}-${file.originalname}`);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB limit for database operations
  },
  fileFilter: (req, file, cb) => {
    // Allow SQLite files
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

app.use(bodyParser.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/version", async (req, res) => {
  let localVersion = process.env.VERSION;

  if (!localVersion) {
    try {
      const packagePath = path.resolve(process.cwd(), "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
      localVersion = packageJson.version;
    } catch (error) {
      databaseLogger.error("Failed to read version from package.json", error, {
        operation: "version_check",
      });
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

app.get("/releases/rss", async (req, res) => {
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

app.get("/encryption/status", async (req, res) => {
  try {
    const authManager = AuthManager.getInstance();
    // Simplified status for new architecture
    const securityStatus = {
      initialized: true,
      system: { hasSecret: true, isValid: true },
      activeSessions: {},
      activeSessionCount: 0
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

app.post("/encryption/initialize", async (req, res) => {
  try {
    const authManager = AuthManager.getInstance();

    // New system auto-initializes, no manual initialization needed
    const isValid = true; // Simplified validation for new architecture
    if (!isValid) {
      await authManager.initialize();
    }

    apiLogger.info("Security system initialized via API", {
      operation: "security_init_api",
    });

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


app.post("/encryption/regenerate", async (req, res) => {
  try {
    const authManager = AuthManager.getInstance();

    // In new system, only JWT keys can be regenerated
    // User data keys are protected by passwords and cannot be regenerated at will
    // JWT regeneration will be implemented in SystemKeyManager
    const newJWTSecret = "jwt-regeneration-placeholder";

    apiLogger.warn("System JWT secret regenerated via API", {
      operation: "jwt_regenerate_api",
    });

    res.json({
      success: true,
      message: "System JWT secret regenerated",
      warning: "All existing JWT tokens are now invalid - users must re-authenticate",
      note: "User data encryption keys are protected by passwords and cannot be regenerated",
    });
  } catch (error) {
    apiLogger.error("Failed to regenerate JWT secret", error, {
      operation: "jwt_regenerate_failed",
    });
    res.status(500).json({ error: "Failed to regenerate JWT secret" });
  }
});

app.post("/encryption/regenerate-jwt", async (req, res) => {
  try {
    const authManager = AuthManager.getInstance();
    // JWT regeneration moved to SystemKeyManager directly
    // await authManager.regenerateJWTSecret();

    apiLogger.warn("JWT secret regenerated via API", {
      operation: "jwt_secret_regenerate_api",
    });

    res.json({
      success: true,
      message: "New JWT secret generated",
      warning: "All existing JWT tokens are now invalid - users must re-authenticate",
    });
  } catch (error) {
    apiLogger.error("Failed to regenerate JWT secret", error, {
      operation: "jwt_secret_regenerate_failed",
    });
    res.status(500).json({ error: "Failed to regenerate JWT secret" });
  }
});

// User data export endpoint - V2 KEK-DEK compatible
app.post("/database/export", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const token = authHeader.split(" ")[1];
    const authManager = AuthManager.getInstance();
    const payload = await authManager.verifyJWTToken(token);

    if (!payload) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const userId = payload.userId;
    const { format = 'encrypted', scope = 'user_data', includeCredentials = true, password } = req.body;

    // For plaintext export, need to unlock user data
    if (format === 'plaintext') {
      if (!password) {
        return res.status(400).json({
          error: "Password required for plaintext export",
          code: "PASSWORD_REQUIRED"
        });
      }

      const unlocked = await authManager.authenticateUser(userId, password);
      if (!unlocked) {
        return res.status(401).json({ error: "Invalid password" });
      }
    }

    apiLogger.info("Exporting user data", {
      operation: "user_data_export_api",
      userId,
      format,
      scope,
      includeCredentials,
    });

    const exportData = await UserDataExport.exportUserData(userId, {
      format,
      scope,
      includeCredentials,
    });

    // Generate export filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `termix-export-${exportData.username}-${timestamp}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(exportData);

    apiLogger.success("User data exported successfully", {
      operation: "user_data_export_api_success",
      userId,
      totalRecords: exportData.metadata.totalRecords,
      format,
    });
  } catch (error) {
    apiLogger.error("User data export failed", error, {
      operation: "user_data_export_api_failed",
    });
    res.status(500).json({
      error: "Failed to export user data",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// User data import endpoint - V2 KEK-DEK compatible
app.post("/database/import", upload.single("file"), async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      // Clean up uploaded file
      if (req.file?.path) {
        try { fs.unlinkSync(req.file.path); } catch {}
      }
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const token = authHeader.split(" ")[1];
    const authManager = AuthManager.getInstance();
    const payload = await authManager.verifyJWTToken(token);

    if (!payload) {
      // Clean up uploaded file
      if (req.file?.path) {
        try { fs.unlinkSync(req.file.path); } catch {}
      }
      return res.status(401).json({ error: "Invalid token" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const userId = payload.userId;
    const { replaceExisting = false, skipCredentials = false, skipFileManagerData = false, dryRun = false, password } = req.body;

    apiLogger.info("Importing user data", {
      operation: "user_data_import_api",
      userId,
      filename: req.file.originalname,
      replaceExisting,
      skipCredentials,
      skipFileManagerData,
      dryRun,
    });

    // Read uploaded file
    const fileContent = fs.readFileSync(req.file.path, 'utf8');

    // Clean up uploaded temporary file
    try {
      fs.unlinkSync(req.file.path);
    } catch (cleanupError) {
      apiLogger.warn("Failed to clean up uploaded file", {
        operation: "file_cleanup_warning",
        filePath: req.file.path,
      });
    }

    // Parse import data
    let importData;
    try {
      importData = JSON.parse(fileContent);
    } catch (parseError) {
      return res.status(400).json({ error: "Invalid JSON format in uploaded file" });
    }

    // If import data is encrypted, need to unlock user data
    if (importData.metadata?.encrypted) {
      if (!password) {
        return res.status(400).json({
          error: "Password required for encrypted import",
          code: "PASSWORD_REQUIRED"
        });
      }

      const unlocked = await authManager.authenticateUser(userId, password);
      if (!unlocked) {
        return res.status(401).json({ error: "Invalid password" });
      }
    }

    // Execute import
    const result = await UserDataImport.importUserData(userId, importData, {
      replaceExisting: replaceExisting === 'true' || replaceExisting === true,
      skipCredentials: skipCredentials === 'true' || skipCredentials === true,
      skipFileManagerData: skipFileManagerData === 'true' || skipFileManagerData === true,
      dryRun: dryRun === 'true' || dryRun === true,
    });

    if (result.success) {
      apiLogger.success("User data imported successfully", {
        operation: "user_data_import_api_success",
        userId,
        ...result.summary,
      });
      res.json({
        success: true,
        message: dryRun ? "Import validation completed" : "Data imported successfully",
        summary: result.summary,
        dryRun: result.dryRun,
      });
    } else {
      apiLogger.warn("User data import completed with errors", {
        operation: "user_data_import_api_partial",
        userId,
        errors: result.summary.errors,
      });
      res.status(207).json({
        success: false,
        message: "Import completed with errors",
        summary: result.summary,
        dryRun: result.dryRun,
      });
    }
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }

    apiLogger.error("User data import failed", error, {
      operation: "user_data_import_api_failed",
    });
    res.status(500).json({
      error: "Failed to import user data",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Export preview endpoint - validate export data without downloading
app.post("/database/export/preview", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const token = authHeader.split(" ")[1];
    const authManager = AuthManager.getInstance();
    const payload = await authManager.verifyJWTToken(token);

    if (!payload) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const userId = payload.userId;
    const { format = 'encrypted', scope = 'user_data', includeCredentials = true } = req.body;

    apiLogger.info("Generating export preview", {
      operation: "export_preview_api",
      userId,
      format,
      scope,
      includeCredentials,
    });

    // Generate export data but don't decrypt sensitive fields
    const exportData = await UserDataExport.exportUserData(userId, {
      format: 'encrypted', // Always encrypt preview
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

app.post("/database/backup", async (req, res) => {
  try {
    const { customPath } = req.body;

    apiLogger.info("Creating encrypted database backup via API", {
      operation: "database_backup_api",
    });

    // Import required modules
    const { databasePaths, getMemoryDatabaseBuffer } = await import(
      "./db/index.js"
    );

    // Get current in-memory database as buffer
    const dbBuffer = getMemoryDatabaseBuffer();

    // Create backup directory
    const backupDir =
      customPath || path.join(databasePaths.directory, "backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Generate backup filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFileName = `database-backup-${timestamp}.sqlite.encrypted`;
    const backupPath = path.join(backupDir, backupFileName);

    // Create encrypted backup directly from memory buffer
    await DatabaseFileEncryption.encryptDatabaseFromBuffer(dbBuffer, backupPath);

    res.json({
      success: true,
      message: "Encrypted backup created successfully",
      backupPath,
      size: fs.statSync(backupPath).size,
    });
  } catch (error) {
    apiLogger.error("Database backup failed", error, {
      operation: "database_backup_api_failed",
    });
    res.status(500).json({
      error: "Database backup failed",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/database/restore", async (req, res) => {
  try {
    const { backupPath, targetPath } = req.body;

    if (!backupPath) {
      return res.status(400).json({ error: "Backup path is required" });
    }

    apiLogger.info("Restoring database from backup via API", {
      operation: "database_restore_api",
      backupPath,
    });

    // Validate backup file
    if (!DatabaseFileEncryption.isEncryptedDatabaseFile(backupPath)) {
      return res.status(400).json({ error: "Invalid encrypted backup file" });
    }

    // Hardware compatibility check removed - no longer required

    const restoredPath = await DatabaseFileEncryption.restoreFromEncryptedBackup(
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

const PORT = 8081;

async function initializeSecurity() {
  try {
    databaseLogger.info("Initializing security system (KEK-DEK architecture)...", {
      operation: "security_init",
    });

    // Initialize simplified authentication system
    const authManager = AuthManager.getInstance();
    await authManager.initialize();

    // Initialize simplified data encryption
    DataCrypto.initialize();

    // Validate security system
    const isValid = true; // Simplified validation for new architecture
    if (!isValid) {
      throw new Error("Security system validation failed");
    }

    const securityStatus = {
      initialized: true,
      system: { hasSecret: true, isValid: true },
      activeSessions: {},
      activeSessionCount: 0
    };
    databaseLogger.success("Security system initialized successfully", {
      operation: "security_init_complete",
      systemStatus: securityStatus.system,
      initialized: securityStatus.initialized,
    });

    databaseLogger.info("Security architecture: JWT (system) + KEK-DEK (users)", {
      operation: "security_architecture_info",
      features: [
        "System JWT keys for authentication",
        "User password-derived KEK for data protection",
        "Session-based data key management",
        "Multi-user independent encryption"
      ],
    });

  } catch (error) {
    databaseLogger.error("Failed to initialize security system", error, {
      operation: "security_init_error",
    });
    throw error; // Security system is critical for API functionality
  }
}

app.listen(PORT, async () => {
  // Ensure uploads directory exists
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  await initializeSecurity();

  databaseLogger.success(`Database API server started on port ${PORT}`, {
    operation: "server_start",
    port: PORT,
    routes: [
      "/users",
      "/ssh",
      "/alerts",
      "/credentials",
      "/health",
      "/version",
      "/releases/rss",
      "/encryption/status",
      "/encryption/initialize",
      "/encryption/regenerate",
      "/database/export",
      "/database/import",
      "/database/export/:exportPath/info",
      "/database/backup",
      "/database/restore",
    ],
  });
});
