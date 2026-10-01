import type { Request, Response, Router } from "express";
import type { PluginContext, PluginSshHost } from "@termix/plugin-sdk/backend";
import { answerConnect, startConnect } from "./connect.js";
import { containerCommand, getRuntimeLabel } from "./container-runtime.js";
import { readDockerHostSettings } from "./host-settings.js";
import type { DockerSession, DockerSessions } from "./sessions.js";
import {
  CONTAINER_ID_RE,
  DOCKER_TIMESTAMP_RE,
  connectionLog,
  getErrorMessage,
  type ConnectionLogLine,
  type DockerLogger,
} from "./helpers.js";

const CONTAINER_ACTIONS = [
  "start",
  "stop",
  "restart",
  "pause",
  "unpause",
] as const;
type ContainerAction = (typeof CONTAINER_ACTIONS)[number];

const LIST_FORMAT_UNIX = `'{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","state":"{{.State}}","ports":"{{.Ports}}","created":"{{.CreatedAt}}"}' `;
const LIST_FORMAT_WINDOWS = `"{\\"id\\":\\"{{.ID}}\\",\\"name\\":\\"{{.Names}}\\",\\"image\\":\\"{{.Image}}\\",\\"status\\":\\"{{.Status}}\\",\\"state\\":\\"{{.State}}\\",\\"ports\\":\\"{{.Ports}}\\",\\"created\\":\\"{{.CreatedAt}}\\"}"`;
const STATS_FORMAT_UNIX = `'{"cpu":"{{.CPUPerc}}","memory":"{{.MemUsage}}","memoryPercent":"{{.MemPerc}}","netIO":"{{.NetIO}}","blockIO":"{{.BlockIO}}","pids":"{{.PIDs}}"}' `;
const STATS_FORMAT_WINDOWS = `"{\\"cpu\\":\\"{{.CPUPerc}}\\",\\"memory\\":\\"{{.MemUsage}}\\",\\"memoryPercent\\":\\"{{.MemPerc}}\\",\\"netIO\\":\\"{{.NetIO}}\\",\\"blockIO\\":\\"{{.BlockIO}}\\",\\"pids\\":\\"{{.PIDs}}\\"}"`;

export function listFormat(isWindows: boolean): string {
  return isWindows ? LIST_FORMAT_WINDOWS : LIST_FORMAT_UNIX;
}

/** Parses `ps --format listFormat()` output, skipping lines that are not JSON. */
export function parseContainerList(output: string): Record<string, unknown>[] {
  return output
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

function notFound(error: unknown): boolean {
  return getErrorMessage(error, "").includes("No such container");
}

interface Deps {
  ctx: PluginContext;
  sessions: DockerSessions;
  log: DockerLogger;
}

export function registerRoutes(router: Router, { ctx, sessions, log }: Deps) {
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.use(ctx.rbac.require("use") as never);

  router.param("containerId", (_req, res, next, value) => {
    if (!CONTAINER_ID_RE.test(value)) {
      res.status(400).json({ error: "Invalid container ID" });
      return;
    }
    next();
  });

  const userOf = (res: Response): string | null => {
    const userId = ctx.currentActor();
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return null;
    }
    return userId;
  };

  /** The caller's live session for the path's sessionId, or an error reply. */
  const sessionOf = (req: Request, res: Response): DockerSession | null => {
    const userId = userOf(res);
    if (!userId) return null;
    const sessionId = String(req.params.sessionId ?? "");
    if (sessions.getPending(sessionId)) {
      res.status(400).json({
        error: "Connection pending authentication",
        code: "AUTH_PENDING",
      });
      return null;
    }
    const session = sessions.get(sessionId, userId);
    if (!session) {
      res.status(400).json({ error: "SSH session not found or not connected" });
      return null;
    }
    return session;
  };

  /**
   * @openapi
   * /plugin-api/docker/ssh/connect:
   *   post:
   *     summary: Establish SSH session for Docker
   *     description: Opens an SSH session to a host for Docker operations. When the host asks for a code, a browser sign-in or a password, the reply says so and the session waits for connect-totp or connect-browser-sign-in.
   *     tags:
   *       - Docker
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - sessionId
   *               - hostId
   *             properties:
   *               sessionId:
   *                 type: string
   *               hostId:
   *                 type: integer
   *               userProvidedPassword:
   *                 type: string
   *               userProvidedSshKey:
   *                 type: string
   *               userProvidedKeyPassword:
   *                 type: string
   *     responses:
   *       200:
   *         description: Connected, or a prompt the user has to answer.
   *       400:
   *         description: Missing sessionId or hostId.
   *       403:
   *         description: Docker is not enabled for this host, or the user lacks docker.use.
   *       404:
   *         description: Host not found.
   *       500:
   *         description: SSH connection failed.
   */
  router.post("/ssh/connect", async (req, res) => {
    const userId = userOf(res);
    if (!userId) return;
    const {
      sessionId,
      hostId,
      userProvidedPassword,
      userProvidedSshKey,
      userProvidedKeyPassword,
    } = (req.body ?? {}) as Record<string, unknown>;
    const logs: ConnectionLogLine[] = [];

    if (typeof sessionId !== "string" || !sessionId || !hostId) {
      logs.push(
        connectionLog(
          "error",
          "docker_connecting",
          "Missing connection parameters",
        ),
      );
      return res
        .status(400)
        .json({ error: "Missing sessionId or hostId", connectionLogs: logs });
    }
    const numericHostId = Number(hostId);

    logs.push(
      connectionLog(
        "info",
        "docker_connecting",
        "Initiating Docker SSH connection",
      ),
    );

    try {
      const host = await ctx.ssh.resolveHost(numericHostId);
      if (!host) {
        logs.push(
          connectionLog("error", "docker_connecting", "Host not found"),
        );
        return res
          .status(404)
          .json({ error: "Host not found", connectionLogs: logs });
      }

      const settings = await readDockerHostSettings(ctx, numericHostId);
      if (!settings.enabled) {
        logs.push(
          connectionLog(
            "error",
            "docker_connecting",
            "Docker is not enabled for this host",
          ),
        );
        return res.status(403).json({
          error:
            "Docker is not enabled for this host. Enable it in Host Settings.",
          code: "DOCKER_DISABLED",
          connectionLogs: logs,
        });
      }

      sessions.close(sessionId);
      logs.push(
        connectionLog(
          "info",
          "docker_auth",
          "Resolving authentication credentials",
        ),
      );

      const target: PluginSshHost = {
        ...host,
        id: numericHostId,
        port: host.port || 22,
      };
      if (typeof userProvidedPassword === "string" && userProvidedPassword) {
        target.password = userProvidedPassword;
        target.authType = "password";
      }
      if (typeof userProvidedSshKey === "string" && userProvidedSshKey) {
        target.key = userProvidedSshKey;
        target.authType = "key";
      }
      if (
        typeof userProvidedKeyPassword === "string" &&
        userProvidedKeyPassword
      ) {
        target.keyPassword = userProvidedKeyPassword;
      }

      const step = await startConnect(ctx, sessions, log, {
        sessionId,
        userId,
        host: target,
        runtime: settings.runtime,
        logs,
      });
      return res.status(step.status).json(step.body);
    } catch (error) {
      log.error("Docker SSH connection error", error, {
        hostId: numericHostId,
        userId,
      });
      logs.push(
        connectionLog(
          "error",
          "docker_connecting",
          `Connection error: ${getErrorMessage(error)}`,
        ),
      );
      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
        connectionLogs: logs,
      });
    }
  });

  /**
   * @openapi
   * /plugin-api/docker/ssh/connect-totp:
   *   post:
   *     summary: Answer a verification prompt
   *     description: Sends the code (or password) the host asked for and waits for the next step of the connect.
   *     tags:
   *       - Docker
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - sessionId
   *               - totpCode
   *             properties:
   *               sessionId:
   *                 type: string
   *               totpCode:
   *                 type: string
   *     responses:
   *       200:
   *         description: Connected, or another prompt.
   *       400:
   *         description: Session ID and code required, or the session is not waiting for a code.
   *       404:
   *         description: The connect expired.
   *       408:
   *         description: The host did not answer in time.
   */
  router.post("/ssh/connect-totp", async (req, res) => {
    const userId = userOf(res);
    if (!userId) return;
    const { sessionId, totpCode } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof sessionId !== "string" || typeof totpCode !== "string") {
      return res
        .status(400)
        .json({ error: "Session ID and TOTP code required" });
    }
    const step = await answerConnect(
      sessions,
      sessionId,
      userId,
      "totp",
      totpCode.trim(),
    );
    return res.status(step.status).json(step.body);
  });

  /**
   * @openapi
   * /plugin-api/docker/ssh/connect-browser-sign-in:
   *   post:
   *     summary: Continue after a browser sign-in
   *     description: Continues a connect after the user finished signing in in the browser (an SSH gateway's approval, for example).
   *     tags:
   *       - Docker
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - sessionId
   *             properties:
   *               sessionId:
   *                 type: string
   *     responses:
   *       200:
   *         description: Connected, or another prompt.
   *       400:
   *         description: Session ID required, or the session is not waiting for a browser sign-in.
   *       404:
   *         description: The connect expired.
   *       408:
   *         description: The host did not answer in time.
   */
  router.post("/ssh/connect-browser-sign-in", async (req, res) => {
    const userId = userOf(res);
    if (!userId) return;
    const { sessionId } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof sessionId !== "string" || !sessionId) {
      return res.status(400).json({ error: "Session ID required" });
    }
    const step = await answerConnect(
      sessions,
      sessionId,
      userId,
      "browser",
      "",
    );
    return res.status(step.status).json(step.body);
  });

  /**
   * @openapi
   * /plugin-api/docker/ssh/disconnect:
   *   post:
   *     summary: Disconnect SSH session
   *     description: Closes the caller's Docker SSH session.
   *     tags:
   *       - Docker
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               sessionId:
   *                 type: string
   *     responses:
   *       200:
   *         description: SSH session disconnected.
   *       400:
   *         description: Session ID is required.
   */
  router.post("/ssh/disconnect", (req, res) => {
    const userId = userOf(res);
    if (!userId) return;
    const { sessionId } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof sessionId !== "string" || !sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }
    const pending = sessions.getPending(sessionId);
    if (sessions.get(sessionId, userId) || pending?.userId === userId) {
      sessions.close(sessionId);
    }
    return res.json({ success: true, message: "SSH session disconnected" });
  });

  /**
   * @openapi
   * /plugin-api/docker/ssh/keepalive:
   *   post:
   *     summary: Keep SSH session alive
   *     description: Resets the idle timeout of the caller's Docker SSH session.
   *     tags:
   *       - Docker
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               sessionId:
   *                 type: string
   *     responses:
   *       200:
   *         description: Session keepalive successful.
   *       400:
   *         description: Session ID is required or session not found.
   */
  router.post("/ssh/keepalive", (req, res) => {
    const userId = userOf(res);
    if (!userId) return;
    const { sessionId } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof sessionId !== "string" || !sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }
    const session = sessions.get(sessionId, userId);
    if (!session) {
      return res.status(400).json({
        error: "SSH session not found or not connected",
        connected: false,
      });
    }
    sessions.touch(session);
    return res.json({
      success: true,
      connected: true,
      lastActive: session.lastActive,
    });
  });

  /**
   * @openapi
   * /plugin-api/docker/ssh/status:
   *   get:
   *     summary: Check SSH session status
   *     description: Whether the caller's Docker SSH session is connected.
   *     tags:
   *       - Docker
   *     parameters:
   *       - in: query
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Session status.
   *       400:
   *         description: Session ID is required.
   */
  router.get("/ssh/status", (req, res) => {
    const userId = userOf(res);
    if (!userId) return;
    const sessionId = req.query.sessionId;
    if (typeof sessionId !== "string" || !sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }
    return res.json({
      success: true,
      connected: !!sessions.get(sessionId, userId),
    });
  });

  /**
   * @openapi
   * /plugin-api/docker/validate/{sessionId}:
   *   get:
   *     summary: Validate Docker availability
   *     description: Checks that the container runtime is installed and its daemon answers.
   *     tags:
   *       - Docker
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Docker availability status.
   *       400:
   *         description: SSH session not found or not connected.
   */
  router.get("/validate/:sessionId", async (req, res) => {
    const session = sessionOf(req, res);
    if (!session) return;
    const runtime = session.runtime;
    const label = getRuntimeLabel(runtime);

    await sessions.run(session, async () => {
      let version = "unknown";
      try {
        const output = await sessions.exec(
          session,
          containerCommand(runtime, "--version"),
        );
        version =
          output.match(/(?:Docker|podman) version ([^\s,]+)/i)?.[1] ??
          "unknown";
      } catch {
        res.json({
          available: false,
          error: `${label} is not installed on this host.`,
          code: "NOT_INSTALLED",
          runtime,
        });
        return;
      }

      try {
        await sessions.exec(session, containerCommand(runtime, "ps"));
        res.json({ available: true, version, runtime });
      } catch (error) {
        const message = getErrorMessage(error, "");
        if (message.includes("Cannot connect to the Docker daemon")) {
          res.json({
            available: false,
            error: `${label} daemon is not running or accessible`,
            code: "DAEMON_NOT_RUNNING",
            runtime,
          });
        } else if (message.includes("permission denied")) {
          res.json({
            available: false,
            error: `Permission denied accessing ${label}`,
            code: "PERMISSION_DENIED",
            runtime,
          });
        } else {
          res.json({
            available: false,
            error: message,
            code: "DOCKER_ERROR",
            runtime,
          });
        }
      }
    });
  });

  /**
   * @openapi
   * /plugin-api/docker/containers/{sessionId}:
   *   get:
   *     summary: List all containers
   *     description: Lists the containers on the session's host.
   *     tags:
   *       - Docker
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: all
   *         schema:
   *           type: boolean
   *     responses:
   *       200:
   *         description: A list of containers.
   *       400:
   *         description: SSH session not found or not connected.
   *       500:
   *         description: Failed to list containers.
   */
  router.get("/containers/:sessionId", async (req, res) => {
    const session = sessionOf(req, res);
    if (!session) return;
    const all = req.query.all !== "false";
    try {
      const output = await sessions.run(session, () =>
        sessions.exec(
          session,
          containerCommand(
            session.runtime,
            `ps ${all ? "-a " : ""}--format ${listFormat(session.isWindows)}`,
          ),
        ),
      );
      res.json(parseContainerList(output));
    } catch (error) {
      log.error("Failed to list Docker containers", error, {
        hostId: session.hostId,
      });
      res.status(500).json({
        error: getErrorMessage(error, "Failed to list containers"),
      });
    }
  });

  /**
   * @openapi
   * /plugin-api/docker/containers/{sessionId}/{containerId}:
   *   get:
   *     summary: Get container details
   *     description: The container's inspect output.
   *     tags:
   *       - Docker
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: containerId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Container details.
   *       400:
   *         description: SSH session not found or not connected.
   *       404:
   *         description: Container not found.
   *       500:
   *         description: Failed to get container details.
   */
  router.get("/containers/:sessionId/:containerId", async (req, res) => {
    const session = sessionOf(req, res);
    if (!session) return;
    const { containerId } = req.params;
    try {
      const output = await sessions.run(session, () =>
        sessions.exec(
          session,
          containerCommand(session.runtime, `inspect ${containerId}`),
        ),
      );
      const details = JSON.parse(output) as unknown[];
      if (details?.length > 0) {
        res.json(details[0]);
      } else {
        res
          .status(404)
          .json({ error: "Container not found", code: "CONTAINER_NOT_FOUND" });
      }
    } catch (error) {
      if (notFound(error)) {
        return res
          .status(404)
          .json({ error: "Container not found", code: "CONTAINER_NOT_FOUND" });
      }
      log.error("Failed to get container details", error, {
        hostId: session.hostId,
        containerId,
      });
      res.status(500).json({
        error: getErrorMessage(error, "Failed to get container details"),
      });
    }
  });

  /**
   * @openapi
   * /plugin-api/docker/containers/{sessionId}/{containerId}/{action}:
   *   post:
   *     summary: Start, stop, restart, pause or unpause a container
   *     description: Runs the container action on the session's host.
   *     tags:
   *       - Docker
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: containerId
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: action
   *         required: true
   *         schema:
   *           type: string
   *           enum: [start, stop, restart, pause, unpause]
   *     responses:
   *       200:
   *         description: The action ran.
   *       400:
   *         description: SSH session not found or not connected.
   *       404:
   *         description: Container not found, or an unknown action.
   *       500:
   *         description: The action failed.
   */
  router.post(
    "/containers/:sessionId/:containerId/:action",
    async (req, res) => {
      const action = req.params.action as ContainerAction;
      if (!CONTAINER_ACTIONS.includes(action)) {
        return res.status(404).json({ error: "Unknown container action" });
      }
      const session = sessionOf(req, res);
      if (!session) return;
      const { containerId } = req.params;
      try {
        log.info("Docker container operation", {
          hostId: session.hostId,
          containerId,
          action,
        });
        await sessions.run(session, () =>
          sessions.exec(
            session,
            containerCommand(session.runtime, `${action} ${containerId}`),
          ),
        );
        res.json({ success: true, message: `Container ${action} succeeded` });
      } catch (error) {
        if (notFound(error)) {
          return res.status(404).json({
            success: false,
            error: "Container not found",
            code: "CONTAINER_NOT_FOUND",
          });
        }
        log.error(`Failed to ${action} container`, error, {
          hostId: session.hostId,
          containerId,
        });
        res.status(500).json({
          success: false,
          error: getErrorMessage(error, `Failed to ${action} container`),
        });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/docker/containers/{sessionId}/{containerId}/remove:
   *   delete:
   *     summary: Remove container
   *     description: Removes a container, optionally by force.
   *     tags:
   *       - Docker
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: containerId
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: force
   *         schema:
   *           type: boolean
   *     responses:
   *       200:
   *         description: Container removed.
   *       400:
   *         description: Session not found, or the container is running and force was not set.
   *       404:
   *         description: Container not found.
   *       500:
   *         description: Failed to remove container.
   */
  router.delete(
    "/containers/:sessionId/:containerId/remove",
    async (req, res) => {
      const session = sessionOf(req, res);
      if (!session) return;
      const { containerId } = req.params;
      const force = req.query.force === "true";
      try {
        log.info("Docker container operation", {
          hostId: session.hostId,
          containerId,
          action: "remove",
        });
        await sessions.run(session, () =>
          sessions.exec(
            session,
            containerCommand(
              session.runtime,
              `rm ${force ? "-f " : ""}${containerId}`,
            ),
          ),
        );
        res.json({ success: true, message: "Container removed successfully" });
      } catch (error) {
        if (notFound(error)) {
          return res.status(404).json({
            success: false,
            error: "Container not found",
            code: "CONTAINER_NOT_FOUND",
          });
        }
        if (
          getErrorMessage(error, "").includes(
            "cannot remove a running container",
          )
        ) {
          return res.status(400).json({
            success: false,
            error:
              "Cannot remove a running container. Stop it first or use force.",
            code: "CONTAINER_RUNNING",
          });
        }
        log.error("Failed to remove container", error, {
          hostId: session.hostId,
          containerId,
        });
        res.status(500).json({
          success: false,
          error: getErrorMessage(error, "Failed to remove container"),
        });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/docker/containers/{sessionId}/{containerId}/logs:
   *   get:
   *     summary: Get container logs
   *     description: The container's log output.
   *     tags:
   *       - Docker
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: containerId
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: tail
   *         schema:
   *           type: integer
   *       - in: query
   *         name: timestamps
   *         schema:
   *           type: boolean
   *       - in: query
   *         name: since
   *         schema:
   *           type: string
   *       - in: query
   *         name: until
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Container logs.
   *       400:
   *         description: SSH session not found or not connected.
   *       404:
   *         description: Container not found.
   *       500:
   *         description: Failed to get container logs.
   */
  router.get("/containers/:sessionId/:containerId/logs", async (req, res) => {
    const session = sessionOf(req, res);
    if (!session) return;
    const { containerId } = req.params;
    const tail = req.query.tail ? parseInt(String(req.query.tail), 10) : 100;
    const since = typeof req.query.since === "string" ? req.query.since : "";
    const until = typeof req.query.until === "string" ? req.query.until : "";

    let command = containerCommand(session.runtime, `logs ${containerId}`);
    if (tail && tail > 0) command += ` --tail ${Math.floor(tail)}`;
    if (req.query.timestamps === "true") command += " --timestamps";
    if (since && DOCKER_TIMESTAMP_RE.test(since))
      command += ` --since ${since}`;
    if (until && DOCKER_TIMESTAMP_RE.test(until))
      command += ` --until ${until}`;
    command += " 2>&1";

    try {
      const logs = await sessions.run(session, () =>
        sessions.exec(session, command),
      );
      res.json({ success: true, logs });
    } catch (error) {
      if (notFound(error)) {
        return res.status(404).json({
          success: false,
          error: "Container not found",
          code: "CONTAINER_NOT_FOUND",
        });
      }
      log.error("Failed to get container logs", error, {
        hostId: session.hostId,
        containerId,
      });
      res.status(500).json({
        success: false,
        error: getErrorMessage(error, "Failed to get container logs"),
      });
    }
  });

  /**
   * @openapi
   * /plugin-api/docker/containers/{sessionId}/{containerId}/stats:
   *   get:
   *     summary: Get container stats
   *     description: One sample of the container's CPU, memory, network and block IO.
   *     tags:
   *       - Docker
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: containerId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Container stats.
   *       400:
   *         description: SSH session not found or not connected.
   *       404:
   *         description: Container not found.
   *       500:
   *         description: Failed to get container stats.
   */
  router.get("/containers/:sessionId/:containerId/stats", async (req, res) => {
    const session = sessionOf(req, res);
    if (!session) return;
    const { containerId } = req.params;
    const format = session.isWindows ? STATS_FORMAT_WINDOWS : STATS_FORMAT_UNIX;
    try {
      const output = await sessions.run(session, () =>
        sessions.exec(
          session,
          containerCommand(
            session.runtime,
            `stats ${containerId} --no-stream --format ${format}`,
          ),
        ),
      );
      const raw = JSON.parse(output.trim()) as Record<string, string>;
      const split = (value: string | undefined) => {
        const [first, second] = (value ?? "").split(" / ");
        return [first?.trim() || "0B", second?.trim() || "0B"];
      };
      const [memoryUsed, memoryLimit] = split(raw.memory);
      const [netInput, netOutput] = split(raw.netIO);
      const [blockRead, blockWrite] = split(raw.blockIO);
      res.json({
        cpu: raw.cpu,
        memoryUsed,
        memoryLimit,
        memoryPercent: raw.memoryPercent,
        netInput,
        netOutput,
        blockRead,
        blockWrite,
        pids: raw.pids,
      });
    } catch (error) {
      if (notFound(error)) {
        return res.status(404).json({
          success: false,
          error: "Container not found",
          code: "CONTAINER_NOT_FOUND",
        });
      }
      log.error("Failed to get container stats", error, {
        hostId: session.hostId,
        containerId,
      });
      res.status(500).json({
        success: false,
        error: getErrorMessage(error, "Failed to get container stats"),
      });
    }
  });
}
