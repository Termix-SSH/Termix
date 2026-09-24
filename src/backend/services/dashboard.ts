import express from "express";
import cookieParser from "cookie-parser";
import { createCorsMiddleware } from "../utils/cors-config.js";
import { createCompressionMiddleware } from "../utils/compression-config.js";
import { dashboardLogger } from "../utils/logger.js";
import { AuthManager } from "../utils/auth-manager.js";
import type { AuthenticatedRequest } from "../../types/index.js";
import { dashboardServiceLinksRouter } from "../database/routes/dashboard-service-links-routes.js";
import { createCurrentRecentActivityRepository } from "../database/repositories/factory.js";
import { DataCrypto } from "../utils/data-crypto.js";
import { recordRecentActivity } from "./recent-activity.js";
import { listenOnServicePort } from "../utils/service-listen.js";

const app = express();
app.set("trust proxy", "loopback");
const authManager = AuthManager.getInstance();

const serverStartTime = Date.now();

function isUserDataUnlocked(userId: string): boolean {
  return DataCrypto.getUserDataKey(userId) !== null;
}

app.use(createCompressionMiddleware());
app.use(createCorsMiddleware());
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(authManager.createAuthMiddleware());

/**
 * @openapi
 * /uptime:
 *   get:
 *     summary: Get server uptime
 *     description: Returns the uptime of the server in various formats.
 *     tags:
 *       - Dashboard
 *     responses:
 *       200:
 *         description: Server uptime information.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 uptimeMs:
 *                   type: number
 *                 uptimeSeconds:
 *                   type: number
 *                 formatted:
 *                   type: string
 *       500:
 *         description: Failed to get uptime.
 */
app.get("/uptime", async (req, res) => {
  try {
    const uptimeMs = Date.now() - serverStartTime;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);

    res.json({
      uptimeMs,
      uptimeSeconds,
      formatted: `${days}d ${hours}h ${minutes}m`,
    });
  } catch (err) {
    dashboardLogger.error("Failed to get uptime", err);
    res.status(500).json({ error: "Failed to get uptime" });
  }
});

/**
 * @openapi
 * /activity/recent:
 *   get:
 *     summary: Get recent activity
 *     description: Fetches the most recent activities for the authenticated user.
 *     tags:
 *       - Dashboard
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: The maximum number of activities to return.
 *     responses:
 *       200:
 *         description: A list of recent activities.
 *       401:
 *         description: Session expired.
 *       500:
 *         description: Failed to get recent activity.
 */
app.get("/activity/recent", async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;

    if (!isUserDataUnlocked(userId)) {
      return res.status(401).json({
        error: "Session expired - please log in again",
        code: "SESSION_EXPIRED",
      });
    }

    const limit = Number(req.query.limit) || 20;

    const activities =
      await createCurrentRecentActivityRepository().listByUserId(userId, limit);

    res.json(activities);
  } catch (err) {
    dashboardLogger.error("Failed to get recent activity", err);
    res.status(500).json({ error: "Failed to get recent activity" });
  }
});

/**
 * @openapi
 * /activity/log:
 *   post:
 *     summary: Log a new activity
 *     description: Logs a new user activity, such as accessing a terminal or file manager. This endpoint is rate-limited.
 *     tags:
 *       - Dashboard
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [terminal, file_manager, server_stats, tunnel, docker, telnet, vnc, rdp]
 *               hostId:
 *                 type: integer
 *               hostName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Activity logged successfully or rate-limited.
 *       400:
 *         description: Invalid request body.
 *       401:
 *         description: Session expired.
 *       404:
 *         description: Host not found or access denied.
 *       500:
 *         description: Failed to log activity.
 */
app.post("/activity/log", async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;

    if (!isUserDataUnlocked(userId)) {
      return res.status(401).json({
        error: "Session expired - please log in again",
        code: "SESSION_EXPIRED",
      });
    }

    const { type, hostId, hostName } = req.body;

    if (!type || !hostId || !hostName) {
      return res.status(400).json({
        error: "Missing required fields: type, hostId, hostName",
      });
    }

    const result = await recordRecentActivity(userId, {
      type,
      hostId,
      hostName,
    });
    if (result.status === "invalid_type") {
      return res.status(400).json({
        error:
          "Invalid activity type. Must be 'terminal', 'file_manager', 'server_stats', 'tunnel', 'docker', 'telnet', 'vnc', or 'rdp'",
      });
    }
    if (result.status === "rate_limited") {
      return res.json({
        message: "Activity already logged recently (rate limited)",
      });
    }
    if (result.status === "denied") {
      return res.status(404).json({ error: "Host not found or access denied" });
    }

    res.json({ message: "Activity logged", id: result.id });
  } catch (err) {
    dashboardLogger.error("Failed to log activity", err);
    res.status(500).json({ error: "Failed to log activity" });
  }
});

/**
 * @openapi
 * /activity/reset:
 *   delete:
 *     summary: Reset recent activity
 *     description: Clears all recent activity for the authenticated user.
 *     tags:
 *       - Dashboard
 *     responses:
 *       200:
 *         description: Recent activity cleared.
 *       401:
 *         description: Session expired.
 *       500:
 *         description: Failed to reset activity.
 */
app.delete("/activity/reset", async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;

    if (!isUserDataUnlocked(userId)) {
      return res.status(401).json({
        error: "Session expired - please log in again",
        code: "SESSION_EXPIRED",
      });
    }

    await createCurrentRecentActivityRepository().deleteByUserId(userId);

    dashboardLogger.success("Recent activity cleared", {
      operation: "reset_recent_activity",
      userId,
    });

    res.json({ message: "Recent activity cleared" });
  } catch (err) {
    dashboardLogger.error("Failed to reset activity", err);
    res.status(500).json({ error: "Failed to reset activity" });
  }
});

app.use("/service-links", dashboardServiceLinksRouter);

const PORT = 30006;
listenOnServicePort({
  app,
  port: PORT,
  logger: dashboardLogger,
  serviceName: "dashboard",
  onListening: async () => {
    try {
      await authManager.initialize();
    } catch (err) {
      dashboardLogger.error("Failed to initialize AuthManager", err, {
        operation: "auth_init_error",
      });
    }
  },
});
