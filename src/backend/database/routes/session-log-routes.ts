import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import fs from "fs";
import path from "path";
import { apiLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import type { Request, Response } from "express";
import { PermissionManager } from "../../utils/permission-manager.js";
import { createCurrentSessionRecordingRepository } from "../repositories/factory.js";
import { getDb } from "../db/index.js";

const router = express.Router();

const DATA_DIR = process.env.DATA_DIR ?? "./db/data";

const permissionManager = PermissionManager.getInstance();

function isAllowedRecordingPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return ["session_logs", "session_recordings"].some((directory) => {
    const base = `${path.resolve(DATA_DIR, directory)}${path.sep}`;
    return resolved.startsWith(base);
  });
}

function getRetentionDays(): number {
  const envDays = parseInt(
    process.env.SESSION_RECORDING_RETENTION_DAYS || "",
    10,
  );
  try {
    const row = getDb()
      .$client.prepare(
        "SELECT value FROM settings WHERE key = 'session_recording_retention_days'",
      )
      .get() as { value?: string } | undefined;
    const configured = parseInt(row?.value || "", 10);
    if (configured >= 1 && configured <= 3650) return configured;
  } catch {
    // use environment/default below
  }
  return envDays >= 1 && envDays <= 3650 ? envDays : 30;
}

async function canAccessRecording(
  userId: string,
  ownerId: string,
): Promise<boolean> {
  return userId === ownerId || permissionManager.isAdmin(userId);
}

async function pruneOldLogs(): Promise<void> {
  try {
    const cutoff = new Date(
      Date.now() - getRetentionDays() * 24 * 60 * 60 * 1000,
    ).toISOString();

    const sessionRecordingRepository =
      createCurrentSessionRecordingRepository();
    const old = await sessionRecordingRepository.listPathsOlderThan(cutoff);

    for (const row of old) {
      if (row.recordingPath) {
        const resolved = path.resolve(row.recordingPath);
        if (isAllowedRecordingPath(resolved) && fs.existsSync(resolved)) {
          await fs.promises.unlink(resolved).catch(() => {});
        }
      }
      await sessionRecordingRepository.deleteById(row.id);
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
    const rows =
      await createCurrentSessionRecordingRepository().listByUserIdWithHost(
        userId,
      );

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

router.get(
  "/retention",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (!(await permissionManager.isAdmin(userId))) {
      return res.status(403).json({ error: "Admin access required" });
    }
    res.json({ retentionDays: getRetentionDays() });
  },
);

router.put(
  "/retention",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (!(await permissionManager.isAdmin(userId))) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const retentionDays = Number(req.body?.retentionDays);
    if (
      !Number.isInteger(retentionDays) ||
      retentionDays < 1 ||
      retentionDays > 3650
    ) {
      return res
        .status(400)
        .json({ error: "Retention must be between 1 and 3650 days" });
    }
    getDb()
      .$client.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run("session_recording_retention_days", String(retentionDays));
    void pruneOldLogs();
    res.json({ retentionDays });
  },
);

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
    const row = await createCurrentSessionRecordingRepository().findByIdForUser(
      userId,
      id,
    );

    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ log: row });
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
      const row =
        await createCurrentSessionRecordingRepository().findPathByIdForUser(
          userId,
          id,
        );

      if (!row) return res.status(404).json({ error: "Not found" });

      const filePath = row.recordingPath;
      if (!filePath)
        return res.status(404).json({ error: "No recording file" });

      const resolvedPath = path.resolve(filePath);
      if (!isAllowedRecordingPath(resolvedPath)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: "File not found" });
      }

      const content = await fs.promises.readFile(resolvedPath);
      const format =
        (row as { format?: string | null }).format ??
        (row.recordingPath?.endsWith(".cast") ? "asciicast" : "text");
      const contentType =
        format === "guacamole"
          ? "application/vnd.apache.guacamole.recording"
          : format === "asciicast"
            ? "application/x-asciicast"
            : "text/plain";
      res.type(contentType).send(content);
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
    const sessionRecordingRepository =
      createCurrentSessionRecordingRepository();
    const row = await sessionRecordingRepository.findPathByIdForUser(
      userId,
      id,
    );

    if (!row) return res.status(404).json({ error: "Not found" });

    const filePath = row.recordingPath;

    await sessionRecordingRepository.deleteForUser(userId, id);

    if (filePath) {
      const resolvedPath = path.resolve(filePath);
      if (isAllowedRecordingPath(resolvedPath) && fs.existsSync(resolvedPath)) {
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
