//  npx tsc -p tsconfig.node.json
//  node ./dist/backend/starter.js

import "./database/database.js";
import { DatabaseEncryption } from "./utils/database-encryption.js";
import { systemLogger, versionLogger } from "./utils/logger.js";
import "dotenv/config";

(async () => {
  try {
    const version = process.env.VERSION || "unknown";
    versionLogger.info(`Termix Backend starting - Version: ${version}`, {
      operation: "startup",
      version: version,
    });

    systemLogger.info("Initializing backend services...", {
      operation: "startup",
    });

    // Initialize database encryption before other services
    await DatabaseEncryption.initialize();
    systemLogger.info("Database encryption initialized", {
      operation: "encryption_init",
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
