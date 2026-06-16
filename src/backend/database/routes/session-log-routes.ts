import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import fs from "fs";
import path from "path";
import { eq, and, desc, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { sessionRecordings, hosts } from "../db/schema.js";
import { apiLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import type { Request, Response } from "express";

const router = express.Router();

const DATA_DIR = process.env.DATA_DIR ?? "./db/data";

// Delete session log files and DB rows older than this many days
const LOG_RETENTION_DAYS = 30;

async function pruneOldLogs(): Promise<void> {
  try {
    const cutoff = new Date(
      Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const old = await db
      .select({
        id: sessionRecordings.id,
        recordingPath: sessionRecordings.recordingPath,
      })
      .from(sessionRecordings)
      .where(lt(sessionRecordings.startedAt, cutoff));

    for (const row of old) {
      if (row.recordingPath) {
        const resolved = path.resolve(row.recordingPath);
        const allowed = path.resolve(DATA_DIR, "session_logs");
        if (resolved.startsWith(allowed) && fs.existsSync(resolved)) {
          await fs.promises.unlink(resolved).catch(() => {});
        }
      }
      await db
        .delete(sessionRecordings)
        .where(eq(sessionRecordings.id, row.id));
    }

    if (old.length > 0) {
      apiLogger.info(`Pruned ${old.length} old session log(s)`, {
        operation: "session_log_prune",
        count: old.length,
      });
    }
  } catch (err) {
    apiLogger.warn("Failed to prune old session logs", {
      operation: "session_log_prune_error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Run prune once at startup, then every 24 hours
pruneOldLogs();
setInterval(pruneOldLogs, 24 * 60 * 60 * 1000);

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * @openapi
 * /session_logs:
 *   get:
 *     summary: List session logs
 *     description: Returns all terminal session recordings for the authenticated user.
 *     tags:
 *       - Session Logs
 *     responses:
 *       200:
 *         description: List of session recordings.
 *       500:
 *         description: Failed to fetch session logs.
 */
router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const rows = await db
      .select({
        id: sessionRecordings.id,
        hostId: sessionRecordings.hostId,
        userId: sessionRecordings.userId,
        startedAt: sessionRecordings.startedAt,
        endedAt: sessionRecordings.endedAt,
        duration: sessionRecordings.duration,
        recordingPath: sessionRecordings.recordingPath,
        hostName: hosts.name,
        hostIp: hosts.ip,
      })
      .from(sessionRecordings)
      .leftJoin(hosts, eq(sessionRecordings.hostId, hosts.id))
      .where(eq(sessionRecordings.userId, userId))
      .orderBy(desc(sessionRecordings.startedAt));

    const records = rows.map((row) => {
      let sizeBytes: number | null = null;
      if (row.recordingPath) {
        try {
          sizeBytes = fs.statSync(row.recordingPath).size;
        } catch {
          // file may have been removed
        }
      }
      return { ...row, sizeBytes };
    });

    res.json({ logs: records });
  } catch (error) {
    apiLogger.error("Failed to fetch session logs", error, {
      operation: "session_logs_list",
      userId,
    });
    res.status(500).json({ error: "Failed to fetch session logs" });
  }
});

/**
 * @openapi
 * /session_logs/{id}:
 *   get:
 *     summary: Get session log metadata
 *     description: Returns metadata for a single session recording.
 *     tags:
 *       - Session Logs
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Session recording metadata.
 *       403:
 *         description: Not authorized.
 *       404:
 *         description: Session log not found.
 *       500:
 *         description: Failed to fetch session log.
 */
router.get("/:id", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const rows = await db
      .select()
      .from(sessionRecordings)
      .where(
        and(eq(sessionRecordings.id, id), eq(sessionRecordings.userId, userId)),
      )
      .limit(1);

    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ log: rows[0] });
  } catch (error) {
    apiLogger.error("Failed to fetch session log", error, {
      operation: "session_log_get",
      userId,
      id,
    });
    res.status(500).json({ error: "Failed to fetch session log" });
  }
});

/**
 * @openapi
 * /session_logs/{id}/content:
 *   get:
 *     summary: Get session log content
 *     description: Returns the raw text content of a session log file.
 *     tags:
 *       - Session Logs
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Raw log text.
 *       403:
 *         description: Not authorized.
 *       404:
 *         description: Session log or file not found.
 *       500:
 *         description: Failed to read session log.
 */
router.get(
  "/:id/content",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const rawId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    try {
      const rows = await db
        .select({ recordingPath: sessionRecordings.recordingPath })
        .from(sessionRecordings)
        .where(
          and(
            eq(sessionRecordings.id, id),
            eq(sessionRecordings.userId, userId),
          ),
        )
        .limit(1);

      if (rows.length === 0)
        return res.status(404).json({ error: "Not found" });

      const filePath = rows[0].recordingPath;
      if (!filePath)
        return res.status(404).json({ error: "No recording file" });

      const resolvedPath = path.resolve(filePath);
      const allowedBase = path.resolve(DATA_DIR, "session_logs");
      if (!resolvedPath.startsWith(allowedBase)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: "File not found" });
      }

      const content = await fs.promises.readFile(resolvedPath, "utf-8");
      res.type("text/plain").send(content);
    } catch (error) {
      apiLogger.error("Failed to read session log content", error, {
        operation: "session_log_content",
        userId,
        id,
      });
      res.status(500).json({ error: "Failed to read session log" });
    }
  },
);

/**
 * @openapi
 * /session_logs/{id}:
 *   delete:
 *     summary: Delete session log
 *     description: Deletes a session recording and its log file.
 *     tags:
 *       - Session Logs
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Session log deleted.
 *       403:
 *         description: Not authorized.
 *       404:
 *         description: Session log not found.
 *       500:
 *         description: Failed to delete session log.
 */
router.delete("/:id", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const rows = await db
      .select({ recordingPath: sessionRecordings.recordingPath })
      .from(sessionRecordings)
      .where(
        and(eq(sessionRecordings.id, id), eq(sessionRecordings.userId, userId)),
      )
      .limit(1);

    if (rows.length === 0) return res.status(404).json({ error: "Not found" });

    const filePath = rows[0].recordingPath;

    await db
      .delete(sessionRecordings)
      .where(
        and(eq(sessionRecordings.id, id), eq(sessionRecordings.userId, userId)),
      );

    if (filePath) {
      const resolvedPath = path.resolve(filePath);
      const allowedBase = path.resolve(DATA_DIR, "session_logs");
      if (resolvedPath.startsWith(allowedBase) && fs.existsSync(resolvedPath)) {
        await fs.promises.unlink(resolvedPath).catch(() => {});
      }
    }

    res.json({ success: true });
  } catch (error) {
    apiLogger.error("Failed to delete session log", error, {
      operation: "session_log_delete",
      userId,
      id,
    });
    res.status(500).json({ error: "Failed to delete session log" });
  }
});

export default router;
