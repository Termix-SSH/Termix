import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import { commandHistory } from "../db/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { authLogger, databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

const router = express.Router();

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

/**
 * @openapi
 * /terminal/command_history:
 *   post:
 *     summary: Save command to history
 *     description: Saves a command to the command history for a specific host.
 *     tags:
 *       - Terminal
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostId:
 *                 type: integer
 *               command:
 *                 type: string
 *     responses:
 *       201:
 *         description: Command saved successfully.
 *       400:
 *         description: Missing required parameters.
 *       500:
 *         description: Failed to save command.
 */
router.post(
  "/command_history",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { hostId, command } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !isNonEmptyString(command)) {
      authLogger.warn("Invalid command history save request", {
        operation: "command_history_save",
        userId,
        hasHostId: !!hostId,
        hasCommand: !!command,
      });
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const sensitivePatterns = [
      /passw(or)?d/i,
      /\bsecret\b/i,
      /\btoken\b/i,
      /\bapi.?key\b/i,
      /PASS(WORD)?=/i,
      /AWS_SECRET/i,
      /mysql\b.*-p/i,
      /sudo\s+-S\b/,
      /htpasswd/i,
      /sshpass/i,
      /curl\b.*-u\s/i,
      /export\b.*(?:PASSWORD|SECRET|TOKEN|KEY)=/i,
    ];

    const trimmedCommand = command.trim();
    if (sensitivePatterns.some((p: RegExp) => p.test(trimmedCommand))) {
      return res.status(201).json({
        id: 0,
        userId,
        hostId: parseInt(hostId, 10),
        command: trimmedCommand,
        executedAt: new Date().toISOString(),
      });
    }

    try {
      const insertData = {
        userId,
        hostId: parseInt(hostId, 10),
        command: trimmedCommand,
      };

      const result = await db
        .insert(commandHistory)
        .values(insertData)
        .returning();

      res.status(201).json(result[0]);
    } catch (err) {
      authLogger.error("Failed to save command to history", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to save command",
      });
    }
  },
);

/**
 * @openapi
 * /terminal/command_history/{hostId}:
 *   get:
 *     summary: Get command history
 *     description: Retrieves the command history for a specific host.
 *     tags:
 *       - Terminal
 *     parameters:
 *       - in: path
 *         name: hostId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: A list of commands.
 *       400:
 *         description: Invalid request parameters.
 *       500:
 *         description: Failed to fetch history.
 */
router.get(
  "/command_history/:hostId",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const hostId = Array.isArray(req.params.hostId)
      ? req.params.hostId[0]
      : req.params.hostId;
    const hostIdNum = parseInt(hostId, 10);

    if (!isNonEmptyString(userId) || isNaN(hostIdNum)) {
      authLogger.warn("Invalid command history fetch request", {
        userId,
        hostId: hostIdNum,
      });
      return res.status(400).json({ error: "Invalid request parameters" });
    }

    try {
      const result = await db
        .select({
          command: commandHistory.command,
          maxExecutedAt: sql<number>`MAX(${commandHistory.executedAt})`,
        })
        .from(commandHistory)
        .where(
          and(
            eq(commandHistory.userId, userId),
            eq(commandHistory.hostId, hostIdNum),
          ),
        )
        .groupBy(commandHistory.command)
        .orderBy(desc(sql`MAX(${commandHistory.executedAt})`))
        .limit(500);

      const uniqueCommands = result.map((r) => r.command);

      res.json(uniqueCommands);
    } catch (err) {
      authLogger.error("Failed to fetch command history", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to fetch history",
      });
    }
  },
);

/**
 * @openapi
 * /terminal/command_history/delete:
 *   post:
 *     summary: Delete a specific command from history
 *     description: Deletes a specific command from the history of a host.
 *     tags:
 *       - Terminal
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostId:
 *                 type: integer
 *               command:
 *                 type: string
 *     responses:
 *       200:
 *         description: Command deleted successfully.
 *       400:
 *         description: Missing required parameters.
 *       500:
 *         description: Failed to delete command.
 */
router.post(
  "/command_history/delete",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { hostId, command } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !isNonEmptyString(command)) {
      authLogger.warn("Invalid command delete request", {
        operation: "command_history_delete",
        userId,
        hasHostId: !!hostId,
        hasCommand: !!command,
      });
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      const hostIdNum = parseInt(hostId, 10);

      await db
        .delete(commandHistory)
        .where(
          and(
            eq(commandHistory.userId, userId),
            eq(commandHistory.hostId, hostIdNum),
            eq(commandHistory.command, command.trim()),
          ),
        );

      res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to delete command from history", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to delete command",
      });
    }
  },
);

/**
 * @openapi
 * /terminal/command_history/{hostId}:
 *   delete:
 *     summary: Clear command history
 *     description: Clears the entire command history for a specific host.
 *     tags:
 *       - Terminal
 *     parameters:
 *       - in: path
 *         name: hostId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Command history cleared successfully.
 *       400:
 *         description: Invalid request.
 *       500:
 *         description: Failed to clear history.
 */
router.delete(
  "/command_history/:hostId",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const hostId = Array.isArray(req.params.hostId)
      ? req.params.hostId[0]
      : req.params.hostId;
    const hostIdNum = parseInt(hostId, 10);

    if (!isNonEmptyString(userId) || isNaN(hostIdNum)) {
      authLogger.warn("Invalid command history clear request");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      await db
        .delete(commandHistory)
        .where(
          and(
            eq(commandHistory.userId, userId),
            eq(commandHistory.hostId, hostIdNum),
          ),
        );
      databaseLogger.info("Terminal history cleared", {
        operation: "terminal_history_clear",
        userId,
        hostId: hostIdNum,
      });

      res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to clear command history", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to clear history",
      });
    }
  },
);

/**
 * @openapi
 * /terminal/session_settings:
 *   get:
 *     summary: Get session persistence settings
 *     description: Returns the session timeout and persistence enabled flag.
 *     tags:
 *       - Terminal
 *     responses:
 *       200:
 *         description: Session settings.
 *       500:
 *         description: Failed to fetch settings.
 */
router.get(
  "/session_settings",
  authenticateJWT,
  async (_req: Request, res: Response) => {
    try {
      const timeoutRow = db.$client
        .prepare(
          "SELECT value FROM settings WHERE key = 'terminal_session_timeout_minutes'",
        )
        .get() as { value: string } | undefined;
      const enabledRow = db.$client
        .prepare(
          "SELECT value FROM settings WHERE key = 'terminal_session_persistence_enabled'",
        )
        .get() as { value: string } | undefined;

      res.json({
        timeoutMinutes: timeoutRow ? parseInt(timeoutRow.value, 10) : 30,
        enabled: enabledRow ? enabledRow.value === "true" : true,
      });
    } catch (err) {
      authLogger.error("Failed to fetch session settings", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to fetch settings",
      });
    }
  },
);

/**
 * @openapi
 * /terminal/session_settings:
 *   post:
 *     summary: Update session persistence settings
 *     description: Saves session timeout and persistence enabled flag.
 *     tags:
 *       - Terminal
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               timeoutMinutes:
 *                 type: integer
 *               enabled:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Settings saved successfully.
 *       400:
 *         description: Invalid parameters.
 *       500:
 *         description: Failed to save settings.
 */
router.post(
  "/session_settings",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const { timeoutMinutes, enabled } = req.body;

    if (
      timeoutMinutes !== undefined &&
      (typeof timeoutMinutes !== "number" ||
        timeoutMinutes < 1 ||
        timeoutMinutes > 1440)
    ) {
      return res
        .status(400)
        .json({ error: "timeoutMinutes must be between 1 and 1440" });
    }

    try {
      if (timeoutMinutes !== undefined) {
        db.$client
          .prepare(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('terminal_session_timeout_minutes', ?)",
          )
          .run(String(timeoutMinutes));
      }

      if (enabled !== undefined) {
        db.$client
          .prepare(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('terminal_session_persistence_enabled', ?)",
          )
          .run(String(enabled));
      }

      res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to save session settings", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to save settings",
      });
    }
  },
);

export default router;
