import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import { commandHistory } from "../db/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { authLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

const router = express.Router();

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

// Save command to history
// POST /terminal/command_history
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

// Get command history for a specific host
// GET /terminal/command_history/:hostId
router.get(
  "/command_history/:hostId",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { hostId } = req.params;
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
        .selectDistinct({ command: commandHistory.command })
        .from(commandHistory)
        .where(
          and(
            eq(commandHistory.userId, userId),
            eq(commandHistory.hostId, hostIdNum),
          ),
        )
        .orderBy(desc(commandHistory.executedAt))
        .limit(500);

      const uniqueCommands = Array.from(new Set(result.map((r) => r.command)));

      res.json(uniqueCommands);
    } catch (err) {
      authLogger.error("Failed to fetch command history", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to fetch history",
      });
    }
  },
);

// Delete a specific command from history
// POST /terminal/command_history/delete
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

// Clear command history for a specific host (optional feature)
// DELETE /terminal/command_history/:hostId
router.delete(
  "/command_history/:hostId",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { hostId } = req.params;
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

      authLogger.success(`Command history cleared for host ${hostId}`, {
        operation: "command_history_clear_success",
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
