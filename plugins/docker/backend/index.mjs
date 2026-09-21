/**
 * Docker - first-party, in-process plugin.
 *
 * This plugin runs on the main thread rather than in a worker for the same
 * reason ssh-terminal does (see src/backend/plugins/first-party.ts): its
 * container-console WebSocket server holds long-lived ssh2.Client + PTY
 * streams, its session-manager reuses a live ssh2.Client across many REST
 * calls, and its SSH connect flow implements TOTP/Warpgate as a genuinely
 * stateful multi-request handshake. None of that can cross the
 * structured-clone postMessage boundary a worker plugin talks over.
 *
 * Unlike ssh-terminal, Docker's backend has no consumers outside itself, so
 * the whole implementation moved here rather than staying in core with only
 * a lifecycle wrapper. This file is what used to be
 * src/backend/hosts/docker/index.ts, rewritten from a module-scope
 * SIGINT/SIGTERM + listenOnServicePort() call into activate()/deactivate().
 *
 * The moved files (routes.ts, container-routes.ts, container-runtime.ts,
 * session-manager.ts, console.ts) are real TypeScript, compiled by
 * scripts/copy-bundled-plugins.cjs (see that script for why plugins/ needs
 * its own compile step) rather than hand-written like ssh-terminal's .mjs
 * wrapper. This file itself stays plain JS since it is a thin entry point
 * with no types worth checking.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

/**
 * Loads a module by its path relative to this file's own directory.
 *
 * The plugin ships beside dist/backend, so in a built server the compiled
 * .js for the moved docker files (routes.js, session-manager.js, ...) sits
 * right next to this .mjs, and core modules resolve via
 * ../../../backend/backend/... from there (dist/plugins/docker/backend ->
 * dist/backend/backend). Under vitest/dev nothing imports this plugin
 * directly (src/backend/plugins/loader.ts loads in-process plugins with a
 * plain dynamic import, no tsx loader involved), so the only layout that
 * needs to resolve here is the built one.
 */
async function loadRelative(relativePath) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const target = path.join(here, `${relativePath}.js`);
  return import(new URL(`file://${target.replace(/\\/g, "/")}`).href);
}

let httpServer = null;
let consoleModule = null;
let authManagerInstance = null;

export async function activate(ctx) {
  const [
    express,
    cookieParser,
    { createCorsMiddleware },
    { createCompressionMiddleware },
    { logger },
    { AuthManager },
    { registerDockerContainerRoutes },
    sessionManager,
    { DOCKER_TIMESTAMP_RE, getRequestUserId, registerDockerSshRoutes },
  ] = await Promise.all([
    import("express").then((m) => m.default),
    import("cookie-parser").then((m) => m.default),
    loadRelative("../../../backend/backend/utils/cors-config"),
    loadRelative("../../../backend/backend/utils/compression-config"),
    loadRelative("../../../backend/backend/utils/logger"),
    loadRelative("../../../backend/backend/utils/auth-manager"),
    loadRelative("container-routes"),
    loadRelative("session-manager"),
    loadRelative("routes"),
  ]);

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
    sshSessions: sessionManager.sshSessions,
    pendingTOTPSessions: sessionManager.pendingTOTPSessions,
    getRequestUserId,
    executeDockerCommand: sessionManager.executeDockerCommand,
    dockerTimestampPattern: DOCKER_TIMESTAMP_RE,
  });

  const port = 30007;
  const server = createServer(app);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
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

  // Importing console.js binds its WebSocket server on port 30009 as a
  // module-scope side effect -- unchanged from before the move, see that
  // file's own header.
  consoleModule = await loadRelative("console");

  ctx.log.info(`Docker plugin listening on ${port} (console on 30009)`);
}

export async function deactivate() {
  if (consoleModule?.closeConsoleServer) {
    await consoleModule.closeConsoleServer();
  }
  consoleModule = null;

  if (httpServer) {
    const server = httpServer;
    httpServer = null;
    await new Promise((resolve) => server.close(() => resolve()));
  }

  authManagerInstance = null;
}
