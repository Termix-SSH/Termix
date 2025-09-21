//  npx tsc -p tsconfig.node.json
//  node ./dist/backend/starter.js

import "./database/database.js";
import { AuthManager } from "./utils/auth-manager.js";
import { DataCrypto } from "./utils/data-crypto.js";
import { systemLogger, versionLogger } from "./utils/logger.js";
import "dotenv/config";

(async () => {
  try {
    const version = process.env.VERSION || "unknown";
    versionLogger.info(`Termix Backend starting - Version: ${version}`, {
      operation: "startup",
      version: version,
    });

    // Production environment security checks
    if (process.env.NODE_ENV === 'production') {
      systemLogger.info("Running production environment security checks...", {
        operation: "security_checks",
      });

      const securityIssues: string[] = [];

      // Check system master key
      if (!process.env.SYSTEM_MASTER_KEY) {
        securityIssues.push("SYSTEM_MASTER_KEY environment variable is required in production");
      } else if (process.env.SYSTEM_MASTER_KEY.length < 64) {
        securityIssues.push("SYSTEM_MASTER_KEY should be at least 64 characters in production");
      }

      // Check database file encryption
      if (process.env.DB_FILE_ENCRYPTION === 'false') {
        securityIssues.push("Database file encryption should be enabled in production");
      }

      // Check JWT secret
      if (!process.env.JWT_SECRET) {
        systemLogger.info("JWT_SECRET not set - will use encrypted storage", {
          operation: "security_checks",
          note: "Using encrypted JWT storage"
        });
      }

      // Check CORS configuration warning
      systemLogger.warn("Production deployment detected - ensure CORS is properly configured", {
        operation: "security_checks",
        warning: "Verify frontend domain whitelist"
      });

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

      systemLogger.success("Production security checks passed", {
        operation: "security_checks_complete",
      });
    }

    systemLogger.info("Initializing backend services...", {
      operation: "startup",
      environment: process.env.NODE_ENV || "development",
    });

    // Initialize simplified authentication system
    const authManager = AuthManager.getInstance();
    await authManager.initialize();
    DataCrypto.initialize();
    systemLogger.info("Security system initialized (KEK-DEK architecture)", {
      operation: "security_init",
    });

    // Load modules that depend on encryption after initialization
    await import("./ssh/terminal.js");
    await import("./ssh/tunnel.js");
    await import("./ssh/file-manager.js");
    await import("./ssh/server-stats.js");

    systemLogger.success("All backend services initialized successfully", {
      operation: "startup_complete",
      services: [
        "database",
        "encryption",
        "terminal",
        "tunnel",
        "file_manager",
        "stats",
      ],
      version: version,
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
