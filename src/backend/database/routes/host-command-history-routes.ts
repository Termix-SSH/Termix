import type { AuthenticatedRequest } from "../../../types/index.js";
import type { Request, RequestHandler, Response, Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { sshLogger } from "../../utils/logger.js";
import { db } from "../db/index.js";
import { commandHistory } from "../db/schema.js";
import { isNonEmptyString } from "./host-normalizers.js";

export function registerHostCommandHistoryRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /host/command-history/{hostId}:
   *   get:
   *     summary: Get command history
   *     description: Retrieves the command history for a specific host.
   *     tags:
   *       - SSH
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
   *         description: Invalid userId or hostId.
   *       500:
   *         description: Failed to fetch command history.
   */
  router.get(
    "/command-history/:hostId",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const hostIdParam = Array.isArray(req.params.hostId)
        ? req.params.hostId[0]
        : req.params.hostId;
      const hostId = parseInt(hostIdParam, 10);

      if (!isNonEmptyString(userId) || !hostId) {
        sshLogger.warn("Invalid userId or hostId for command history fetch", {
          operation: "command_history_fetch",
          hostId,
          userId,
        });
        return res.status(400).json({ error: "Invalid userId or hostId" });
      }

      try {
        const history = await db
          .select({
            id: commandHistory.id,
            command: commandHistory.command,
          })
          .from(commandHistory)
          .where(
            and(
              eq(commandHistory.userId, userId),
              eq(commandHistory.hostId, hostId),
            ),
          )
          .orderBy(desc(commandHistory.executedAt))
          .limit(200);

        res.json(history.map((h) => h.command));
      } catch (err) {
        sshLogger.error("Failed to fetch command history from database", err, {
          operation: "command_history_fetch",
          hostId,
          userId,
        });
        res.status(500).json({ error: "Failed to fetch command history" });
      }
    },
  );

  /**
   * @openapi
   * /host/command-history:
   *   delete:
   *     summary: Delete command from history
   *     description: Deletes a specific command from the history of a host.
   *     tags:
   *       - SSH
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
   *         description: Command deleted from history.
   *       400:
   *         description: Invalid data.
   *       500:
   *         description: Failed to delete command.
   */
  router.delete(
    "/command-history",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const { hostId, command } = req.body;

      if (!isNonEmptyString(userId) || !hostId || !command) {
        sshLogger.warn("Invalid data for command history deletion", {
          operation: "command_history_delete",
          hostId,
          userId,
        });
        return res.status(400).json({ error: "Invalid data" });
      }

      try {
        await db
          .delete(commandHistory)
          .where(
            and(
              eq(commandHistory.userId, userId),
              eq(commandHistory.hostId, hostId),
              eq(commandHistory.command, command),
            ),
          );

        res.json({ message: "Command deleted from history" });
      } catch (err) {
        sshLogger.error("Failed to delete command from history", err, {
          operation: "command_history_delete",
          hostId,
          userId,
          command,
        });
        res.status(500).json({ error: "Failed to delete command" });
      }
    },
  );
}
