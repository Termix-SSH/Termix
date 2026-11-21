import express, { type Request, type Response } from "express";
import type { AuthenticatedRequest } from "../../types/index.js";
import { AuthManager } from "../utils/auth-manager.js";
import { getLocalVersion } from "../utils/app-version.js";
import { logAudit, getAuditUsername } from "../utils/audit-logger.js";
import { systemLogger } from "../utils/logger.js";
import {
  readLogLines,
  type BufferedLevel,
  type LogQuery,
} from "../utils/log-buffer.js";
import { getClientIp } from "../utils/request-origin.js";
import { safeModeOn } from "../plugins/safe-mode.js";
import { describeRequest } from "./request-info.js";
import { describeServer } from "./server-info.js";
import { describePlugins } from "./plugins-info.js";
import { collectDiagnosticsSections } from "./sections.js";

const router = express.Router();
const requireAdmin = AuthManager.getInstance().createAdminMiddleware();

const LEVELS: BufferedLevel[] = ["debug", "info", "success", "warn", "error"];
const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function readQuery(req: Request): LogQuery {
  const query: LogQuery = {};
  const after = Number(req.query.after);
  if (Number.isInteger(after) && after >= 0) query.after = after;
  if (typeof req.query.levels === "string" && req.query.levels) {
    const wanted = req.query.levels
      .split(",")
      .filter((level): level is BufferedLevel =>
        LEVELS.includes(level as BufferedLevel),
      );
    if (wanted.length) query.levels = wanted;
  }
  if (
    typeof req.query.pluginId === "string" &&
    PLUGIN_ID.test(req.query.pluginId)
  ) {
    query.pluginId = req.query.pluginId;
  }
  const limit = Number(req.query.limit);
  if (Number.isInteger(limit) && limit > 0) query.limit = Math.min(limit, 4000);
  return query;
}

/**
 * @openapi
 * /diagnostics/request:
 *   get:
 *     summary: How this request reached the server
 *     description: Header and cookie names (never values), forwarding hops and signs of a proxy or login gate in front of Termix. Works signed out, so a broken login can still be looked at.
 *     tags:
 *       - Diagnostics
 *     responses:
 *       200:
 *         description: What the server saw.
 *       429:
 *         description: Too many requests.
 */
router.get("/request", (req: Request, res: Response) => {
  try {
    res.json({
      version: getLocalVersion(),
      serverTime: new Date().toISOString(),
      safeMode: safeModeOn(),
      request: describeRequest(req),
    });
  } catch (error) {
    systemLogger.error("Failed to describe a request", error, {
      operation: "diagnostics_request",
    });
    res.status(500).json({ error: "Failed to describe the request" });
  }
});

/**
 * @openapi
 * /diagnostics/server:
 *   get:
 *     summary: Server part of a diagnostics report
 *     description: Server, database and plugin state, plugin report sections and server log lines, all masked. Admins only. Each call is audited.
 *     tags:
 *       - Diagnostics
 *     parameters:
 *       - in: query
 *         name: logs
 *         schema:
 *           type: string
 *           enum: ["0", "1"]
 *         description: Include server log lines. On unless 0.
 *       - in: query
 *         name: sections
 *         schema:
 *           type: string
 *           enum: ["0", "1"]
 *         description: Ask running plugins for their report sections. On unless 0.
 *       - in: query
 *         name: levels
 *         schema:
 *           type: string
 *         description: Comma separated log levels to keep.
 *       - in: query
 *         name: pluginId
 *         schema:
 *           type: string
 *         description: Only this plugin's log lines and section.
 *     responses:
 *       200:
 *         description: The server part of the report.
 *       401:
 *         description: Not signed in.
 *       403:
 *         description: Not an admin.
 *       500:
 *         description: Failed to build the report.
 */
router.get("/server", requireAdmin, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const query = readQuery(req);
    const [server, plugins, sections] = await Promise.all([
      describeServer(),
      describePlugins(),
      req.query.sections === "0"
        ? Promise.resolve([])
        : collectDiagnosticsSections(query.pluginId),
    ]);
    const logs = req.query.logs === "0" ? null : readLogLines(query);
    await logAudit({
      userId,
      username: await getAuditUsername(userId),
      action: "diagnostics_export",
      resourceType: "system",
      details: JSON.stringify({
        logs: logs !== null,
        pluginId: query.pluginId ?? null,
      }),
      ipAddress: getClientIp(req),
      userAgent: req.get("user-agent") ?? undefined,
      success: true,
    });
    res.json({
      server,
      plugins,
      sections,
      logs,
      request: describeRequest(req),
    });
  } catch (error) {
    systemLogger.error("Failed to build the diagnostics report", error, {
      operation: "diagnostics_server",
    });
    res.status(500).json({ error: "Failed to build the report" });
  }
});

/**
 * @openapi
 * /diagnostics/logs:
 *   get:
 *     summary: Server log lines
 *     description: Recent server log lines, masked, for the live log view. Pass the last seq seen as after to get only newer lines. Admins only.
 *     tags:
 *       - Diagnostics
 *     parameters:
 *       - in: query
 *         name: after
 *         schema:
 *           type: integer
 *       - in: query
 *         name: levels
 *         schema:
 *           type: string
 *       - in: query
 *         name: pluginId
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Boot lines, recent lines and the newest seq.
 *       401:
 *         description: Not signed in.
 *       403:
 *         description: Not an admin.
 */
router.get("/logs", requireAdmin, (req: Request, res: Response) => {
  try {
    res.json(readLogLines(readQuery(req)));
  } catch (error) {
    systemLogger.error("Failed to read server logs", error, {
      operation: "diagnostics_logs",
    });
    res.status(500).json({ error: "Failed to read server logs" });
  }
});

export default router;
