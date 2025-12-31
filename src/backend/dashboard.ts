import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { getDb } from "./database/db/index.js";
import { recentActivity, sshData } from "./database/db/schema.js";
import { eq, and, desc } from "drizzle-orm";
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

    const hosts = await SimpleDBOps.select(
      getDb()
        .select()
        .from(sshData)
        .where(and(eq(sshData.id, hostId), eq(sshData.userId, userId))),
      "ssh_data",
      userId,
    );

    if (hosts.length === 0) {
      return res.status(404).json({ error: "Host not found" });
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
