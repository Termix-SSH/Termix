import type express from "express";
import { logger } from "../utils/logger.js";

const sshLogger = logger;

type DockerSession = {
  isConnected: boolean;
  lastActive: number;
  activeOperations: number;
  hostId?: number;
  isWindows?: boolean;
};

type PendingDockerTotpSession = unknown;

type ExecuteDockerCommand = (
  session: DockerSession,
  command: string,
  sessionId: string,
  userId: string,
  hostId?: number,
) => Promise<string>;

type DockerContainerRoutesDeps = {
  sshSessions: Record<string, DockerSession>;
  pendingTOTPSessions: Record<string, PendingDockerTotpSession>;
  getRequestUserId: (req: express.Request) => string | undefined;
  executeDockerCommand: ExecuteDockerCommand;
  dockerTimestampPattern: RegExp;
};

export function registerDockerContainerRoutes(
  app: express.Express,
  {
    sshSessions,
    pendingTOTPSessions,
    getRequestUserId,
    executeDockerCommand,
    dockerTimestampPattern: DOCKER_TIMESTAMP_RE,
  }: DockerContainerRoutesDeps,
): void {
  /**
   * @openapi
   * /docker/containers/{sessionId}:
   *   get:
   *     summary: List all containers
   *     description: Lists all Docker containers on the host.
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
  app.get("/docker/containers/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    const all = req.query.all !== "false";
    const userId = getRequestUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (pendingTOTPSessions[sessionId]) {
      return res.status(400).json({
        error: "Connection pending authentication",
        code: "AUTH_PENDING",
      });
    }

    const session = sshSessions[sessionId];

    if (!session || !session.isConnected) {
      return res.status(400).json({
        error: "SSH session not found or not connected",
      });
    }

    session.lastActive = Date.now();
    session.activeOperations++;

    try {
      const allFlag = all ? "-a " : "";
      const formatStr = session.isWindows
        ? `"{\\"id\\":\\"{{.ID}}\\",\\"name\\":\\"{{.Names}}\\",\\"image\\":\\"{{.Image}}\\",\\"status\\":\\"{{.Status}}\\",\\"state\\":\\"{{.State}}\\",\\"ports\\":\\"{{.Ports}}\\",\\"created\\":\\"{{.CreatedAt}}\\"}"`
        : `'{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","state":"{{.State}}","ports":"{{.Ports}}","created":"{{.CreatedAt}}"}' `;
      const command = `docker ps ${allFlag}--format ${formatStr}`;

      const output = await executeDockerCommand(
        session,
        command,
        sessionId,
        userId,
        session.hostId,
      );

      const containers = output
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            sshLogger.warn("Failed to parse container line", {
              operation: "parse_container",
              line,
            });
            return null;
          }
        })
        .filter((c) => c !== null);

      session.activeOperations--;

      res.json(containers);
    } catch (error) {
      session.activeOperations--;
      sshLogger.error("Failed to list Docker containers", error, {
        operation: "list_containers",
        sessionId,
        userId,
      });

      res.status(500).json({
        error:
          error instanceof Error ? error.message : "Failed to list containers",
      });
    }
  });

  /**
   * @openapi
   * /docker/containers/{sessionId}/{containerId}:
   *   get:
   *     summary: Get container details
   *     description: Retrieves detailed information about a specific container.
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
  app.get("/docker/containers/:sessionId/:containerId", async (req, res) => {
    const { sessionId, containerId } = req.params;
    const userId = getRequestUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const session = sshSessions[sessionId];

    if (!session || !session.isConnected) {
      return res.status(400).json({
        error: "SSH session not found or not connected",
      });
    }

    session.lastActive = Date.now();
    session.activeOperations++;

    try {
      const command = `docker inspect ${containerId}`;
      const output = await executeDockerCommand(
        session,
        command,
        sessionId,
        userId,
        session.hostId,
      );
      const details = JSON.parse(output);

      session.activeOperations--;

      if (details && details.length > 0) {
        res.json(details[0]);
      } else {
        res.status(404).json({
          error: "Container not found",
          code: "CONTAINER_NOT_FOUND",
        });
      }
    } catch (error) {
      session.activeOperations--;

      const errorMsg = error instanceof Error ? error.message : "";
      if (errorMsg.includes("No such container")) {
        return res.status(404).json({
          error: "Container not found",
          code: "CONTAINER_NOT_FOUND",
        });
      }

      sshLogger.error("Failed to get container details", error, {
        operation: "get_container_details",
        sessionId,
        containerId,
        userId,
      });

      res.status(500).json({
        error: errorMsg || "Failed to get container details",
      });
    }
  });

  /**
   * @openapi
   * /docker/containers/{sessionId}/{containerId}/start:
   *   post:
   *     summary: Start container
   *     description: Starts a specific container.
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
   *         description: Container started successfully.
   *       400:
   *         description: SSH session not found or not connected.
   *       404:
   *         description: Container not found.
   *       500:
   *         description: Failed to start container.
   */
  app.post(
    "/docker/containers/:sessionId/:containerId/start",
    async (req, res) => {
      const { sessionId, containerId } = req.params;
      const userId = getRequestUserId(req);

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const session = sshSessions[sessionId];

      if (!session || !session.isConnected) {
        return res.status(400).json({
          error: "SSH session not found or not connected",
        });
      }

      session.lastActive = Date.now();
      session.activeOperations++;

      try {
        sshLogger.info("Docker container operation", {
          operation: "docker_container_op",
          sessionId,
          userId,
          hostId: session.hostId,
          containerId,
          action: "start",
        });
        await executeDockerCommand(
          session,
          `docker start ${containerId}`,
          sessionId,
          userId,
          session.hostId,
        );

        session.activeOperations--;

        res.json({
          success: true,
          message: "Container started successfully",
        });
      } catch (error) {
        session.activeOperations--;

        const errorMsg = error instanceof Error ? error.message : "";
        if (errorMsg.includes("No such container")) {
          return res.status(404).json({
            success: false,
            error: "Container not found",
            code: "CONTAINER_NOT_FOUND",
          });
        }

        sshLogger.error("Failed to start container", error, {
          operation: "start_container",
          sessionId,
          containerId,
          userId,
        });

        res.status(500).json({
          success: false,
          error: errorMsg || "Failed to start container",
        });
      }
    },
  );

  /**
   * @openapi
   * /docker/containers/{sessionId}/{containerId}/stop:
   *   post:
   *     summary: Stop container
   *     description: Stops a specific container.
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
   *         description: Container stopped successfully.
   *       400:
   *         description: SSH session not found or not connected.
   *       404:
   *         description: Container not found.
   *       500:
   *         description: Failed to stop container.
   */
  app.post(
    "/docker/containers/:sessionId/:containerId/stop",
    async (req, res) => {
      const { sessionId, containerId } = req.params;
      const userId = getRequestUserId(req);

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const session = sshSessions[sessionId];

      if (!session || !session.isConnected) {
        return res.status(400).json({
          error: "SSH session not found or not connected",
        });
      }

      session.lastActive = Date.now();
      session.activeOperations++;

      try {
        sshLogger.info("Docker container operation", {
          operation: "docker_container_op",
          sessionId,
          userId,
          hostId: session.hostId,
          containerId,
          action: "stop",
        });
        await executeDockerCommand(
          session,
          `docker stop ${containerId}`,
          sessionId,
          userId,
          session.hostId,
        );

        session.activeOperations--;

        res.json({
          success: true,
          message: "Container stopped successfully",
        });
      } catch (error) {
        session.activeOperations--;

        const errorMsg = error instanceof Error ? error.message : "";
        if (errorMsg.includes("No such container")) {
          return res.status(404).json({
            success: false,
            error: "Container not found",
            code: "CONTAINER_NOT_FOUND",
          });
        }

        sshLogger.error("Failed to stop container", error, {
          operation: "stop_container",
          sessionId,
          containerId,
          userId,
        });

        res.status(500).json({
          success: false,
          error: errorMsg || "Failed to stop container",
        });
      }
    },
  );

  /**
   * @openapi
   * /docker/containers/{sessionId}/{containerId}/restart:
   *   post:
   *     summary: Restart container
   *     description: Restarts a specific container.
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
   *         description: Container restarted successfully.
   *       400:
   *         description: SSH session not found or not connected.
   *       404:
   *         description: Container not found.
   *       500:
   *         description: Failed to restart container.
   */
  app.post(
    "/docker/containers/:sessionId/:containerId/restart",
    async (req, res) => {
      const { sessionId, containerId } = req.params;
      const userId = getRequestUserId(req);

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const session = sshSessions[sessionId];

      if (!session || !session.isConnected) {
        return res.status(400).json({
          error: "SSH session not found or not connected",
        });
      }

      session.lastActive = Date.now();
      session.activeOperations++;

      try {
        sshLogger.info("Docker container operation", {
          operation: "docker_container_op",
          sessionId,
          userId,
          hostId: session.hostId,
          containerId,
          action: "restart",
        });
        await executeDockerCommand(
          session,
          `docker restart ${containerId}`,
          sessionId,
          userId,
          session.hostId,
        );

        session.activeOperations--;

        res.json({
          success: true,
          message: "Container restarted successfully",
        });
      } catch (error) {
        session.activeOperations--;

        const errorMsg = error instanceof Error ? error.message : "";
        if (errorMsg.includes("No such container")) {
          return res.status(404).json({
            success: false,
            error: "Container not found",
            code: "CONTAINER_NOT_FOUND",
          });
        }

        sshLogger.error("Failed to restart container", error, {
          operation: "restart_container",
          sessionId,
          containerId,
          userId,
        });

        res.status(500).json({
          success: false,
          error: errorMsg || "Failed to restart container",
        });
      }
    },
  );

  /**
   * @openapi
   * /docker/containers/{sessionId}/{containerId}/pause:
   *   post:
   *     summary: Pause container
   *     description: Pauses a specific container.
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
   *         description: Container paused successfully.
   *       400:
   *         description: SSH session not found or not connected.
   *       404:
   *         description: Container not found.
   *       500:
   *         description: Failed to pause container.
   */
  app.post(
    "/docker/containers/:sessionId/:containerId/pause",
    async (req, res) => {
      const { sessionId, containerId } = req.params;
      const userId = getRequestUserId(req);

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const session = sshSessions[sessionId];

      if (!session || !session.isConnected) {
        return res.status(400).json({
          error: "SSH session not found or not connected",
        });
      }

      session.lastActive = Date.now();
      session.activeOperations++;

      try {
        sshLogger.info("Docker container operation", {
          operation: "docker_container_op",
          sessionId,
          userId,
          hostId: session.hostId,
          containerId,
          action: "pause",
        });
        await executeDockerCommand(
          session,
          `docker pause ${containerId}`,
          sessionId,
          userId,
          session.hostId,
        );

        session.activeOperations--;

        res.json({
          success: true,
          message: "Container paused successfully",
        });
      } catch (error) {
        session.activeOperations--;

        const errorMsg = error instanceof Error ? error.message : "";
        if (errorMsg.includes("No such container")) {
          return res.status(404).json({
            success: false,
            error: "Container not found",
            code: "CONTAINER_NOT_FOUND",
          });
        }

        sshLogger.error("Failed to pause container", error, {
          operation: "pause_container",
          sessionId,
          containerId,
          userId,
        });

        res.status(500).json({
          success: false,
          error: errorMsg || "Failed to pause container",
        });
      }
    },
  );

  /**
   * @openapi
   * /docker/containers/{sessionId}/{containerId}/unpause:
   *   post:
   *     summary: Unpause container
   *     description: Unpauses a specific container.
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
   *         description: Container unpaused successfully.
   *       400:
   *         description: SSH session not found or not connected.
   *       404:
   *         description: Container not found.
   *       500:
   *         description: Failed to unpause container.
   */
  app.post(
    "/docker/containers/:sessionId/:containerId/unpause",
    async (req, res) => {
      const { sessionId, containerId } = req.params;
      const userId = getRequestUserId(req);

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const session = sshSessions[sessionId];

      if (!session || !session.isConnected) {
        return res.status(400).json({
          error: "SSH session not found or not connected",
        });
      }

      session.lastActive = Date.now();
      session.activeOperations++;

      try {
        sshLogger.info("Docker container operation", {
          operation: "docker_container_op",
          sessionId,
          userId,
          hostId: session.hostId,
          containerId,
          action: "unpause",
        });
        await executeDockerCommand(
          session,
          `docker unpause ${containerId}`,
          sessionId,
          userId,
          session.hostId,
        );

        session.activeOperations--;

        res.json({
          success: true,
          message: "Container unpaused successfully",
        });
      } catch (error) {
        session.activeOperations--;

        const errorMsg = error instanceof Error ? error.message : "";
        if (errorMsg.includes("No such container")) {
          return res.status(404).json({
            success: false,
            error: "Container not found",
            code: "CONTAINER_NOT_FOUND",
          });
        }

        sshLogger.error("Failed to unpause container", error, {
          operation: "unpause_container",
          sessionId,
          containerId,
          userId,
        });

        res.status(500).json({
          success: false,
          error: errorMsg || "Failed to unpause container",
        });
      }
    },
  );

  /**
   * @openapi
   * /docker/containers/{sessionId}/{containerId}/remove:
   *   delete:
   *     summary: Remove container
   *     description: Removes a specific container.
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
   *         description: Container removed successfully.
   *       400:
   *         description: SSH session not found or not connected, or cannot remove a running container.
   *       404:
   *         description: Container not found.
   *       500:
   *         description: Failed to remove container.
   */
  app.delete(
    "/docker/containers/:sessionId/:containerId/remove",
    async (req, res) => {
      const { sessionId, containerId } = req.params;
      const force = req.query.force === "true";
      const userId = getRequestUserId(req);

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const session = sshSessions[sessionId];

      if (!session || !session.isConnected) {
        return res.status(400).json({
          error: "SSH session not found or not connected",
        });
      }

      session.lastActive = Date.now();
      session.activeOperations++;

      try {
        sshLogger.info("Docker container operation", {
          operation: "docker_container_op",
          sessionId,
          userId,
          hostId: session.hostId,
          containerId,
          action: "remove",
        });
        const forceFlag = force ? "-f " : "";
        await executeDockerCommand(
          session,
          `docker rm ${forceFlag}${containerId}`,
          sessionId,
          userId,
          session.hostId,
        );

        session.activeOperations--;

        res.json({
          success: true,
          message: "Container removed successfully",
        });
      } catch (error) {
        session.activeOperations--;

        const errorMsg = error instanceof Error ? error.message : "";
        if (errorMsg.includes("No such container")) {
          return res.status(404).json({
            success: false,
            error: "Container not found",
            code: "CONTAINER_NOT_FOUND",
          });
        }

        if (errorMsg.includes("cannot remove a running container")) {
          return res.status(400).json({
            success: false,
            error:
              "Cannot remove a running container. Stop it first or use force.",
            code: "CONTAINER_RUNNING",
          });
        }

        sshLogger.error("Failed to remove container", error, {
          operation: "remove_container",
          sessionId,
          containerId,
          userId,
        });

        res.status(500).json({
          success: false,
          error: errorMsg || "Failed to remove container",
        });
      }
    },
  );

  /**
   * @openapi
   * /docker/containers/{sessionId}/{containerId}/logs:
   *   get:
   *     summary: Get container logs
   *     description: Retrieves logs for a specific container.
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
  app.get(
    "/docker/containers/:sessionId/:containerId/logs",
    async (req, res) => {
      const { sessionId, containerId } = req.params;
      const tail = req.query.tail ? parseInt(req.query.tail as string) : 100;
      const timestamps = req.query.timestamps === "true";
      const since = req.query.since as string;
      const until = req.query.until as string;
      const userId = getRequestUserId(req);

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const session = sshSessions[sessionId];

      if (!session || !session.isConnected) {
        return res.status(400).json({
          error: "SSH session not found or not connected",
        });
      }

      session.lastActive = Date.now();
      session.activeOperations++;

      try {
        let command = `docker logs ${containerId}`;

        if (tail && tail > 0) {
          command += ` --tail ${Math.floor(tail)}`;
        }

        if (timestamps) {
          command += " --timestamps";
        }

        if (since && DOCKER_TIMESTAMP_RE.test(since)) {
          command += ` --since ${since}`;
        }

        if (until && DOCKER_TIMESTAMP_RE.test(until)) {
          command += ` --until ${until}`;
        }

        command += " 2>&1";

        const logs = await executeDockerCommand(
          session,
          command,
          sessionId,
          userId,
          session.hostId,
        );

        session.activeOperations--;

        res.json({
          success: true,
          logs,
        });
      } catch (error) {
        session.activeOperations--;

        const errorMsg = error instanceof Error ? error.message : "";
        if (errorMsg.includes("No such container")) {
          return res.status(404).json({
            success: false,
            error: "Container not found",
            code: "CONTAINER_NOT_FOUND",
          });
        }

        sshLogger.error("Failed to get container logs", error, {
          operation: "get_logs",
          sessionId,
          containerId,
          userId,
        });

        res.status(500).json({
          success: false,
          error: errorMsg || "Failed to get container logs",
        });
      }
    },
  );

  /**
   * @openapi
   * /docker/containers/{sessionId}/{containerId}/stats:
   *   get:
   *     summary: Get container stats
   *     description: Retrieves stats for a specific container.
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
  app.get(
    "/docker/containers/:sessionId/:containerId/stats",
    async (req, res) => {
      const { sessionId, containerId } = req.params;
      const userId = getRequestUserId(req);

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const session = sshSessions[sessionId];

      if (!session || !session.isConnected) {
        return res.status(400).json({
          error: "SSH session not found or not connected",
        });
      }

      session.lastActive = Date.now();
      session.activeOperations++;

      try {
        const statsFormatStr = session.isWindows
          ? `"{\\"cpu\\":\\"{{.CPUPerc}}\\",\\"memory\\":\\"{{.MemUsage}}\\",\\"memoryPercent\\":\\"{{.MemPerc}}\\",\\"netIO\\":\\"{{.NetIO}}\\",\\"blockIO\\":\\"{{.BlockIO}}\\",\\"pids\\":\\"{{.PIDs}}\\"}"`
          : `'{"cpu":"{{.CPUPerc}}","memory":"{{.MemUsage}}","memoryPercent":"{{.MemPerc}}","netIO":"{{.NetIO}}","blockIO":"{{.BlockIO}}","pids":"{{.PIDs}}"}' `;
        const command = `docker stats ${containerId} --no-stream --format ${statsFormatStr}`;

        const output = await executeDockerCommand(
          session,
          command,
          sessionId,
          userId,
          session.hostId,
        );
        const rawStats = JSON.parse(output.trim());

        const memoryParts = rawStats.memory.split(" / ");
        const memoryUsed = memoryParts[0]?.trim() || "0B";
        const memoryLimit = memoryParts[1]?.trim() || "0B";

        const netIOParts = rawStats.netIO.split(" / ");
        const netInput = netIOParts[0]?.trim() || "0B";
        const netOutput = netIOParts[1]?.trim() || "0B";

        const blockIOParts = rawStats.blockIO.split(" / ");
        const blockRead = blockIOParts[0]?.trim() || "0B";
        const blockWrite = blockIOParts[1]?.trim() || "0B";

        const stats = {
          cpu: rawStats.cpu,
          memoryUsed,
          memoryLimit,
          memoryPercent: rawStats.memoryPercent,
          netInput,
          netOutput,
          blockRead,
          blockWrite,
          pids: rawStats.pids,
        };

        session.activeOperations--;

        res.json(stats);
      } catch (error) {
        session.activeOperations--;

        const errorMsg = error instanceof Error ? error.message : "";
        if (errorMsg.includes("No such container")) {
          return res.status(404).json({
            success: false,
            error: "Container not found",
            code: "CONTAINER_NOT_FOUND",
          });
        }

        sshLogger.error("Failed to get container stats", error, {
          operation: "get_stats",
          sessionId,
          containerId,
          userId,
        });

        res.status(500).json({
          success: false,
          error: errorMsg || "Failed to get container stats",
        });
      }
    },
  );
}
