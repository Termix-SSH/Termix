import type { AuthenticatedRequest } from "../../../types/index.js";
import express, { type Request, type Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { createCurrentFrameRegistrationRepository } from "../repositories/factory.js";
import { getPluginRuntime } from "../../plugins/index.js";
import {
  MAX_ENTRIES,
  cleanEntry,
  isFrameClient,
  isText,
  parseEntry,
} from "../../plugins/frame-registrations.js";

const router = express.Router();
const authenticateJWT = AuthManager.getInstance().createAuthMiddleware();

const installed = (pluginId: string) =>
  !!getPluginRuntime().loader.get(pluginId);

/** Frames belong to a signed in page, never to an API key. */
function sessionUser(req: Request, res: Response): string | null {
  const authReq = req as AuthenticatedRequest & { apiKeyId?: string };
  if (!authReq.sessionId || authReq.apiKeyId) {
    res.status(401).json({ error: "A login session is required" });
    return null;
  }
  return authReq.userId;
}

/**
 * @openapi
 * /plugins/frame-registrations:
 *   get:
 *     summary: What the current user's framed plugins registered last time
 *     description: The shell replays these at boot so a new browser or device does not start every plugin's frame to learn them. Only registrations and live keys, per plugin and asset version, for one client kind.
 *     tags:
 *       - Plugins
 *     parameters:
 *       - in: query
 *         name: client
 *         required: true
 *         schema:
 *           type: string
 *           enum: [web, desktop]
 *     responses:
 *       200:
 *         description: Entries by plugin id.
 *       400:
 *         description: Unknown client kind.
 *       401:
 *         description: Not signed in with a session.
 */
router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = sessionUser(req, res);
  if (!userId) return;
  const client = req.query.client;
  if (!isFrameClient(client)) {
    res.status(400).json({ error: "Unknown client" });
    return;
  }
  try {
    const rows = await createCurrentFrameRegistrationRepository().findForClient(
      userId,
      client,
    );
    const entries: Record<string, unknown> = {};
    for (const row of rows) {
      if (!installed(row.pluginId)) continue;
      const entry = parseEntry(row.data);
      if (entry) entries[row.pluginId] = entry;
    }
    res.json({ entries });
  } catch (error) {
    databaseLogger.error("Failed to read frame registrations", error, {
      operation: "get_frame_registrations",
      userId,
    });
    res.status(500).json({ error: "Failed to read frame registrations" });
  }
});

/**
 * @openapi
 * /plugins/frame-registrations:
 *   put:
 *     summary: Save what some framed plugins registered
 *     description: Saves entries by plugin id for one client kind. Unknown plugins, malformed entries and entries over 60 KB are skipped.
 *     tags:
 *       - Plugins
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [client, entries]
 *             properties:
 *               client:
 *                 type: string
 *                 enum: [web, desktop]
 *               entries:
 *                 type: object
 *     responses:
 *       200:
 *         description: How many entries were saved.
 *       400:
 *         description: Unknown client kind or entries is not an object.
 *       401:
 *         description: Not signed in with a session.
 */
router.put("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = sessionUser(req, res);
  if (!userId) return;
  const body = req.body as { client?: unknown; entries?: unknown } | undefined;
  if (
    !isFrameClient(body?.client) ||
    !body?.entries ||
    typeof body.entries !== "object" ||
    Array.isArray(body.entries)
  ) {
    res.status(400).json({ error: "Invalid frame registrations" });
    return;
  }
  try {
    const entries: Array<{ pluginId: string; data: string }> = [];
    for (const [pluginId, value] of Object.entries(
      body.entries as Record<string, unknown>,
    ).slice(0, MAX_ENTRIES)) {
      if (!isText(pluginId) || !installed(pluginId)) continue;
      const data = cleanEntry(value);
      if (data) entries.push({ pluginId, data });
    }
    await createCurrentFrameRegistrationRepository().saveMany(
      userId,
      body.client,
      entries,
    );
    res.json({ saved: entries.length });
  } catch (error) {
    databaseLogger.error("Failed to save frame registrations", error, {
      operation: "put_frame_registrations",
      userId,
    });
    res.status(500).json({ error: "Failed to save frame registrations" });
  }
});

export default router;
