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

    try {
      const insertData = {
        userId,
        hostId: parseInt(hostId, 10),
        command: command.trim(),
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

export default router;
