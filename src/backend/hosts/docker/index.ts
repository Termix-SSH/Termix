import express from "express";
import cookieParser from "cookie-parser";
import { createCorsMiddleware } from "../../utils/cors-config.js";
import { createCompressionMiddleware } from "../../utils/compression-config.js";
import { logger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { registerDockerContainerRoutes } from "./container-routes.js";
import {
  sshSessions,
  pendingTOTPSessions,
  cleanupSession,
  executeDockerCommand,
} from "./session-manager.js";
import {
  DOCKER_TIMESTAMP_RE,
  getRequestUserId,
  registerDockerSshRoutes,
} from "./routes.js";
import { listenOnServicePort } from "../../utils/service-listen.js";

const sshLogger = logger;

const app = express();
app.set("trust proxy", "loopback");

app.use(createCompressionMiddleware());
app.use(createCorsMiddleware(["GET", "POST", "PUT", "DELETE", "OPTIONS"]));

app.use(cookieParser());
const authManager = AuthManager.getInstance();
app.use(authManager.createAuthMiddleware());
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

const PORT = 30007;

listenOnServicePort({
  app,
  port: PORT,
  logger: sshLogger,
  serviceName: "docker",
  onListening: async () => {
    try {
      await authManager.initialize();
    } catch (err) {
      sshLogger.error("Failed to initialize Docker backend", err, {
        operation: "startup",
      });
    }
  },
});

process.on("SIGINT", () => {
  Object.keys(sshSessions).forEach((sessionId) => {
    cleanupSession(sessionId);
  });
  process.exit(0);
});

process.on("SIGTERM", () => {
  Object.keys(sshSessions).forEach((sessionId) => {
    cleanupSession(sessionId);
  });
  process.exit(0);
});
