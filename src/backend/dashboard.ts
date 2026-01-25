import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { getDb, DatabaseSaveTrigger } from "./database/db/index.js";
import {
  recentActivity,
  sshData,
  hostAccess,
  dashboardPreferences,
} from "./database/db/schema.js";
import { eq, and, desc, or, sql } from "drizzle-orm";
import { dashboardLogger } from "./utils/logger.js";
import { SimpleDBOps } from "./utils/simple-db-ops.js";
import { AuthManager } from "./utils/auth-manager.js";
import type { AuthenticatedRequest } from "../types/index.js";

const app = express();
const authManager = AuthManager.getInstance();

const serverStartTime = Date.now();

const activityRateLimiter = new Map<string, number>();
const RATE_LIMIT_MS = 1000;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
      ];

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      if (origin.startsWith("https://")) {
        return callback(null, true);
      }

      if (origin.startsWith("http://")) {
        return callback(null, true);
      }

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "User-Agent",
      "X-Electron-App",
    ],
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));

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

    if (!SimpleDBOps.isUserDataUnlocked(userId)) {
      return res.status(401).json({
        error: "Session expired - please log in again",
        code: "SESSION_EXPIRED",
      });
    }

    const limit = Number(req.query.limit) || 20;

    const activities = await SimpleDBOps.select(
      getDb()
        .select()
        .from(recentActivity)
        .where(eq(recentActivity.userId, userId))
        .orderBy(desc(recentActivity.timestamp))
        .limit(limit),
      "recent_activity",
      userId,
    );

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
 *                 enum: [terminal, file_manager, server_stats, tunnel, docker]
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

    if (!SimpleDBOps.isUserDataUnlocked(userId)) {
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

    if (
      ![
        "terminal",
        "file_manager",
        "server_stats",
        "tunnel",
        "docker",
      ].includes(type)
    ) {
      return res.status(400).json({
        error:
          "Invalid activity type. Must be 'terminal', 'file_manager', 'server_stats', 'tunnel', or 'docker'",
      });
    }

    const rateLimitKey = `${userId}:${hostId}:${type}`;
    const now = Date.now();
    const lastLogged = activityRateLimiter.get(rateLimitKey);

    if (lastLogged && now - lastLogged < RATE_LIMIT_MS) {
      return res.json({
        message: "Activity already logged recently (rate limited)",
      });
    }

    activityRateLimiter.set(rateLimitKey, now);

    if (activityRateLimiter.size > 10000) {
      const entriesToDelete: string[] = [];
      for (const [key, timestamp] of activityRateLimiter.entries()) {
        if (now - timestamp > RATE_LIMIT_MS * 2) {
          entriesToDelete.push(key);
        }
      }
      entriesToDelete.forEach((key) => activityRateLimiter.delete(key));
    }

    const ownedHosts = await SimpleDBOps.select(
      getDb()
        .select()
        .from(sshData)
        .where(and(eq(sshData.id, hostId), eq(sshData.userId, userId))),
      "ssh_data",
      userId,
    );

    if (ownedHosts.length === 0) {
      const sharedHosts = await getDb()
        .select()
        .from(hostAccess)
        .where(
          and(eq(hostAccess.hostId, hostId), eq(hostAccess.userId, userId)),
        );

      if (sharedHosts.length === 0) {
        return res
          .status(404)
          .json({ error: "Host not found or access denied" });
      }
    }

    const result = (await SimpleDBOps.insert(
      recentActivity,
      "recent_activity",
      {
        userId,
        type,
        hostId,
        hostName,
      },
      userId,
    )) as unknown as { id: number };

    const allActivities = await SimpleDBOps.select(
      getDb()
        .select()
        .from(recentActivity)
        .where(eq(recentActivity.userId, userId))
        .orderBy(desc(recentActivity.timestamp)),
      "recent_activity",
      userId,
    );

    if (allActivities.length > 100) {
      const toDelete = allActivities.slice(100);
      for (const activity of toDelete) {
        await SimpleDBOps.delete(recentActivity, "recent_activity", userId);
      }
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

    if (!SimpleDBOps.isUserDataUnlocked(userId)) {
      return res.status(401).json({
        error: "Session expired - please log in again",
        code: "SESSION_EXPIRED",
      });
    }

    await SimpleDBOps.delete(
      recentActivity,
      "recent_activity",
      eq(recentActivity.userId, userId),
    );

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

/**
 * @openapi
 * /dashboard/preferences:
 *   get:
 *     summary: Get dashboard layout preferences
 *     description: Returns the user's customized dashboard layout settings. If no preferences exist, returns default layout.
 *     tags:
 *       - Dashboard
 *     responses:
 *       200:
 *         description: Dashboard preferences retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cards:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       enabled:
 *                         type: boolean
 *                       order:
 *                         type: integer
 *       401:
 *         description: Session expired
 *       500:
 *         description: Failed to get preferences
 */
app.get("/dashboard/preferences", async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;

    if (!SimpleDBOps.isUserDataUnlocked(userId)) {
      return res.status(401).json({
        error: "Session expired - please log in again",
        code: "SESSION_EXPIRED",
      });
    }

    const preferences = await getDb()
      .select()
      .from(dashboardPreferences)
      .where(eq(dashboardPreferences.userId, userId));

    if (preferences.length === 0) {
      const defaultLayout = {
        cards: [
          { id: "server_overview", enabled: true, order: 1 },
          { id: "recent_activity", enabled: true, order: 2 },
          { id: "network_graph", enabled: false, order: 3 },
          { id: "quick_actions", enabled: true, order: 4 },
          { id: "server_stats", enabled: true, order: 5 },
        ],
      };
      return res.json(defaultLayout);
    }

    const layout = JSON.parse(preferences[0].layout as string);
    res.json(layout);
  } catch (err) {
    dashboardLogger.error("Failed to get dashboard preferences", err);
    res.status(500).json({ error: "Failed to get dashboard preferences" });
  }
});

/**
 * @openapi
 * /dashboard/preferences:
 *   post:
 *     summary: Save dashboard layout preferences
 *     description: Saves or updates the user's customized dashboard layout settings.
 *     tags:
 *       - Dashboard
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cards:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     enabled:
 *                       type: boolean
 *                     order:
 *                       type: integer
 *     responses:
 *       200:
 *         description: Preferences saved successfully
 *       400:
 *         description: Invalid request body
 *       401:
 *         description: Session expired
 *       500:
 *         description: Failed to save preferences
 */
app.post("/dashboard/preferences", async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;

    if (!SimpleDBOps.isUserDataUnlocked(userId)) {
      return res.status(401).json({
        error: "Session expired - please log in again",
        code: "SESSION_EXPIRED",
      });
    }

    const { cards } = req.body;

    if (!cards || !Array.isArray(cards)) {
      return res.status(400).json({
        error: "Invalid request body. Expected { cards: Array }",
      });
    }

    const layout = JSON.stringify({ cards });

    const existing = await getDb()
      .select()
      .from(dashboardPreferences)
      .where(eq(dashboardPreferences.userId, userId));

    if (existing.length > 0) {
      await getDb()
        .update(dashboardPreferences)
        .set({ layout, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(dashboardPreferences.userId, userId));
    } else {
      await getDb().insert(dashboardPreferences).values({ userId, layout });
    }

    await DatabaseSaveTrigger.triggerSave("dashboard_preferences_updated");

    dashboardLogger.success("Dashboard preferences saved", {
      operation: "save_dashboard_preferences",
      userId,
    });

    res.json({ success: true, message: "Dashboard preferences saved" });
  } catch (err) {
    dashboardLogger.error("Failed to save dashboard preferences", err);
    res.status(500).json({ error: "Failed to save dashboard preferences" });
  }
});

const PORT = 30006;
app.listen(PORT, async () => {
  try {
    await authManager.initialize();
  } catch (err) {
    dashboardLogger.error("Failed to initialize AuthManager", err, {
      operation: "auth_init_error",
    });
  }
});
