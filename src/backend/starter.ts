import dotenv from "dotenv";
import { promises as fs } from "fs";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AutoSSLSetup } from "./utils/auto-ssl-setup.js";
import { AuthManager } from "./utils/auth-manager.js";
import { DataCrypto } from "./utils/data-crypto.js";
import { SystemCrypto } from "./utils/system-crypto.js";
import { systemLogger, versionLogger } from "./utils/logger.js";

(async () => {
  const initStartTime = Date.now();
  try {
    dotenv.config({ quiet: true });

    const dataDir = process.env.DATA_DIR || "./db/data";
    const envPath = path.join(dataDir, ".env");
    try {
      await fs.access(envPath);
      const persistentConfig = dotenv.config({ path: envPath, quiet: true });
      if (persistentConfig.parsed) {
        Object.assign(process.env, persistentConfig.parsed);
      }
    } catch (error) {}

    systemLogger.info("Termix backend initialization started", {
      operation: "backend_init_start",
      nodeEnv: process.env.NODE_ENV || "production",
      port: process.env.PORT || 4090,
    });

    let version = "unknown";

    const versionSources = [
      () => process.env.VERSION,
      () => {
        try {
          const packageJsonPath = path.join(process.cwd(), "package.json");
          const packageJson = JSON.parse(
            readFileSync(packageJsonPath, "utf-8"),
          );
          return packageJson.version;
        } catch {
          return null;
        }
      },
      () => {
        try {
          const __filename = fileURLToPath(import.meta.url);
          const packageJsonPath = path.join(
            path.dirname(__filename),
            "../../../package.json",
          );
          const packageJson = JSON.parse(
            readFileSync(packageJsonPath, "utf-8"),
          );
          return packageJson.version;
        } catch {
          return null;
        }
      },
      () => {
        try {
          const packageJsonPath = path.join("/app", "package.json");
          const packageJson = JSON.parse(
            readFileSync(packageJsonPath, "utf-8"),
          );
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
          version = foundVersion;
          break;
        }
      } catch {
        continue;
      }
    }
    versionLogger.info(`Termix Backend starting - Version: ${version}`, {
      operation: "startup",
      version: version,
    });

    const systemCrypto = SystemCrypto.getInstance();
    await systemCrypto.initializeJWTSecret();
    await systemCrypto.initializeDatabaseKey();
    await systemCrypto.initializeInternalAuthToken();

    await AutoSSLSetup.initialize();
    systemLogger.success("SSL setup completed", {
      operation: "backend_init_ssl",
      sslEnabled: process.env.SSL_ENABLED === "true",
    });

    const dbModule = await import("./database/db/index.js");
    await dbModule.initializeDatabase();
    systemLogger.success("Database initialized", {
      operation: "backend_init_db",
    });

    const authManager = AuthManager.getInstance();
    await authManager.initialize();
    DataCrypto.initialize();

    const { OPKSSHBinaryManager } =
      await import("./utils/opkssh-binary-manager.js");
    try {
      await OPKSSHBinaryManager.ensureBinary();
    } catch (error) {
      const dataDir =
        process.env.DATA_DIR || path.join(process.cwd(), "db", "data");
      systemLogger.warn(
        "Failed to initialize OPKSSH binary - OPKSSH authentication will not be available",
        {
          operation: "opkssh_binary_init_failed",
          error: error instanceof Error ? error.message : "Unknown error",
          stack: error instanceof Error ? error.stack : undefined,
          platform: process.platform,
          arch: process.arch,
          dataDir,
        },
      );
    }

    await import("./database/database.js");

    await import("./ssh/terminal.js");
    await import("./ssh/tunnel.js");
    await import("./ssh/file-manager.js");
    await import("./ssh/server-stats.js");
    await import("./ssh/docker.js");
    await import("./ssh/docker-console.js");
    await import("./dashboard.js");

    systemLogger.success("Termix backend started successfully", {
      operation: "backend_init_complete",
      port: process.env.PORT || 4090,
      ssl: process.env.SSL_ENABLED === "true",
      duration: Date.now() - initStartTime,
    });

    process.on("SIGINT", () => {
      systemLogger.info(
        "Received SIGINT signal, initiating graceful shutdown...",
        { operation: "shutdown" },
      );
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      systemLogger.info(
        "Received SIGTERM signal, initiating graceful shutdown...",
        { operation: "shutdown" },
      );
      process.exit(0);
    });

    // IPC shutdown for Electron embedded mode (SIGTERM doesn't work on Windows)
    process.on("message", (msg: { type?: string }) => {
      if (msg?.type === "shutdown") {
        systemLogger.info(
          "Received IPC shutdown, initiating graceful shutdown...",
          { operation: "shutdown" },
        );
        process.exit(0);
      }
    });

    process.on("uncaughtException", (error) => {
      systemLogger.error("Uncaught exception occurred", error, {
        operation: "error_handling",
      });
      process.exit(1);
    });

    process.on("unhandledRejection", (reason) => {
      systemLogger.error("Unhandled promise rejection", reason, {
        operation: "error_handling",
      });
      process.exit(1);
    });
  } catch (error) {
    systemLogger.error("Failed to initialize backend services", error, {
      operation: "startup_failed",
    });
    process.exit(1);
  }
})();
