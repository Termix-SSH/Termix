import dotenv from "dotenv";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AutoSSLSetup } from "./utils/auto-ssl-setup.js";
import { AuthManager } from "./utils/auth-manager.js";
import { DataCrypto } from "./utils/data-crypto.js";
import { SystemCrypto } from "./utils/system-crypto.js";
import { systemLogger, versionLogger } from "./utils/logger.js";

(async () => {
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
    } catch {}
    
    let version = "unknown";
    try {
      const __filename = fileURLToPath(import.meta.url);
      const packageJsonPath = path.join(path.dirname(__filename), "../../../package.json");
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
      version = packageJson.version || "unknown";
    } catch (error) {
      version = process.env.VERSION || "unknown";
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

    const dbModule = await import("./database/db/index.js");
    await dbModule.initializeDatabase();
    if (process.env.NODE_ENV === "production") {
      const securityIssues: string[] = [];

      if (!process.env.JWT_SECRET) {
        systemLogger.warn(
          "JWT_SECRET not set - using auto-generated keys (consider setting for production)",
          {
            operation: "security_warning",
            note: "Auto-generated keys are secure but not persistent across deployments",
          },
        );
      } else if (process.env.JWT_SECRET.length < 64) {
        securityIssues.push(
          "JWT_SECRET should be at least 64 characters in production",
        );
      }

      if (!process.env.DATABASE_KEY) {
        systemLogger.warn(
          "DATABASE_KEY not set - using auto-generated keys (consider setting for production)",
          {
            operation: "security_warning",
            note: "Auto-generated keys are secure but not persistent across deployments",
          },
        );
      } else if (process.env.DATABASE_KEY.length < 64) {
        securityIssues.push(
          "DATABASE_KEY should be at least 64 characters in production",
        );
      }

      if (!process.env.INTERNAL_AUTH_TOKEN) {
        systemLogger.warn(
          "INTERNAL_AUTH_TOKEN not set - using auto-generated token (consider setting for production)",
          {
            operation: "security_warning",
            note: "Auto-generated tokens are secure but not persistent across deployments",
          },
        );
      } else if (process.env.INTERNAL_AUTH_TOKEN.length < 32) {
        securityIssues.push(
          "INTERNAL_AUTH_TOKEN should be at least 32 characters in production",
        );
      }

      if (process.env.DB_FILE_ENCRYPTION === "false") {
        securityIssues.push(
          "Database file encryption should be enabled in production",
        );
      }

      systemLogger.warn(
        "Production deployment detected - ensure CORS is properly configured",
        {
          operation: "security_checks",
          warning: "Verify frontend domain whitelist",
        },
      );

      if (securityIssues.length > 0) {
        systemLogger.error("SECURITY ISSUES DETECTED IN PRODUCTION:", {
          operation: "security_checks_failed",
          issues: securityIssues,
        });
        for (const issue of securityIssues) {
          systemLogger.error(`- ${issue}`, { operation: "security_issue" });
        }
        systemLogger.error("Fix these issues before running in production!", {
          operation: "security_checks_failed",
        });
        process.exit(1);
      }
    }

    const authManager = AuthManager.getInstance();
    await authManager.initialize();
    DataCrypto.initialize();

    await import("./database/database.js");

    await import("./ssh/terminal.js");
    await import("./ssh/tunnel.js");
    await import("./ssh/file-manager.js");
    await import("./ssh/server-stats.js");

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

    process.on("uncaughtException", (error) => {
      systemLogger.error("Uncaught exception occurred", error, {
        operation: "error_handling",
      });
      process.exit(1);
    });

    process.on("unhandledRejection", (reason, promise) => {
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
