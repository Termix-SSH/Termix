//  npx tsc -p tsconfig.node.json
//  node ./dist/backend/starter.js

import "dotenv/config";
import dotenv from "dotenv";
import { promises as fs } from "fs";
import path from "path";
import { AutoSSLSetup } from "./utils/auto-ssl-setup.js";
import { AuthManager } from "./utils/auth-manager.js";
import { DataCrypto } from "./utils/data-crypto.js";
import { SystemCrypto } from "./utils/system-crypto.js";
import { systemLogger, versionLogger } from "./utils/logger.js";

(async () => {
  try {
    // Load persistent .env file from config directory if available (Docker)
    if (process.env.NODE_ENV === 'production') {
      try {
        await fs.access('/app/config/.env');
        dotenv.config({ path: '/app/config/.env' });
        systemLogger.info("Loaded persistent configuration from /app/config/.env", {
          operation: "config_load"
        });
      } catch {
        // Config file doesn't exist yet, will be created on first run
        systemLogger.info("No persistent config found, will create on first run", {
          operation: "config_init"
        });
      }
    }

    const version = process.env.VERSION || "unknown";
    versionLogger.info(`Termix Backend starting - Version: ${version}`, {
      operation: "startup",
      version: version,
    });

    // Auto-initialize SSL/TLS configuration
    await AutoSSLSetup.initialize();

    // Initialize database first - required before other services
    systemLogger.info("Initializing database...", {
      operation: "database_init"
    });
    const dbModule = await import("./database/db/index.js");
    await dbModule.databaseReady;
    systemLogger.success("Database initialized successfully", {
      operation: "database_init_complete"
    });

    // Production environment security checks
    if (process.env.NODE_ENV === 'production') {
      systemLogger.info("Running production environment security checks...", {
        operation: "security_checks",
      });

      const securityIssues: string[] = [];

      // Check JWT and database keys (auto-generated if missing - warnings only)
      if (!process.env.JWT_SECRET) {
        systemLogger.warn("JWT_SECRET not set - using auto-generated keys (consider setting for production)", {
          operation: "security_warning",
          note: "Auto-generated keys are secure but not persistent across deployments"
        });
      } else if (process.env.JWT_SECRET.length < 64) {
        securityIssues.push("JWT_SECRET should be at least 64 characters in production");
      }

      if (!process.env.DATABASE_KEY) {
        systemLogger.warn("DATABASE_KEY not set - using auto-generated keys (consider setting for production)", {
          operation: "security_warning",
          note: "Auto-generated keys are secure but not persistent across deployments"
        });
      } else if (process.env.DATABASE_KEY.length < 64) {
        securityIssues.push("DATABASE_KEY should be at least 64 characters in production");
      }

      if (!process.env.INTERNAL_AUTH_TOKEN) {
        systemLogger.warn("INTERNAL_AUTH_TOKEN not set - using auto-generated token (consider setting for production)", {
          operation: "security_warning",
          note: "Auto-generated tokens are secure but not persistent across deployments"
        });
      } else if (process.env.INTERNAL_AUTH_TOKEN.length < 32) {
        securityIssues.push("INTERNAL_AUTH_TOKEN should be at least 32 characters in production");
      }

      // Check database file encryption
      if (process.env.DB_FILE_ENCRYPTION === 'false') {
        securityIssues.push("Database file encryption should be enabled in production");
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

    // Initialize system crypto keys (JWT, Database, Internal Auth)
    const systemCrypto = SystemCrypto.getInstance();
    await systemCrypto.initializeJWTSecret();
    await systemCrypto.initializeDatabaseKey();
    await systemCrypto.initializeInternalAuthToken();

    systemLogger.info("Security system initialized (KEK-DEK architecture + SystemCrypto)", {
      operation: "security_init",
    });

    // Load database-dependent modules after database initialization
    systemLogger.info("Starting database API server...", {
      operation: "api_server_init"
    });
    await import("./database/database.js");

    // Load modules that depend on database and encryption
    systemLogger.info("Starting SSH services...", {
      operation: "ssh_services_init"
    });
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

    // Display SSL configuration info
    AutoSSLSetup.logSSLInfo();

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
