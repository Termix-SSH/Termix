import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import { eq } from "drizzle-orm";
import { restartGuacServer } from "../../guacamole/guacamole-server.js";
import {
  authLogger,
  getGlobalLogLevel,
  setGlobalLogLevel,
} from "../../utils/logger.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";

function getDefaultGuacUrl(): string {
  return `${process.env.GUACD_HOST || "localhost"}:${process.env.GUACD_PORT || "4822"}`;
}

export function registerUserSettingsRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /users/guacamole-settings:
   *   get:
   *     summary: Get Guacamole settings
   *     description: Returns current guacd enabled status and host:port URL. No authentication required.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Guacamole settings.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 enabled:
   *                   type: boolean
   *                 url:
   *                   type: string
   *       500:
   *         description: Failed to get guacamole settings.
   */
  router.get("/guacamole-settings", authenticateJWT, async (_req, res) => {
    try {
      const enabledRow = db.$client
        .prepare("SELECT value FROM settings WHERE key = 'guac_enabled'")
        .get() as { value: string } | undefined;
      const urlRow = db.$client
        .prepare("SELECT value FROM settings WHERE key = 'guac_url'")
        .get() as { value: string } | undefined;
      res.json({
        enabled: enabledRow ? enabledRow.value !== "false" : true,
        url: urlRow ? urlRow.value : getDefaultGuacUrl(),
      });
    } catch (err) {
      authLogger.error("Failed to get guacamole settings", err);
      res.status(500).json({ error: "Failed to get guacamole settings" });
    }
  });

  /**
   * @openapi
   * /users/guacamole-settings:
   *   patch:
   *     summary: Update Guacamole settings
   *     description: Admin-only. Updates guacd enabled status and/or host:port URL.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               enabled:
   *                 type: boolean
   *               url:
   *                 type: string
   *     responses:
   *       200:
   *         description: Guacamole settings updated.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Failed to update guacamole settings.
   */
  router.patch("/guacamole-settings", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const user = await db.select().from(users).where(eq(users.id, userId));
      if (!user || user.length === 0 || !user[0].isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const { enabled, url } = req.body;
      if (typeof enabled === "boolean") {
        db.$client
          .prepare(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('guac_enabled', ?)",
          )
          .run(enabled ? "true" : "false");
      }
      if (typeof url === "string") {
        db.$client
          .prepare(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('guac_url', ?)",
          )
          .run(url);
        try {
          await restartGuacServer();
        } catch (err) {
          authLogger.error(
            "Failed to restart guac server after URL update",
            err,
          );
        }
      }
      const enabledRow = db.$client
        .prepare("SELECT value FROM settings WHERE key = 'guac_enabled'")
        .get() as { value: string } | undefined;
      const urlRow = db.$client
        .prepare("SELECT value FROM settings WHERE key = 'guac_url'")
        .get() as { value: string } | undefined;
      res.json({
        enabled: enabledRow ? enabledRow.value !== "false" : true,
        url: urlRow ? urlRow.value : getDefaultGuacUrl(),
      });
    } catch (err) {
      authLogger.error("Failed to update guacamole settings", err);
      res.status(500).json({ error: "Failed to update guacamole settings" });
    }
  });

  /**
   * @openapi
   * /users/log-level:
   *   get:
   *     summary: Get log level setting
   *     description: Returns the configured log verbosity level.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Current log level.
   */
  router.get("/log-level", authenticateJWT, async (_req, res) => {
    try {
      const row = db.$client
        .prepare("SELECT value FROM settings WHERE key = 'log_level'")
        .get() as { value: string } | undefined;
      res.json({
        level: row ? row.value : getGlobalLogLevel(),
      });
    } catch (err) {
      authLogger.error("Failed to get log level", err);
      res.status(500).json({ error: "Failed to get log level" });
    }
  });

  /**
   * @openapi
   * /users/log-level:
   *   patch:
   *     summary: Update log level setting (admin only)
   *     description: Sets the log verbosity level.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Log level updated.
   *       400:
   *         description: Invalid log level.
   *       403:
   *         description: Not authorized.
   */
  router.patch("/log-level", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const user = await db.select().from(users).where(eq(users.id, userId));
      if (!user || user.length === 0 || !user[0].isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const { level } = req.body;
      const validLevels = ["debug", "info", "warn", "error"];
      if (typeof level !== "string" || !validLevels.includes(level)) {
        return res
          .status(400)
          .json({ error: "level must be one of: debug, info, warn, error" });
      }
      db.$client
        .prepare(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('log_level', ?)",
        )
        .run(level);
      setGlobalLogLevel(level);
      res.json({ level });
    } catch (err) {
      authLogger.error("Failed to set log level", err);
      res.status(500).json({ error: "Failed to set log level" });
    }
  });

  /**
   * @openapi
   * /users/session-timeout:
   *   get:
   *     summary: Get session timeout setting
   *     description: Returns the configured session timeout in hours.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Current session timeout hours.
   */
  router.get("/session-timeout", authenticateJWT, async (_req, res) => {
    try {
      const row = db.$client
        .prepare(
          "SELECT value FROM settings WHERE key = 'session_timeout_hours'",
        )
        .get() as { value: string } | undefined;
      res.json({
        timeoutHours: row ? parseInt(row.value, 10) : 24,
      });
    } catch (err) {
      authLogger.error("Failed to get session timeout", err);
      res.status(500).json({ error: "Failed to get session timeout" });
    }
  });

  /**
   * @openapi
   * /users/session-timeout:
   *   patch:
   *     summary: Update session timeout setting (admin only)
   *     description: Sets the session timeout in hours.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Session timeout updated.
   *       400:
   *         description: Invalid value.
   *       403:
   *         description: Not authorized.
   */
  router.patch("/session-timeout", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const user = await db.select().from(users).where(eq(users.id, userId));
      if (!user || user.length === 0 || !user[0].isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const { timeoutHours } = req.body;
      if (
        typeof timeoutHours !== "number" ||
        timeoutHours < 1 ||
        timeoutHours > 720
      ) {
        return res
          .status(400)
          .json({ error: "timeoutHours must be between 1 and 720" });
      }
      db.$client
        .prepare(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('session_timeout_hours', ?)",
        )
        .run(String(timeoutHours));
      res.json({ timeoutHours });
    } catch (err) {
      authLogger.error("Failed to set session timeout", err);
      res.status(500).json({ error: "Failed to set session timeout" });
    }
  });
}
