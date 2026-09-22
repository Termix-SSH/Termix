import express, { type Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
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
import {
  closeConsoleServer,
  handleConsoleUpgrade,
  startConsoleServer,
} from "./console.js";

let authManagerInstance: ReturnType<typeof AuthManager.getInstance> | null =
  null;

export async function activate(ctx: PluginContext) {
  // An express app rather than the router directly, so the existing
  // register*Routes helpers keep the Application they expect. Core mounts it
  // at /plugin-api/docker and runs compression, CORS, cookies, auth and body
  // parsing in front of it.
  const app = express();
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

  ctx.http.router<Router>({ bodyLimit: "100mb" }).use(app);

  authManagerInstance = AuthManager.getInstance();
  try {
    await authManagerInstance.initialize();
  } catch (err) {
    logger.error("Failed to initialize Docker backend", err, {
      operation: "startup",
    });
  }

  await startConsoleServer();

  // Public because the console authenticates each session over the socket
  // itself, where the container and host checks also live.
  ctx.ws.upgrade(
    "/console",
    (request, socket, head) =>
      handleConsoleUpgrade(
        request as Parameters<typeof handleConsoleUpgrade>[0],
        socket as Parameters<typeof handleConsoleUpgrade>[1],
        head as Buffer,
      ),
    { public: true },
  );

  ctx.log.info(
    "Docker mounted at /plugin-api/docker and /plugin-ws/docker/console",
  );
}

export async function deactivate() {
  await closeConsoleServer();
  authManagerInstance = null;
}
