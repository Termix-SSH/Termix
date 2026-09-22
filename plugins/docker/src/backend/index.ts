import { createServer, type Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { createCorsMiddleware } from "../../../../src/backend/utils/cors-config.js";
import { createCompressionMiddleware } from "../../../../src/backend/utils/compression-config.js";
import { logger } from "../../../../src/backend/utils/logger.js";
import { AuthManager } from "../../../../src/backend/utils/auth-manager.js";
import { registerDockerContainerRoutes } from "./container-routes.js";
import {
  sshSessions,
  pendingTOTPSessions,
  executeDockerCommand,
} from "./session-manager.js";
import {
  DOCKER_TIMESTAMP_RE,
  getRequestUserId,
  registerDockerSshRoutes,
} from "./routes.js";
import { startConsoleServer, closeConsoleServer } from "./console.js";

const PORT = 30007;

let httpServer: Server | null = null;
let authManagerInstance: ReturnType<typeof AuthManager.getInstance> | null =
  null;

export async function activate(ctx: PluginContext) {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(createCompressionMiddleware());
  app.use(createCorsMiddleware(["GET", "POST", "PUT", "DELETE", "OPTIONS"]));
  app.use(cookieParser());

  authManagerInstance = AuthManager.getInstance();
  app.use(authManagerInstance.createAuthMiddleware());
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ limit: "100mb", extended: true }));
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  registerDockerSshRoutes(app);
  registerDockerContainerRoutes(app, {
    sshSessions,
    pendingTOTPSessions,
    getRequestUserId,
    executeDockerCommand,
    dockerTimestampPattern: DOCKER_TIMESTAMP_RE,
  });

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  httpServer = server;

  try {
    await authManagerInstance.initialize();
  } catch (err) {
    logger.error("Failed to initialize Docker backend", err, {
      operation: "startup",
    });
  }

  // The console server is started here rather than on import so disabling the
  // plugin frees port 30009 and re-enabling can take it again.
  await startConsoleServer();

  ctx.log.info(`Docker plugin listening on ${PORT} (console on 30009)`);
}

export async function deactivate() {
  await closeConsoleServer();

  if (httpServer) {
    const server = httpServer;
    httpServer = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  authManagerInstance = null;
}
