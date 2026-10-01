import fs from "node:fs";
import path from "node:path";
import express, { type Request, type Response, type Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { SessionRecordingRepository } from "./repository.js";

function actorId(ctx: PluginContext): string | undefined {
  return ctx.currentActor();
}

/**
 * @openapi
 * /plugin-api/session-recording/:
 *   get:
 *     summary: List session recordings
 *     description: Returns every terminal session recording for the authenticated user.
 *     tags:
 *       - Session Recording
 *     responses:
 *       200:
 *         description: List of session recordings.
 *       500:
 *         description: Failed to fetch session recordings.
 */
function registerList(
  router: Router,
  ctx: PluginContext,
  repository: SessionRecordingRepository,
): void {
  router.get("/", async (_req: Request, res: Response) => {
    const userId = actorId(ctx);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const rows = await repository.listByUserIdWithHost(userId);
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
      ctx.log.error(
        "Failed to fetch session recordings",
        error instanceof Error ? error : new Error(String(error)),
      );
      res.status(500).json({ error: "Failed to fetch session recordings" });
    }
  });
}

/**
 * @openapi
 * /plugin-api/session-recording/{id}:
 *   get:
 *     summary: Get session recording metadata
 *     description: Returns metadata for a single session recording.
 *     tags:
 *       - Session Recording
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Session recording metadata.
 *       404:
 *         description: Session recording not found.
 *       500:
 *         description: Failed to fetch session recording.
 */
function registerGet(
  router: Router,
  ctx: PluginContext,
  repository: SessionRecordingRepository,
): void {
  router.get("/:id", async (req: Request, res: Response) => {
    const userId = actorId(ctx);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const rawId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    try {
      const row = await repository.findByIdForUser(userId, id);
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json({ log: row });
    } catch (error) {
      ctx.log.error(
        "Failed to fetch session recording",
        error instanceof Error ? error : new Error(String(error)),
      );
      res.status(500).json({ error: "Failed to fetch session recording" });
    }
  });
}

/**
 * @openapi
 * /plugin-api/session-recording/{id}/content:
 *   get:
 *     summary: Get session recording content
 *     description: Returns the raw content of a session recording file.
 *     tags:
 *       - Session Recording
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Raw recording content.
 *       404:
 *         description: Session recording or file not found.
 *       500:
 *         description: Failed to read session recording.
 */
function registerContent(
  router: Router,
  ctx: PluginContext,
  repository: SessionRecordingRepository,
  dataDir: () => Promise<string>,
): void {
  router.get("/:id/content", async (req: Request, res: Response) => {
    const userId = actorId(ctx);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const rawId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    try {
      const row = await repository.findPathByIdForUser(userId, id);
      if (!row) return res.status(404).json({ error: "Not found" });

      const filePath = row.recordingPath;
      if (!filePath)
        return res.status(404).json({ error: "No recording file" });

      const resolvedPath = path.resolve(filePath);
      const base = `${path.resolve(await dataDir())}${path.sep}`;
      if (!resolvedPath.startsWith(base)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: "File not found" });
      }

      const content = await fs.promises.readFile(resolvedPath);
      const format =
        row.format ?? (filePath.endsWith(".cast") ? "asciicast" : "text");
      const contentType =
        format === "guacamole"
          ? "application/vnd.apache.guacamole.recording"
          : format === "asciicast"
            ? "application/x-asciicast"
            : "text/plain";
      res.type(contentType).send(content);
    } catch (error) {
      ctx.log.error(
        "Failed to read session recording content",
        error instanceof Error ? error : new Error(String(error)),
      );
      res.status(500).json({ error: "Failed to read session recording" });
    }
  });
}

/**
 * @openapi
 * /plugin-api/session-recording/{id}:
 *   delete:
 *     summary: Delete session recording
 *     description: Deletes a session recording and its file.
 *     tags:
 *       - Session Recording
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Session recording deleted.
 *       404:
 *         description: Session recording not found.
 *       500:
 *         description: Failed to delete session recording.
 */
function registerDelete(
  router: Router,
  ctx: PluginContext,
  repository: SessionRecordingRepository,
  dataDir: () => Promise<string>,
): void {
  router.delete("/:id", async (req: Request, res: Response) => {
    const userId = actorId(ctx);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const rawId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    try {
      const row = await repository.findPathByIdForUser(userId, id);
      if (!row) return res.status(404).json({ error: "Not found" });

      const filePath = row.recordingPath;
      const deleted = await repository.deleteForUser(userId, id);
      if (!deleted) return res.status(404).json({ error: "Not found" });

      if (filePath) {
        const resolvedPath = path.resolve(filePath);
        const base = `${path.resolve(await dataDir())}${path.sep}`;
        if (resolvedPath.startsWith(base) && fs.existsSync(resolvedPath)) {
          await fs.promises.unlink(resolvedPath).catch(() => {});
        }
      }

      res.json({ success: true });
    } catch (error) {
      ctx.log.error(
        "Failed to delete session recording",
        error instanceof Error ? error : new Error(String(error)),
      );
      res.status(500).json({ error: "Failed to delete session recording" });
    }
  });
}

export function registerSessionRecordingRoutes(
  ctx: PluginContext,
  repository: SessionRecordingRepository,
  dataDir: () => Promise<string>,
): Router {
  const router = express.Router();
  registerList(router, ctx, repository);
  registerGet(router, ctx, repository);
  registerContent(router, ctx, repository, dataDir);
  registerDelete(router, ctx, repository, dataDir);
  return router;
}
