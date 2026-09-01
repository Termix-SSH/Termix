import type { AuthenticatedRequest } from "../../../types/index.js";
import type { Request, RequestHandler, Response, Router } from "express";
import { authLogger } from "../../utils/logger.js";
import { createCurrentCredentialRepository } from "../repositories/factory.js";

export function registerCredentialBulkRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /credentials/reorder:
   *   put:
   *     summary: Reorder credentials
   *     description: Sets a manual sortOrder for multiple credentials within the same folder, used by drag-to-reorder in the sidebar's manual sort mode.
   *     tags:
   *       - Credentials
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               positions:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                     sortOrder:
   *                       type: integer
   *     responses:
   *       200:
   *         description: Credentials reordered successfully.
   *       400:
   *         description: Invalid positions array.
   *       500:
   *         description: Failed to reorder credentials.
   */
  router.put(
    "/reorder",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const { positions } = req.body as {
        positions?: { id?: unknown; sortOrder?: unknown }[];
      };

      if (!Array.isArray(positions)) {
        return res.status(400).json({ error: "positions array is required" });
      }

      const normalized: { id: number; sortOrder: number }[] = [];
      for (const entry of positions) {
        if (
          typeof entry?.id !== "number" ||
          !Number.isInteger(entry.id) ||
          typeof entry.sortOrder !== "number" ||
          !Number.isFinite(entry.sortOrder)
        ) {
          return res.status(400).json({
            error:
              "Each position requires an integer id and a numeric sortOrder",
          });
        }
        normalized.push({ id: entry.id, sortOrder: entry.sortOrder });
      }

      if (normalized.length === 0) {
        return res.status(400).json({ error: "positions array is required" });
      }

      try {
        const updated =
          await createCurrentCredentialRepository().reorderForUser(
            userId,
            normalized,
          );
        return res.json({ updated });
      } catch (error) {
        authLogger.error("Failed to reorder credentials:", error);
        return res.status(500).json({ error: "Failed to reorder credentials" });
      }
    },
  );
}
